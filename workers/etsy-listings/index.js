/**
 * Gachafruit — Etsy Listings Worker
 *
 * Fetches all active Etsy shop listings and returns them as normalized
 * Explore All tiles compatible with the site's existing tile schema.
 *
 * Required secrets (set via `wrangler secret put`):
 *   ETSY_API_KEY   — your Etsy Open API v3 key
 *
 * Required vars (set in wrangler.toml or `wrangler secret put`):
 *   ETSY_SHOP_ID   — numeric Etsy shop ID (see deployment notes)
 *   ALLOWED_ORIGIN — exact origin allowed for CORS, e.g. https://gachafruit.com
 *
 * Response shape:
 *   { source: "etsy-api", fetchedAt: "<ISO>", tiles: [ ...TileObject ] }
 *
 * Each TileObject is compatible with the Explore All manualTile schema:
 *   { id, enabled, title, price, alt, url, imageMode, localImage, remoteImage }
 */

const ETSY_API_BASE = 'https://openapi.etsy.com/v3/application';
const LISTINGS_PER_PAGE = 100;
const MAX_PAGES = 10;               // safety cap — 1,000 listings max
const CACHE_TTL_SECONDS = 1800;     // 30 minutes

export default {
  async fetch(request, env, ctx) {
    // Only handle GET and OPTIONS
    if (request.method === 'OPTIONS') {
      return corsPreflightResponse(env);
    }
    if (request.method !== 'GET') {
      return errorResponse(405, 'Method not allowed', env);
    }

    // CORS origin check
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

    // Validate required config
    if (!env.ETSY_API_KEY) {
      return errorResponse(500, 'Worker is missing ETSY_API_KEY secret', env);
    }
    if (!env.ETSY_SHOP_ID) {
      return errorResponse(500, 'Worker is missing ETSY_SHOP_ID variable', env);
    }

    let tiles;
    try {
      tiles = await fetchAllListings(env.ETSY_SHOP_ID, env.ETSY_API_KEY);
    } catch (err) {
      return errorResponse(502, 'Failed to fetch listings from Etsy: ' + err.message, env);
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

    // Store in edge cache
    ctx.waitUntil(cache.put(cacheKey, response.clone()));

    return response;
  },
};

// ── Etsy fetching ────────────────────────────────────────────────────────────

/**
 * Paginates through all active shop listings and returns normalized tiles.
 * Etsy limits responses to LISTINGS_PER_PAGE items per request.
 */
async function fetchAllListings(shopId, apiKey) {
  const tiles = [];
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${ETSY_API_BASE}/shops/${shopId}/listings/active`);
    url.searchParams.set('limit', String(LISTINGS_PER_PAGE));
    url.searchParams.set('offset', String(offset));
    url.searchParams.append('includes', 'Images');
    url.searchParams.set('sort_on', 'created');
    url.searchParams.set('sort_order', 'desc');

    const res = await fetch(url.toString(), {
      headers: { 'x-api-key': apiKey },
      cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: false },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Etsy API ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    const results = data.results;

    if (!Array.isArray(results) || results.length === 0) break;

    for (const listing of results) {
      tiles.push(normalizeListing(listing));
    }

    // Stop if we received fewer than a full page — no more pages
    if (results.length < LISTINGS_PER_PAGE) break;

    offset += LISTINGS_PER_PAGE;
  }

  return tiles;
}

/**
 * Converts a single Etsy listing object into a site-compatible tile.
 * Schema matches the Explore All manualTile contract exactly, with
 * localImage always empty (API tiles have no local fallback path).
 */
function normalizeListing(listing) {
  const image = listing.images && listing.images[0];
  const remoteImage = image
    ? (image.url_570xN || image.url_fullxfull || image.url_170x135 || '')
    : '';
  const alt = (image && image.alt_text) || listing.title || '';

  return {
    id: 'etsy-' + String(listing.listing_id),
    enabled: true,
    title: listing.title || '',
    price: formatPrice(listing.price),
    alt: alt,
    url: listing.url || `https://www.etsy.com/listing/${listing.listing_id}`,
    imageMode: 'remote',
    localImage: '',
    remoteImage: remoteImage,
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

function checkOrigin(request, env) {
  const allowedOrigin = (env.ALLOWED_ORIGIN || '').trim();
  if (!allowedOrigin || allowedOrigin === '*') return null; // dev: open

  const requestOrigin = request.headers.get('Origin') || '';
  if (requestOrigin !== allowedOrigin) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}

function addCorsHeaders(headers, request, env) {
  const allowedOrigin = (env.ALLOWED_ORIGIN || '').trim();
  const requestOrigin = request.headers.get('Origin') || '';
  const origin = (!allowedOrigin || allowedOrigin === '*')
    ? requestOrigin || '*'
    : allowedOrigin;

  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  headers.set('Vary', 'Origin');
}

function corsPreflightResponse(env) {
  const headers = new Headers({
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  });
  return new Response(null, { status: 204, headers });
}

function errorResponse(status, message, env) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (env) {
    headers.set('Access-Control-Allow-Origin', env.ALLOWED_ORIGIN || '*');
  }
  return new Response(JSON.stringify({ error: message }), { status, headers });
}
