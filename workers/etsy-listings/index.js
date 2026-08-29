/**
 * Gachafruit — Etsy Listings Worker
 *
 * Fetches all active Etsy shop listings and returns them as normalized
 * Explore All tiles compatible with the site's existing tile schema.
 *
 * Required secrets (set via `wrangler secret put`):
 *   ETSY_API_KEY   — your Etsy Open API v3 key
 *
 * Required vars (set in wrangler.toml):
 *   ETSY_SHOP_ID    — numeric Etsy shop ID
 *   ALLOWED_ORIGINS — comma-separated list of allowed origins, e.g.:
 *                     "https://gachafruit.com,http://localhost:5500"
 *
 * Response shape:
 *   { source: "etsy-api", fetchedAt: "<ISO>", tiles: [ ...TileObject ] }
 *
 * Each TileObject matches the Explore All manualTile schema:
 *   { id, enabled, title, price, alt, url, imageMode, localImage, remoteImage }
 *
 * Image fetching note:
 *   The active listings endpoint does not return image data regardless of the
 *   includes parameter (Etsy's own issue tracker documents this endpoint's
 *   includes=Images as unreliable, up to and including 502s). Images are
 *   instead fetched via the batch endpoint:
 *     GET /v3/application/listings/batch?listing_ids=<up to 100, comma-separated>&includes=Images
 *   in chunks of IMAGE_BATCH_SIZE, fetched SEQUENTIALLY (never concurrently)
 *   to stay well under this app's confirmed 5 QPS / 5,000 QPD Etsy quota.
 *   The prior implementation fired 10 concurrent per-listing image requests
 *   (IMAGE_CONCURRENCY), which alone exceeded the 5 QPS quota on every
 *   cache-cold request — that was the root cause of images intermittently
 *   failing to load.
 */

const ETSY_API_BASE              = 'https://openapi.etsy.com/v3/application';
const LISTINGS_PER_PAGE          = 100;
const MAX_PAGES                  = 10;   // safety cap — 1,000 listings max
const IMAGE_BATCH_SIZE           = 100;  // Etsy's documented max listing_ids per /listings/batch call
const MAX_RETRY_WAIT_SECONDS     = 5;    // cap on how long we honor Retry-After before giving up
const CACHE_TTL_SECONDS          = 1800; // 30 minutes — healthy responses only
const DEGRADED_CACHE_TTL_SECONDS = 60;   // short TTL when the image batch fetch failed, so a
                                          // rate-limited/broken run can't poison the cache for 30 min

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return corsPreflightResponse(request, env);
    }
    if (request.method !== 'GET') {
      return errorResponse(405, 'Method not allowed', request, env);
    }

    const originError = checkOrigin(request, env);
    if (originError) return originError;

    // Check Cloudflare edge cache first
    const cache = caches.default;
    const cacheKey = new Request(request.url, { method: 'GET' });
    const cached = await cache.match(cacheKey);
    if (cached) {
      const cloned = new Response(cached.body, cached);
      cloned.headers.set('X-Cache', 'HIT');
      addCorsHeaders(cloned.headers, request, env);
      return cloned;
    }

    if (!env.ETSY_API_KEY) {
      return errorResponse(500, 'Worker is missing ETSY_API_KEY secret', request, env);
    }
    if (!env.ETSY_SHOP_ID) {
      return errorResponse(500, 'Worker is missing ETSY_SHOP_ID variable', request, env);
    }

    let tiles, imageFetchDegraded;
    try {
      const result = await fetchAllListings(env.ETSY_SHOP_ID, env.ETSY_API_KEY);
      tiles = result.tiles;
      imageFetchDegraded = result.imageFetchDegraded;
    } catch (err) {
      return errorResponse(502, 'Failed to fetch listings from Etsy: ' + err.message, request, env);
    }

    const payload = JSON.stringify({
      source: 'etsy-api',
      fetchedAt: new Date().toISOString(),
      tiles,
    });

    // A broad image-batch failure (rate-limited or erroring even after retry)
    // gets a short TTL instead of the normal 30 minutes, so it self-heals in
    // about a minute rather than serving missing images to every visitor for
    // half an hour. Listing metadata is still valid either way — only the
    // cache lifetime changes, never the JSON payload shape.
    const effectiveTtl = imageFetchDegraded ? DEGRADED_CACHE_TTL_SECONDS : CACHE_TTL_SECONDS;

    const headers = new Headers({
      'Content-Type': 'application/json;charset=UTF-8',
      'Cache-Control': `public, max-age=${effectiveTtl}, stale-while-revalidate=${effectiveTtl * 2}`,
      'X-Cache': 'MISS',
    });
    if (imageFetchDegraded) headers.set('X-Image-Fetch-Degraded', 'true');
    addCorsHeaders(headers, request, env);

    const response = new Response(payload, { status: 200, headers });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};

