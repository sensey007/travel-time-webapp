import express from 'express';
import fs from 'fs';
import path from 'path';
import url from 'url';
import crypto from 'crypto';
import QRCode from 'qrcode';
import http from 'http';
import { detectIntent } from './src/intent.js';
import { parseAppointmentTimeFromText } from './src/appointmentTimeParser.js';

// Added safeFetchJson helper (was missing) used by /api/staticmap/food for geocode and places calls
async function safeFetchJson (targetUrl, label) {
  const started = Date.now();
  try {
    const resp = await fetch(targetUrl);
    const elapsedMs = Date.now() - started;
    let json = null;
    try { json = await resp.json(); } catch (_) {
      return { ok: false, status: resp.status, error: 'Invalid JSON', elapsedMs, label };
    }
    if (!resp.ok) {
      return { ok: false, status: resp.status, json, error: 'HTTP ' + resp.status, elapsedMs, label };
    }
    return { ok: true, status: resp.status, json, elapsedMs, label };
  } catch (err) {
    return { ok: false, status: null, error: err.message, elapsedMs: Date.now() - started, label };
  }
}

const app = express();
export default app; // allow importing in tests
const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const APP_VERSION = process.env.APP_VERSION || '0.1.0';
const COMMIT_SHA = process.env.COMMIT_SHA || null;
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const PLACES_DEBUG = process.env.PLACES_DEBUG === '1';

// Unified API key accessor (fallback to GOOGLE_MAPS_API_KEY if MAPS_API_KEY not set)
function getApiKey () { return process.env.MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || null; }

// Logging & utility helpers
function log (level, msg, extra = {}) {
  if (process.env.NODE_ENV === 'test') return; // silence in tests
  const levels = ['error', 'warn', 'info', 'debug'];
  if (levels.indexOf(level) <= levels.indexOf(LOG_LEVEL)) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));
  }
}
function maskValue (v) { if (!v) return v; return 'h:' + crypto.createHash('sha256').update(String(v)).digest('hex').slice(0, 10); }

// Metrics (single authoritative instance)
const metrics = {
  requestsTotal: 0,
  byPath: new Map(),
  directionsCalls: 0,
  matrixCalls: 0,
  rateLimited: 0,
  intentCounts: new Map(),
  placesCalls: 0,
  suspiciousRequests: 0
};

// Suspicious path detection (legacy scanner probes)
function isSuspiciousPath (p) { if (!p) return false; return /(\.do$|\.action$|struts|jbossmq|web-console|invoker|jmx-console)/i.test(p); }

// Ensure app + constants (previously removed)
app.use((req, res, next) => {
  const startHigh = process.hrtime.bigint();
  res.on('finish', () => {
    try {
      const ms = Number((process.hrtime.bigint() - startHigh) / 1000000n);
      const { origin, destination } = req.query;
      const originHash = maskValue(origin);
      const destinationHash = maskValue(destination);
      const intentInfo = detectIntent({ destination });
      const ip = req.ip || req.headers['x-forwarded-for'] || null;
      const ua = req.headers['user-agent'] || null;
      const suspicious = isSuspiciousPath(req.path);
      if (suspicious) metrics.suspiciousRequests++;
      log('info', 'request', { method: req.method, path: req.path, status: res.statusCode, ms, originHash, destinationHash, intent: intentInfo.intent, ip, ua, suspicious });
    } catch (_) {}
  });
  next();
});

app.use('/static', express.static(path.join(__dirname, 'src')));

// Health endpoint
app.get('/healthz', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    hasApiKey: !!getApiKey(),
    version: APP_VERSION,
    commitSha: COMMIT_SHA,
    gcpProject: process.env.GOOGLE_CLOUD_PROJECT || null
  });
});

function injectApiKey (html) {
  const envKey = getApiKey();
  if (envKey) html = html.replace(/__GOOGLE_MAPS_API_KEY__/g, envKey);
  return html;
}

// Helpers
function sanitizeSize (raw) { if (!raw) return '1024x768'; const val = String(raw).trim().toLowerCase(); const keywordMap = { small: '400x300', medium: '640x480', large: '1024x768' }; if (keywordMap[val]) return keywordMap[val]; if (/^\d+$/.test(val)) { let n = parseInt(val, 10); if (n < 64) n = 64; if (n > 1280) n = 1280; return `${n}x${n}`; } const m = val.match(/^(\d+)[xX](\d+)$/); if (m) { let w = parseInt(m[1], 10); let h = parseInt(m[2], 10); if (w < 64) w = 64; if (h < 64) h = 64; if (w > 1280) w = 1280; if (h > 1280) h = 1280; return `${w}x${h}`; } return '1024x768'; }
function buildBaseStaticMapParams (size, scale) { const sizeUsed = sanitizeSize(size); let scaleRaw = String(scale || '1').trim(); if (!/^\d+$/.test(scaleRaw)) scaleRaw = '1'; let scaleNum = parseInt(scaleRaw, 10); if (![1,2].includes(scaleNum)) scaleNum = 1; const params = new URLSearchParams({ size: sizeUsed, maptype: 'roadmap', scale: String(scaleNum) }); return { params, sizeUsed, scaleUsed: scaleNum }; }
function finalizeStaticUrl (params, apiKey, mock) { const realKey = apiKey || getApiKey(); if (realKey) { params.set('key', realKey); } else if (mock) { params.set('key', 'MOCK_KEY'); } return 'https://maps.googleapis.com/maps/api/staticmap?' + params.toString(); }
function isMockRequest (req) { if (req.query.mock === 'true') return true; if (process.env.MOCK_MODE === 'true') return true; return false; }

