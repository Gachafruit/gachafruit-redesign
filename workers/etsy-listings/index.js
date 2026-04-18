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
 *   includes parameter. Images are fetched separately via the dedicated
 *   GET /v3/application/listings/{listing_id}/images endpoint, in batches of
 *   IMAGE_CONCURRENCY parallel requests.
 */

const ETSY_API_BASE      = 'https://openapi.etsy.com/v3/application';
const LISTINGS_PER_PAGE  = 100;
const MAX_PAGES          = 10;    // safety cap — 1,000 listings max
const IMAGE_CONCURRENCY  = 10;    // max parallel image requests per batch
const CACHE_TTL_SECONDS  = 1800;  // 30 minutes

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

    let tiles;
    try {
      tiles = await fetchAllListings(env.ETSY_SHOP_ID, env.ETSY_API_KEY);
    } catch (err) {
      return errorResponse(502, 'Failed to fetch listings from Etsy: ' + err.message, request, env);
    }

    const payload = JSON.stringify({
      source: 'etsy-api',
      fetchedAt: new Date().toISOString(),
      tiles,
    });

    const headers = new Headers({
      'Content-Type': 'application/json;charset=UTF-8',
      'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}, stale-while-revalidate=${CACHE_TTL_SECONDS * 2}`,
      'X-Cache': 'MISS',
    });
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
 *   2. Fetch primary image for each listing in bounded parallel batches
 *   3. Normalize each listing into a tile, merging in its image data
 */
async function fetchAllListings(shopId, apiKey) {
  const listings = await fetchListingPages(shopId, apiKey);
  if (listings.length === 0) return [];

  const listingIds = listings.map(l => l.listing_id);
  const imageMap   = await fetchPrimaryImages(listingIds, apiKey);

  return listings.map(listing =>
    normalizeListing(listing, imageMap[listing.listing_id] || null)
  );
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

    const res = await fetch(url.toString(), {
      headers: { 'x-api-key': apiKey },
    });

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

/**
 * Fetches the primary image for each listing ID.
 * Processes in batches of IMAGE_CONCURRENCY to stay within Etsy rate limits.
 *
 * Returns: { [listingId]: { url: string, alt: string } | null }
 */
async function fetchPrimaryImages(listingIds, apiKey) {
  const imageMap = {};

  for (let i = 0; i < listingIds.length; i += IMAGE_CONCURRENCY) {
    const batch   = listingIds.slice(i, i + IMAGE_CONCURRENCY);
    const results = await Promise.all(
      batch.map(id => fetchListingPrimaryImage(id, apiKey))
    );
    batch.forEach((id, idx) => {
      if (results[idx]) imageMap[id] = results[idx];
    });
  }

  return imageMap;
}

/**
 * Fetches images for a single listing from:
 *   GET /v3/application/listings/{listing_id}/images
 *
 * Returns the rank-1 (primary) image, or null on any failure.
 * Image URL preference: url_570xN → url_fullxfull → url_170x135
 */
async function fetchListingPrimaryImage(listingId, apiKey) {
  try {
    const url = `${ETSY_API_BASE}/listings/${listingId}/images`;
    const res = await fetch(url, { headers: { 'x-api-key': apiKey } });
    if (!res.ok) return null;

    const data   = await res.json();
    const images = data.results;
    if (!Array.isArray(images) || images.length === 0) return null;

    const primary = images.find(img => img.rank === 1) || images[0];
    return {
      url: primary.url_570xN || primary.url_fullxfull || primary.url_170x135 || '',
      alt: primary.alt_text || '',
    };
  } catch (_) {
    return null;
  }
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