// ── Etsy fetching ────────────────────────────────────────────────────────────

/**
 * Top-level orchestrator:
 *   1. Fetch all active listing stubs (title, price, url — no images)
 *   2. Fetch images for all listings via the batch endpoint, sequentially
 *   3. Normalize each listing into a tile, merging in its image data
 *
 * Returns: { tiles: TileObject[], imageFetchDegraded: boolean }
 *   imageFetchDegraded is true only when a whole image-batch request failed
 *   (even after its retry) — never for an individual listing that genuinely
 *   has no photos. The caller uses this to shorten the cache TTL so a broken
 *   run doesn't get served as "successful" for a full 30 minutes.
 */
async function fetchAllListings(shopId, apiKey) {
  const listings = await fetchListingPages(shopId, apiKey);
  if (listings.length === 0) return { tiles: [], imageFetchDegraded: false };

  const listingIds = listings.map(l => l.listing_id);
  const { imageMap, anyBatchFailed } = await fetchImagesBatched(listingIds, apiKey);

  const tiles = listings.map(listing =>
    normalizeListing(listing, imageMap[listing.listing_id] || null)
  );

  return { tiles, imageFetchDegraded: anyBatchFailed };
}

/** Pages through GET /shops/{shopId}/listings/active until exhausted. */
async function fetchListingPages(shopId, apiKey) {
  const listings = [];
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${ETSY_API_BASE}/shops/${shopId}/listings/active`);
    url.searchParams.set('limit',      String(LISTINGS_PER_PAGE));
    url.searchParams.set('offset',     String(offset));
    url.searchParams.set('sort_on',    'created');
    url.searchParams.set('sort_order', 'desc');

    const res = await etsyGet(url.toString(), apiKey, { endpoint: 'listings-active', page, offset });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Etsy listings API ${res.status}: ${body.slice(0, 200)}`);
    }

    const data    = await res.json();
    const results = data.results;

    if (!Array.isArray(results) || results.length === 0) break;
    listings.push(...results);
    if (results.length < LISTINGS_PER_PAGE) break;
    offset += LISTINGS_PER_PAGE;
  }

  return listings;
}

// ── Rate-limit-aware Etsy GET helper ────────────────────────────────────────

/**
 * Performs one GET request with the shared x-api-key header.
 *
 * On HTTP 429, waits for Retry-After (capped at MAX_RETRY_WAIT_SECONDS) and
 * retries exactly once. Logs status/context for any non-2xx response — never
 * the API key or the raw Authorization/x-api-key header value. Never throws
 * for a bad status; the caller decides what a non-ok response means.
 */