// NearbyFood cache & helpers (restored after accidental removal)
const FOOD_CACHE_TTL_MS = parseInt(process.env.FOOD_CACHE_TTL_MS || '60000', 10); // 60s default
const foodCache = new Map(); // key -> { ts, data }
function foodCacheKey(origin, cuisine, limit, zoom, maptype) { return [origin||'', cuisine||'', limit||'', zoom||'', maptype||''].join('|').toLowerCase(); }
function foodGet(k){ const e=foodCache.get(k); if(!e) return null; if(Date.now()-e.ts>FOOD_CACHE_TTL_MS){ foodCache.delete(k); return null;} return e.data; }
function foodSet(k,data){ foodCache.set(k,{ ts: Date.now(), data }); if(foodCache.size>200){ const first=foodCache.keys().next().value; foodCache.delete(first);} }
function haversineMeters(lat1,lon1,lat2,lon2){ if([lat1,lon1,lat2,lon2].some(v=>typeof v!=='number'||isNaN(v))) return null; const R=6371000; const toRad=d=>d*Math.PI/180; const dLat=toRad(lat2-lat1); const dLon=toRad(lon2-lon1); const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2; const c=2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)); return Math.round(R*c);} // meters
function formatMeters(m){ if(m==null) return null; return m>=1000? (m/1000).toFixed(1).replace(/\.0$/,'')+' km': m+' m'; }

// Rate limit
const RATE_LIMIT_WINDOW_MS = 60_000; const rateState = new Map();
function currentRateLimitMax () { return parseInt(process.env.RATE_LIMIT_MAX || '30', 10); }
function rateLimit (ip) { const now = Date.now(); let entry = rateState.get(ip); if (!entry || entry.reset < now) entry = { count: 0, reset: now + RATE_LIMIT_WINDOW_MS }; entry.count++; rateState.set(ip, entry); if (entry.count > currentRateLimitMax()) { metrics.rateLimited++; return false; } return true; }

app.use((req, res, next) => { metrics.requestsTotal++; metrics.byPath.set(req.path, (metrics.byPath.get(req.path) || 0) + 1); const intentInfo = detectIntent({ destination: req.query.destination }); if (intentInfo.intent) metrics.intentCounts.set(intentInfo.intent, (metrics.intentCounts.get(intentInfo.intent) || 0) + 1); next(); });

// Directions
app.get('/api/directions', async (req, res) => {
  try {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown'; if (!rateLimit(ip)) return res.status(429).json({ error: 'rate limit exceeded' });
    const { origin, destination } = req.query; let { mode = 'driving', lang = 'en' } = req.query; if (!origin || !destination) return res.status(400).json({ error: 'origin and destination are required' });
    mode = String(mode).toLowerCase(); const allowed = new Set(['driving', 'walking', 'bicycling', 'transit']); if (!allowed.has(mode)) mode = 'driving';
    const apiKey = getApiKey(); if ((!apiKey || apiKey.length === 0) && isMockRequest(req)) { metrics.directionsCalls++; return res.json({ status: 'OK', providerStatus: 'MOCK', elapsedMs: 5, origin: origin + ' (mock)', destination: destination + ' (mock)', distance: { text: '120 km', value: 120000 }, duration: { text: '1 hour 25 mins', value: 5100 }, polyline: null, warnings: [], waypointOrder: [], mode }); }
    if (!apiKey) return res.status(500).json({ error: 'Server missing MAPS_API_KEY' });
    const params = new URLSearchParams({ origin, destination, mode, language: lang, key: apiKey }); const urlDirections = 'https://maps.googleapis.com/maps/api/directions/json?' + params.toString();
    const started = Date.now(); const fetchRes = await fetch(urlDirections); const raw = await fetchRes.json(); const elapsedMs = Date.now() - started;
    if (raw.status !== 'OK' || !raw.routes?.length) return res.status(502).json({ error: 'Directions API error', providerStatus: raw.status, elapsedMs, raw: raw.status });
    const route = raw.routes[0]; const leg = route.legs[0]; metrics.directionsCalls++;
    return res.json({ status: 'OK', providerStatus: raw.status, elapsedMs, origin: leg.start_address, destination: leg.end_address, distance: leg.distance, duration: leg.duration, polyline: route.overview_polyline?.points, warnings: route.warnings, waypointOrder: route.waypoint_order, mode });
  } catch (err) { res.status(500).json({ error: 'Internal server error', message: err.message }); }
});

// Distance matrix
app.get('/api/matrix', async (req, res) => {
  try {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown'; if (!rateLimit(ip)) return res.status(429).json({ error: 'rate limit exceeded' });
    const { origin, destination } = req.query; let { mode = 'driving', lang = 'en' } = req.query; if (!origin || !destination) return res.status(400).json({ error: 'origin and destination are required' });
    mode = String(mode).toLowerCase(); const allowed = new Set(['driving', 'walking', 'bicycling', 'transit']); if (!allowed.has(mode)) mode = 'driving';
    const apiKey = getApiKey(); if ((!apiKey || apiKey.length === 0) && isMockRequest(req)) { metrics.matrixCalls++; return res.json({ status: 'OK', providerStatus: 'MOCK', origin: origin + ' (mock)', destination: destination + ' (mock)', distance: { text: '120 km', value: 120000 }, duration: { text: '1 hour 25 mins', value: 5100 }, durationInTraffic: { text: '1 hour 33 mins', value: 5580 }, mode, elapsedMs: 4 }); }
    if (!apiKey) return res.status(500).json({ error: 'Server missing MAPS_API_KEY' });
    const params = new URLSearchParams({ origins: origin, destinations: destination, mode, language: lang, key: apiKey }); if (mode === 'driving') params.set('departure_time', 'now');
    const urlMatrix = 'https://maps.googleapis.com/maps/api/distancematrix/json?' + params.toString(); const started = Date.now(); const fetchRes = await fetch(urlMatrix); const raw = await fetchRes.json(); const elapsedMs = Date.now() - started;
    if (raw.status !== 'OK' || !raw.rows?.length) return res.status(502).json({ error: 'Distance Matrix API error', providerStatus: raw.status, elapsedMs });
    const element = raw.rows[0].elements[0]; if (element.status !== 'OK') return res.status(502).json({ error: 'Element error', providerStatus: element.status, elapsedMs }); metrics.matrixCalls++;
    return res.json({ status: 'OK', providerStatus: raw.status, origin: raw.origin_addresses[0], destination: raw.destination_addresses[0], distance: element.distance, duration: element.duration, durationInTraffic: element.duration_in_traffic || null, mode, elapsedMs });
  } catch (err) { res.status(500).json({ error: 'Internal server error', message: err.message }); }
});

// QR
// Simple QR cache (keyed by normalized params) to avoid regenerating identical codes
const qrCache = new Map(); // key -> { dataUrl, ts }
function getCachedQr(key) {
  const e = qrCache.get(key); if (!e) return null; return e.dataUrl; }
function setCachedQr(key, dataUrl) { if (qrCache.size > 200) { // simple eviction
  const firstKey = qrCache.keys().next().value; qrCache.delete(firstKey); }
  qrCache.set(key, { dataUrl, ts: Date.now() }); }
function sanitizeHexColor(c, fallback) {
  if (!c) return fallback; c = String(c).trim();
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c; return fallback;
}

app.get('/api/qr', async (req, res) => {
  try {
    let target = req.query.url; if (!target) return res.status(400).json({ error: 'url parameter required' });
    target = String(target).trim();
    if (target.length > 1024) return res.status(400).json({ error: 'url too long' });
    // Params
    let { format = 'png', scale = '4', margin = '1', ecc = 'M', inline, cache = '1', fg = '#000000', bg = '#FFFFFF' } = req.query;
    format = String(format).toLowerCase(); if (!['png','svg'].includes(format)) format = 'png';
    if (!/^\d+$/.test(scale)) scale = '4'; let scaleNum = parseInt(scale,10); if (scaleNum < 1) scaleNum = 1; if (scaleNum > 10) scaleNum = 10;
    if (!/^\d+$/.test(margin)) margin = '1'; let marginNum = parseInt(margin,10); if (marginNum < 0) marginNum = 0; if (marginNum > 20) marginNum = 20;
    ecc = String(ecc).toUpperCase(); if (!['L','M','Q','H'].includes(ecc)) ecc = 'M';
    fg = sanitizeHexColor(fg, '#000000'); bg = sanitizeHexColor(bg, '#FFFFFF');
    const inlineMode = inline === '1' || inline === 'true'; const useCache = cache === '1' || cache === 'true';
    const key = useCache ? `${format}|${scaleNum}|${marginNum}|${ecc}|${fg}|${bg}|${target}` : null;
    let cached = false; let dataUrl;
    if (key) { const cachedVal = getCachedQr(key); if (cachedVal) { dataUrl = cachedVal; cached = true; } }
    if (!dataUrl) {
      const qrOptions = { margin: marginNum, scale: scaleNum, errorCorrectionLevel: ecc, color: { dark: fg, light: bg } };
      if (format === 'svg') {
        const svgString = await QRCode.toString(target, { type: 'svg', ...qrOptions });
        dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svgString, 'utf8').toString('base64');
      } else {
        dataUrl = await QRCode.toDataURL(target, qrOptions);
      }
      if (key) setCachedQr(key, dataUrl);
    }
    const meta = { format, scale: scaleNum, margin: marginNum, ecc, inline: inlineMode, cached, bytes: dataUrl.length, fg, bg };
    if (inlineMode) {
      if (format === 'svg') {
        const rawSvg = Buffer.from(dataUrl.split(',')[1], 'base64').toString('utf8');
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', 'no-store');
        return res.send(rawSvg);
      } else {
        const b64 = dataUrl.split(',')[1]; const buf = Buffer.from(b64, 'base64');
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-store');
        return res.send(buf);
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ dataUrl, meta });
  } catch (err) {
    return res.status(500).json({ error: 'QR generation failed', message: err.message });
  }
});