async function etsyGet(url, apiKey, logContext) {
  const res = await fetch(url, { headers: { 'x-api-key': apiKey } });

  if (res.status === 429) {
    const retryAfterHeader = res.headers.get('retry-after');
    const waitSeconds      = clampRetryAfter(retryAfterHeader);
    console.log(JSON.stringify({
      msg: 'etsy-429-rate-limited',
      ...logContext,
      retryAfterHeader,
      willRetryAfterSeconds: waitSeconds,
    }));

    if (waitSeconds > 0) await sleep(waitSeconds * 1000);
    const retryRes = await fetch(url, { headers: { 'x-api-key': apiKey } });

    if (!retryRes.ok) {
      console.log(JSON.stringify({
        msg: 'etsy-request-failed-after-retry',
        ...logContext,
        status: retryRes.status,
      }));
    }
    return retryRes;
  }

  if (!res.ok) {
    console.log(JSON.stringify({ msg: 'etsy-request-error', ...logContext, status: res.status }));
  }

  return res;
}

/** Clamps Etsy's Retry-After (seconds) to a sane, bounded wait. */
function clampRetryAfter(headerValue) {
  const parsed = parseInt(headerValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1; // sane default if missing/invalid
  return Math.min(parsed, MAX_RETRY_WAIT_SECONDS);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Image fetching (batch endpoint) ─────────────────────────────────────────

/**
 * Fetches images for all listing IDs via:
 *   GET /v3/application/listings/batch?listing_ids=<comma-separated>&includes=Images
 *
 * Chunked at IMAGE_BATCH_SIZE (Etsy's documented max per call) and processed
 * SEQUENTIALLY — not with Promise.all — so this app's confirmed 5 QPS quota
 * is never exceeded regardless of shop size. A shop small enough to fit in
 * one chunk costs exactly one image request total, instead of one per listing.
 *
 * Returns:
 *   {
 *     imageMap: { [listingId]: { url: string, alt: string } },
 *     anyBatchFailed: boolean  // true if a whole chunk failed even after retry
 *   }
 */
async function fetchImagesBatched(listingIds, apiKey) {
  const imageMap = {};
  let anyBatchFailed = false;

  for (let i = 0; i < listingIds.length; i += IMAGE_BATCH_SIZE) {
    const chunk  = listingIds.slice(i, i + IMAGE_BATCH_SIZE);
    const result = await fetchImageBatch(chunk, apiKey);

    if (!result.ok) {
      anyBatchFailed = true;
      continue; // listings in this chunk simply get no image (remoteImage: '')
    }

    Object.assign(imageMap, result.imageMap);
  }

  return { imageMap, anyBatchFailed };
}

/**
 * Fetches one chunk (<= IMAGE_BATCH_SIZE ids) from the batch endpoint.
 * Never throws — failures are reported via { ok: false } so a bad chunk
 * degrades only the listings in that chunk, not the whole response.
 */
async function fetchImageBatch(listingIds, apiKey) {
  const url = new URL(`${ETSY_API_BASE}/listings/batch`);
  url.searchParams.set('listing_ids', listingIds.join(','));
  url.searchParams.set('includes', 'Images');

  let res;
  try {
    res = await etsyGet(url.toString(), apiKey, {
      endpoint: 'listings-batch',
      listingCount: listingIds.length,
    });
  } catch (err) {
    console.log(JSON.stringify({
      msg: 'etsy-image-batch-network-error',
      listingCount: listingIds.length,
      error: err.message,
    }));
    return { ok: false };
  }

  if (!res.ok) return { ok: false };

  let data;
  try {
    data = await res.json();
  } catch (err) {
    console.log(JSON.stringify({ msg: 'etsy-image-batch-parse-error', error: err.message }));
    return { ok: false };
  }

  return { ok: true, imageMap: parseImageBatchResponse(data) };
}

/**
 * Defensively parses the /listings/batch response into
 * { [listingId]: { url, alt } }.
 *
 * Does not assume a single rigid shape: tolerates `listing.images` (Etsy's
 * documented field) or `listing.Images` (in case of an association-name
 * echo), and logs — without any sensitive data, just the listing ID and the
 * field names actually present — when a listing's shape matches neither, so
 * a real-world deviation can be diagnosed from logs rather than silently
 * dropped. A listing with a genuinely empty images array is not an error and
 * is not logged; it simply gets no image.
 */
function parseImageBatchResponse(data) {
  const imageMap = {};
  const results  = Array.isArray(data && data.results) ? data.results : [];

  for (const listing of results) {
    if (!listing || listing.listing_id == null) continue;

    const images = Array.isArray(listing.images)
      ? listing.images
      : Array.isArray(listing.Images)
        ? listing.Images
        : null;

    if (images === null) {
      console.log(JSON.stringify({
        msg: 'etsy-image-batch-unexpected-shape',
        listingId: listing.listing_id,
        fieldsPresent: Object.keys(listing),
      }));
      continue;
    }

    if (images.length === 0) continue; // listing genuinely has no images

    const primary = images.find(img => img && img.rank === 1) || images[0];
    const url     = pickBestImageUrl(primary);
    if (!url) continue;

    imageMap[listing.listing_id] = { url, alt: (primary && primary.alt_text) || '' };
  }

  return imageMap;
}

/** Returns the best available image URL field, largest-useful first. */
function pickBestImageUrl(image) {
  if (!image) return '';
  const preference = ['url_570xN', 'url_fullxfull', 'url_640x640', 'url_170x135', 'url_75x75'];
  for (const field of preference) {
    if (image[field]) return image[field];
  }
  return '';
}

/**
 * Converts a listing stub + its image data into a site-compatible tile.
 * image param: { url: string, alt: string } | null
 */
function normalizeListing(listing, image) {
  return {
    id:          'etsy-' + String(listing.listing_id),
    enabled:     true,
    title:       listing.title || '',
    price:       formatPrice(listing.price),
    alt:         (image && image.alt) || listing.title || '',
    url:         listing.url || `https://www.etsy.com/listing/${listing.listing_id}`,
    imageMode:   'remote',
    localImage:  '',
    remoteImage: (image && image.url) || '',
  };
}

/** Converts Etsy's { amount, divisor, currency_code } price to "$X.XX" */
function formatPrice(price) {
  if (!price || price.divisor == null || price.amount == null) return '';
  const amount = price.amount / price.divisor;
  const symbol = price.currency_code === 'USD' ? '$' : price.currency_code + ' ';
  return symbol + amount.toFixed(2);
}

// ── CORS helpers ─────────────────────────────────────────────────────────────

/**
 * Resolves the correct Access-Control-Allow-Origin value for a given request.
 *
 * Reads ALLOWED_ORIGINS (comma-separated list) from env, falling back to the
 * legacy ALLOWED_ORIGIN single-value key. If the incoming Origin header matches
 * one of the allowed values, that exact origin is returned so the browser sees
 * a precise echo rather than a wildcard. Returns null if no match is found.
 */
function resolveAllowedOrigin(request, env) {
  const raw = (env.ALLOWED_ORIGINS || env.ALLOWED_ORIGIN || '').trim();
  if (!raw || raw === '*') return '*';

  const requestOrigin = request.headers.get('Origin') || '';
  const allowed = raw.split(',').map(s => s.trim()).filter(Boolean);
  return allowed.includes(requestOrigin) ? requestOrigin : null;
}

function checkOrigin(request, env) {
  const origin = resolveAllowedOrigin(request, env);
  if (origin === null) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}

function addCorsHeaders(headers, request, env) {
  const origin = resolveAllowedOrigin(request, env);
  headers.set('Access-Control-Allow-Origin',  origin || 'null');
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  headers.set('Vary', 'Origin');
}

function corsPreflightResponse(request, env) {
  const origin = resolveAllowedOrigin(request, env);
  return new Response(null, {
    status: 204,
    headers: new Headers({
      'Access-Control-Allow-Origin':  origin || 'null',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age':       '86400',
      'Vary':                         'Origin',
    }),
  });
}

function errorResponse(status, message, request, env) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (request && env) {
    const origin = resolveAllowedOrigin(request, env);
    if (origin) headers.set('Access-Control-Allow-Origin', origin);
  }
  return new Response(JSON.stringify({ error: message }), { status, headers });
}