// Static map endpoints
app.get('/api/staticmap/travel', async (req, res) => {
  try {
    const { origin, destination, mode = 'driving', size = '1024x768', scale = '1', redirect } = req.query;
    if (!origin || !destination) return res.status(400).json({ error: 'origin and destination required' });
    const apiKey = getApiKey(); const noKey = !apiKey; const mock = noKey || (req.query.mock === 'true');
    const { params, sizeUsed, scaleUsed } = buildBaseStaticMapParams(size, scale);
    let meta = { origin, destination, mode: String(mode).toLowerCase(), sizeRequested: size, sizeUsed, scaleRequested: scale, scaleUsed, providerStatus: mock ? (noKey ? 'NO_KEY_MOCK' : 'MOCK') : null };
    if (mock) {
      params.set('center', origin);
      params.append('markers', 'color:gray|label:A|' + origin);
      params.append('markers', 'color:red|label:B|' + destination);
      const urlStatic = finalizeStaticUrl(params, apiKey, true);
      if (redirect === '1') return res.redirect(urlStatic);
      return res.json({ status: 'OK', mock: true, staticMapUrl: urlStatic, meta });
    }
    const dirParams = new URLSearchParams({ origin, destination, mode: meta.mode, language: 'en', key: apiKey });
    const dirUrl = 'https://maps.googleapis.com/maps/api/directions/json?' + dirParams.toString();
    const dirResp = await fetch(dirUrl); const dirJson = await dirResp.json();
    if (dirJson.status !== 'OK' || !dirJson.routes?.length) return res.status(502).json({ error: 'Directions API error', providerStatus: dirJson.status, meta });
    const route = dirJson.routes[0]; const leg = route.legs[0];
    const startLoc = leg.start_location; const endLoc = leg.end_location;
    params.append('markers', 'color:green|label:A|' + startLoc.lat + ',' + startLoc.lng);
    params.append('markers', 'color:red|label:B|' + endLoc.lat + ',' + endLoc.lng);
    if (route.overview_polyline?.points) params.append('path', 'enc:' + route.overview_polyline.points); else params.set('center', origin);
    meta = { ...meta, distance: leg.distance, duration: leg.duration, start_address: leg.start_address, end_address: leg.end_address };
    const urlStatic = finalizeStaticUrl(params, apiKey, false);
    if (redirect === '1') return res.redirect(urlStatic);
    return res.json({ status: 'OK', staticMapUrl: urlStatic, meta });
  } catch (e) { log('error', 'staticmap_travel_exception', { message: e.message }); return res.status(500).json({ error: 'Internal error', message: e.message }); }
});

// New: direct image proxy endpoint for travel static map
const travelImageCache = new Map(); // key -> { ts, buf, ct }
const TRAVEL_IMAGE_CACHE_TTL_MS = 30000; // 30s TTL to soften repeated calls
function travelImageCacheKey(q){ return ['v1', q.origin||'', q.destination||'', q.mode||'driving', q.size||'', q.scale||'', q.mock?'1':'0'].join('|').toLowerCase(); }
function travelImageGet(k){ const e=travelImageCache.get(k); if(!e) return null; if(Date.now()-e.ts>TRAVEL_IMAGE_CACHE_TTL_MS){ travelImageCache.delete(k); return null;} return e; }
function travelImageSet(k,buf,ct){ travelImageCache.set(k,{ ts: Date.now(), buf, ct }); if(travelImageCache.size>100){ const first=travelImageCache.keys().next().value; travelImageCache.delete(first);} }
app.get('/api/staticmap/travel/image', async (req, res) => {
  try {
    const { origin, destination, mode = 'driving', size = '1024x768', scale = '1', mock, redirect, cache } = req.query;
    if (!origin || !destination) return res.status(400).json({ error: 'origin and destination required' });
    const apiKey = getApiKey(); const noKey = !apiKey; const mockRequested = mock === 'true' || mock === '1' || noKey; // auto-mock if key missing
    const cacheEnabled = cache === '1' || cache === 'true';
    const cacheKey = cacheEnabled ? travelImageCacheKey({ origin, destination, mode, size, scale, mock: mockRequested }) : null;
    if (cacheKey){ const cached = travelImageGet(cacheKey); if(cached){ res.setHeader('Content-Type', cached.ct); res.setHeader('Cache-Control','no-store'); return res.send(cached.buf); } }
    const { params } = buildBaseStaticMapParams(size, scale);
    const normMode = ['driving','walking','bicycling','transit'].includes(String(mode).toLowerCase()) ? String(mode).toLowerCase() : 'driving';
    let staticUrl;
    if (mockRequested) {
      params.set('center', origin);
      params.append('markers', 'color:green|label:A|' + origin);
      params.append('markers', 'color:red|label:B|' + destination);
      staticUrl = finalizeStaticUrl(params, apiKey, true);
    } else {
      const dirParams = new URLSearchParams({ origin, destination, mode: normMode, language: 'en', key: apiKey });
      const dirUrl = 'https://maps.googleapis.com/maps/api/directions/json?' + dirParams.toString();
      const dirResp = await fetch(dirUrl); const dirJson = await dirResp.json();
      if (dirJson.status !== 'OK' || !dirJson.routes?.length) return res.status(502).json({ error: 'Directions API error', providerStatus: dirJson.status });
      const route = dirJson.routes[0]; const leg = route.legs[0];
      const startLoc = leg.start_location; const endLoc = leg.end_location;
      params.append('markers', 'color:green|label:A|' + startLoc.lat + ',' + startLoc.lng);
      params.append('markers', 'color:red|label:B|' + endLoc.lat + ',' + endLoc.lng);
      if (route.overview_polyline?.points) params.append('path', 'enc:' + route.overview_polyline.points); else params.set('center', origin);
      staticUrl = finalizeStaticUrl(params, apiKey, false);
    }
    if (redirect === '1' || redirect === 'true') return res.redirect(staticUrl); // optional
    const imgResp = await fetch(staticUrl);
    if (!imgResp.ok) return res.status(502).json({ error: 'Static map fetch failed', statusCode: imgResp.status });
    const contentType = imgResp.headers.get('content-type') || 'image/png';
    const arrayBuf = await imgResp.arrayBuffer(); const buf = Buffer.from(arrayBuf);
    if (cacheKey) travelImageSet(cacheKey, buf, contentType);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    // Provide masked hints for debugging without exposing raw params
    res.setHeader('X-Map-Origin', maskValue(origin));
    res.setHeader('X-Map-Destination', maskValue(destination));
    res.send(buf);
  } catch (e) { log('error','staticmap_travel_image_exception',{ message: e.message }); return res.status(500).json({ error: 'Internal error', message: e.message }); }
});

// Appointment static map endpoint
app.get('/api/staticmap/appointment', async (req, res) => {
  try {
    const { origin, destination, apptTime, bufferMin } = req.query; let { mode = 'driving', size = '1024x768', scale = '1' } = req.query;
    if (!origin || !destination) return res.status(400).json({ error: 'origin and destination are required' });
    if (!apptTime) return res.status(400).json({ error: 'apptTime is required' });
    const parsedTime = parseAppointmentTimeFromText(apptTime); if (!parsedTime) return res.status(400).json({ error: 'Invalid apptTime format' });
    const now = new Date(); now.setSeconds(0, 0);
    let startTime = new Date(now.getTime() + parsedTime.offsetMin * 60000);
    if (bufferMin) { const bufferMs = Math.max(0, Math.min(120, parseInt(bufferMin, 10) || 0)) * 60 * 1000; startTime = new Date(startTime.getTime() - bufferMs); }
    const arrivalTime = new Date(startTime.getTime() + parsedTime.durationMin * 60000);
    const apiKey = getApiKey(); const noKey = !apiKey; const mock = noKey || (req.query.mock === 'true');
    const { params, sizeUsed, scaleUsed } = buildBaseStaticMapParams(size, scale);
    let meta = { origin, destination, mode: String(mode).toLowerCase(), sizeRequested: size, sizeUsed, scaleRequested: scale, scaleUsed, providerStatus: mock ? (noKey ? 'NO_KEY_MOCK' : 'MOCK') : null };
    if (mock) {
      params.set('center', origin);
      params.append('markers', 'color:gray|label:A|' + origin);
      params.append('markers', 'color:red|label:B|' + destination);
      const urlStatic = finalizeStaticUrl(params, apiKey, true);
      return res.json({ status: 'OK', mock: true, staticMapUrl: urlStatic, meta });
    }
    const depTimeStr = `${startTime.getUTCFullYear()}-${(startTime.getUTCMonth()+1).toString().padStart(2,'0')}-${startTime.getUTCDate().toString().padStart(2,'0')}T${startTime.getUTCHours().toString().padStart(2,'0')}:${startTime.getUTCMinutes().toString().padStart(2,'0')}:00Z`;
    const arrTimeStr = `${arrivalTime.getUTCFullYear()}-${(arrivalTime.getUTCMonth()+1).toString().padStart(2,'0')}-${arrivalTime.getUTCDate().toString().padStart(2,'0')}T${arrivalTime.getUTCHours().toString().padStart(2,'0')}:${arrivalTime.getUTCMinutes().toString().padStart(2,'0')}:00Z`;
    const paramsDirections = new URLSearchParams({ origin, destination, mode, departure_time: depTimeStr, arrival_time: arrTimeStr, key: apiKey });
    const urlDirections = 'https://maps.googleapis.com/maps/api/directions/json?' + paramsDirections.toString();
    const started = Date.now(); const fetchRes = await fetch(urlDirections); const raw = await fetchRes.json(); const elapsedMs = Date.now() - started;
    if (raw.status !== 'OK' || !raw.routes?.length) return res.status(502).json({ error: 'Directions API error', providerStatus: raw.status, elapsedMs, raw: raw.status });
    const route = raw.routes[0]; const leg = route.legs[0]; metrics.directionsCalls++;
    meta = { ...meta, distance: leg.distance, duration: leg.duration, start_address: leg.start_address, end_address: leg.end_address };
    const { params: mapParams } = buildBaseStaticMapParams(size, scale);
    mapParams.append('markers', 'color:green|label:A|' + leg.start_location.lat + ',' + leg.start_location.lng);
    mapParams.append('markers', 'color:red|label:B|' + leg.end_location.lat + ',' + leg.end_location.lng);
    if (route.overview_polyline?.points) mapParams.append('path', 'enc:' + route.overview_polyline.points); else mapParams.set('center', origin);
    const urlStatic = finalizeStaticUrl(mapParams, apiKey, false);
    return res.json({ status: 'OK', staticMapUrl: urlStatic, meta });
  } catch (err) { res.status(500).json({ error: 'Internal server error', message: err.message }); }
});

// Direct image endpoint for Appointment static map
const apptImageCache = new Map();
const APPT_IMAGE_CACHE_TTL_MS = 30000;
function apptImageCacheKey(q){ return ['v1', q.origin||'', q.destination||'', q.apptTime||'', q.bufferMin||'', q.mode||'', q.size||'', q.scale||'', q.mock?'1':'0'].join('|').toLowerCase(); }
function apptImageGet(k){ const e=apptImageCache.get(k); if(!e) return null; if(Date.now()-e.ts>APPT_IMAGE_CACHE_TTL_MS){ apptImageCache.delete(k); return null;} return e; }
function apptImageSet(k,buf,ct){ apptImageCache.set(k,{ ts: Date.now(), buf, ct }); if(apptImageCache.size>100){ const first=apptImageCache.keys().next().value; apptImageCache.delete(first);} }
app.get('/api/staticmap/appointment/image', async (req, res) => {
  try {
    const { origin, destination } = req.query; if(!origin || !destination) return res.status(400).json({ error: 'origin and destination required' });
    const apiKey = getApiKey(); const noKey = !apiKey; const mockRequested = req.query.mock === 'true' || req.query.mock === '1' || noKey;
    const cacheEnabled = req.query.cache === '1' || req.query.cache === 'true';
    const cKey = cacheEnabled ? apptImageCacheKey({ ...req.query, mock: mockRequested }) : null;
    if (cKey){ const cached = apptImageGet(cKey); if(cached){ res.setHeader('Content-Type', cached.ct); res.setHeader('Cache-Control','no-store'); return res.send(cached.buf); } }
    // Reuse JSON endpoint logic
    const internalParams = new URLSearchParams();
    ['origin','destination','apptTime','bufferMin','mode','size','scale'].forEach(p=>{ if (req.query[p]) internalParams.set(p, req.query[p]); });
    if (mockRequested) internalParams.set('mock','true');
    const redirectFlag = req.query.redirect === '1' || req.query.redirect === 'true'; if (redirectFlag) internalParams.set('redirect','1');
    const jsonUrl = 'http://localhost:' + PORT + '/api/staticmap/appointment?' + internalParams.toString();
    const jsonResp = await fetch(jsonUrl); if(!jsonResp.ok){ return res.status(jsonResp.status).json({ error:'Upstream appointment staticmap failed', statusCode: jsonResp.status }); }
    let json; try { json = await jsonResp.json(); } catch (_) { return res.status(500).json({ error:'Invalid upstream JSON' }); }
    if (!json.staticMapUrl) return res.status(502).json({ error: 'No staticMapUrl in upstream response', upstream: json });
    if (redirectFlag) return res.redirect(json.staticMapUrl);
    const imgResp = await fetch(json.staticMapUrl);
    if (!imgResp.ok) return res.status(502).json({ error:'Static map fetch failed', statusCode: imgResp.status });
    const contentType = imgResp.headers.get('content-type') || 'image/png';
    const arrayBuf = await imgResp.arrayBuffer(); const buf = Buffer.from(arrayBuf);
    if (cKey) apptImageSet(cKey, buf, contentType);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Map-Origin', maskValue(origin));
    res.setHeader('X-Map-Destination', maskValue(destination));
    res.send(buf);
  } catch (e) { log('error','staticmap_appt_image_exception',{ message: e.message }); return res.status(500).json({ error:'Internal error', message: e.message }); }
});

// Food static map endpoint
app.get('/api/staticmap/food', async (req, res) => {
  try {
    const { origin, cuisine = '', limit = '9', size = '1024x768', scale = '1', zoom, maptype = 'roadmap', redirect } = req.query;
    if (!origin) return res.status(400).json({ error: 'origin required' });
    const apiKey = getApiKey(); const noKey = !apiKey; const mock = noKey || (req.query.mock === 'true');
    const { params, sizeUsed, scaleUsed } = buildBaseStaticMapParams(size, scale);
    const max = Math.min(9, Math.max(1, parseInt(limit, 10) || 5));
    const normCuisine = cuisine.trim().toLowerCase();
    let zoomVal = null; if (zoom && /^\d+$/.test(String(zoom))) { const z = parseInt(zoom, 10); if (z >= 3 && z <= 21) zoomVal = z; }
    const allowedMapTypes = new Set(['roadmap','satellite','terrain','hybrid']);
    const maptypeUsed = allowedMapTypes.has(String(maptype).toLowerCase()) ? String(maptype).toLowerCase() : 'roadmap';
    params.set('maptype', maptypeUsed);
    let meta = { origin, cuisine: normCuisine || null, limitRequested: limit, limitUsed: max, sizeRequested: size, sizeUsed, scaleRequested: scale, scaleUsed, zoomRequested: zoom || null, zoomUsed: zoomVal, maptypeRequested: maptype, maptypeUsed, providerStatus: mock ? (noKey ? 'NO_KEY_MOCK':'MOCK') : null };
    if (mock) {
      // Mock fallback path
      params.set('center', origin);
      if (zoomVal) params.set('zoom', String(zoomVal));
      params.append('markers', 'color:blue|label:O|' + encodeURIComponent(origin));
      for (let i=0;i<Math.min(max,3);i++) params.append('markers','color:red|label:'+(i+1)+'|'+encodeURIComponent(origin));
      const urlStatic = finalizeStaticUrl(params, apiKey, true);
      if (redirect === '1') return res.redirect(urlStatic);
      return res.json({ status:'OK', mock:true, staticMapUrl:urlStatic, meta, results: [] });
    }
    // Geocode origin (network guarded)
    const geoUrl = 'https://maps.googleapis.com/maps/api/geocode/json?' + new URLSearchParams({ address: origin, key: apiKey }).toString();
    const geoRes = await safeFetchJson(geoUrl, 'Geocode');
    if (!geoRes.ok) {
      // Provide structured upstream error; do NOT throw generic 500
      return res.status(502).json({ error:'Geocode upstream error', detail: geoRes.error, providerStatus: geoRes.json?.status || null, meta });
    }
    const geoJson = geoRes.json;
    if (geoJson.status !== 'OK' || !geoJson.results.length) return res.status(502).json({ error:'Geocode failed', providerStatus: geoJson.status, meta });
    const loc = geoJson.results[0].geometry.location; meta.originLocation = loc;
    // Cache key
    const ck = foodCacheKey(origin, normCuisine, max, zoomVal, maptypeUsed);
    let nearJson = foodGet(ck); let fromCache = !!nearJson;
    if (!nearJson) {
      const nearbyParams = new URLSearchParams({ location: loc.lat + ',' + loc.lng, radius:'5000', type:'restaurant', key: apiKey });
      if (normCuisine) nearbyParams.set('keyword', normCuisine + ' restaurant');
      const nearbyUrl = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json?' + nearbyParams.toString();
      const nearRes = await safeFetchJson(nearbyUrl, 'PlacesNearby');
      if (!nearRes.ok) {
        return res.status(502).json({ error:'Places nearby upstream error', detail: nearRes.error, providerStatus: nearRes.json?.status || null, meta });
      }
      nearJson = nearRes.json;
      if (nearJson.status === 'OK') foodSet(ck, nearJson);
    }
    if (nearJson.status !== 'OK') return res.status(502).json({ error:'Places nearby failed', providerStatus: nearJson.status, meta });
    // Extended results
    const rawResults = (nearJson.results || []).map(r => ({
      name: r.name,
      rating: r.rating,
      user_ratings_total: r.user_ratings_total,
      vicinity: r.vicinity,
      place_id: r.place_id,
      price_level: r.price_level,
      open_now: r.opening_hours ? r.opening_hours.open_now : null,
      location: r.geometry?.location || null
    })).sort((a,b)=>(b.rating||0)-(a.rating||0)).slice(0, max);
    meta.providerStatus = nearJson.status; meta.resultsCount = rawResults.length; meta.source = fromCache ? 'cache':'live';
    // Cluster center & distance
    if (rawResults.length > 0) {
      let sumLat=0,sumLng=0,count=0; rawResults.forEach(r=>{ if(r.location && typeof r.location.lat==='number' && typeof r.location.lng==='number'){ sumLat+=r.location.lat; sumLng+=r.location.lng; count++; }});
      if (count>0) { const cLat=sumLat/count; const cLng=sumLng/count; meta.clusterCenter={ lat:cLat, lng:cLng }; const distM=haversineMeters(loc.lat, loc.lng, cLat, cLng); if(distM!=null) meta.clusterDistance={ value:distM, text:formatMeters(distM) }; }
    }
    // Map markers
    params.set('center', loc.lat + ',' + loc.lng);
    if (zoomVal) params.set('zoom', String(zoomVal));
    params.append('markers', 'color:blue|label:O|' + loc.lat + ',' + loc.lng);
    rawResults.forEach((r, idx) => { if (r.location) params.append('markers', 'color:red|label:' + (idx+1) + '|' + r.location.lat + ',' + r.location.lng); });
    const urlStatic = finalizeStaticUrl(params, apiKey, false);
    if (redirect === '1') return res.redirect(urlStatic);
    return res.json({ status:'OK', staticMapUrl: urlStatic, meta, results: rawResults });
  } catch (e) {
    log('error','staticmap_food_exception',{ message: e.message, stack: e.stack });
    return res.status(500).json({ error:'Internal error', message: e.message });
  }
});

// Direct image endpoint for NearbyFood static map
const foodImageCache = new Map(); // key -> { ts, buf, ct }
const FOOD_IMAGE_CACHE_TTL_MS = 30000;
function foodImageCacheKey(q){ return ['v1', q.origin||'', q.cuisine||'', q.limit||'', q.size||'', q.scale||'', q.zoom||'', q.maptype||'', q.mock?'1':'0'].join('|').toLowerCase(); }
function foodImageGet(k){ const e=foodImageCache.get(k); if(!e) return null; if(Date.now()-e.ts>FOOD_IMAGE_CACHE_TTL_MS){ foodImageCache.delete(k); return null;} return e; }
function foodImageSet(k,buf,ct){ foodImageCache.set(k,{ ts: Date.now(), buf, ct }); if(foodImageCache.size>100){ const first=foodImageCache.keys().next().value; foodImageCache.delete(first);} }
app.get('/api/staticmap/food/image', async (req, res) => {
  try {
    const { origin } = req.query; if (!origin) return res.status(400).json({ error: 'origin required' });
    const apiKey = getApiKey(); const noKey = !apiKey; const mockRequested = req.query.mock === 'true' || req.query.mock === '1' || noKey;
    const cacheEnabled = req.query.cache === '1' || req.query.cache === 'true';
    const cKey = cacheEnabled ? foodImageCacheKey({ ...req.query, mock: mockRequested }) : null;
    if (cKey){ const cached = foodImageGet(cKey); if(cached){ res.setHeader('Content-Type', cached.ct); res.setHeader('Cache-Control','no-store'); return res.send(cached.buf); } }
    const internalParams = new URLSearchParams();
    ['origin','cuisine','limit','size','scale','zoom','maptype'].forEach(p=>{ if (req.query[p]) internalParams.set(p, req.query[p]); });
    if (mockRequested) internalParams.set('mock','true');
    const redirectFlag = req.query.redirect === '1' || req.query.redirect === 'true'; if (redirectFlag) internalParams.set('redirect','1');
    const jsonUrl = 'http://localhost:' + PORT + '/api/staticmap/food?' + internalParams.toString();
    const jsonResp = await fetch(jsonUrl); if (!jsonResp.ok) { return res.status(jsonResp.status).json({ error: 'Upstream food staticmap failed', statusCode: jsonResp.status }); }
    let json; try { json = await jsonResp.json(); } catch (_) { return res.status(500).json({ error: 'Invalid upstream JSON' }); }
    if (!json.staticMapUrl) return res.status(502).json({ error: 'No staticMapUrl in upstream response', upstream: json });
    if (redirectFlag) return res.redirect(json.staticMapUrl);
    const imgResp = await fetch(json.staticMapUrl);
    if (!imgResp.ok) return res.status(502).json({ error: 'Static map fetch failed', statusCode: imgResp.status });
    const contentType = imgResp.headers.get('content-type') || 'image/png';
    const arrayBuf = await imgResp.arrayBuffer(); const buf = Buffer.from(arrayBuf);
    if (cKey) foodImageSet(cKey, buf, contentType);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Map-Origin', maskValue(origin));
    res.send(buf);
  } catch (e) { log('error','staticmap_food_image_exception',{ message: e.message }); return res.status(500).json({ error:'Internal error', message: e.message }); }
});

// Minimal / diagnostic pages (retain existing ones)
app.get(['/', '/tt'], (req, res, next) => {
  if (req.query.minimal === '1' || req.query.minimal === 'true') {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Minimal Test</title></head><body><h1>Hello World</h1></body></html>');
  }
  return next();
});

app.get(['/', '/tt'], (req, res) => {
  if (req.query.safe === '1' || req.query.safe === 'true') {
    res.setHeader('Cache-Control', 'no-store');
    return res.send(`<!DOCTYPE html><html><head><meta charset='utf-8'><title>Travel Time (Safe)</title></head><body><h2>Travel Time Safe Mode</h2><p>Version: ${APP_VERSION}</p><p>Commit: ${COMMIT_SHA || 'n/a'}</p><p>MAPS_API_KEY: ${getApiKey() ? 'present' : 'missing'}</p><p>Query: ${req.originalUrl.replace(/&/g,'&amp;')}</p><p>No scripts/styles loaded.</p></body></html>`);
  }
  if (req.query.plain === '1' || req.query.plain === 'true') {
    res.setHeader('Cache-Control', 'no-store');
    return res.send(`<!DOCTYPE html><html><head><meta charset='utf-8'><title>Travel Time (Plain)</title><style>body{font-family:Arial,sans-serif;background:#111;color:#eee;padding:16px}code{background:#222;padding:2px 4px;border-radius:3px}</style></head><body><h2>Travel Time Diagnostic (Plain Mode)</h2><p>Version: ${APP_VERSION}</p><p>Commit: ${COMMIT_SHA || 'n/a'}</p><p>Has API key: ${getApiKey() ? 'yes' : 'no'}</p></body></html>`);
  }
  const indexPath = path.join(__dirname, 'src', 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  html = injectApiKey(html);
  let publicBase = process.env.PUBLIC_BASE_URL;
  if (!publicBase) {
    const fwdHost = (req.headers['x-forwarded-host'] || '').split(',')[0].trim();
    if (fwdHost) {
      const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https';
      if (/^[a-zA-Z0-9_.:-]+$/.test(fwdHost)) publicBase = `${proto}://${fwdHost}`;
    }
  }
  if (publicBase) {
    publicBase = publicBase.replace(/\/$/, '');
    html = html.replace(/__PUBLIC_BASE_URL__/g, publicBase);
  }
  res.setHeader('Cache-Control', 'no-store');
  res.send(html);
});

if (import.meta.url === url.pathToFileURL(process.argv[1]).href) {
  app.listen(PORT, () => { console.log(`Travel Time Web App HTTP listening on port ${PORT}`); });
}
