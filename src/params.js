// Utility: parse deep link query parameters into canonical config.

const VALID_MODES = new Set(['driving', 'walking', 'bicycling', 'transit']);

export function parseDeepLink (search, defaults = {}) {
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  const origin = params.get('origin') || defaults.origin || null;
  const destination = params.get('destination') || defaults.destination || null;
  let mode = (params.get('mode') || defaults.mode || 'driving').toLowerCase();
  const units = (params.get('units') || defaults.units || '').toLowerCase();
  const apiKey = params.get('apiKey') || null; // fallback if server didn't inject
  const lang = params.get('lang') || 'en';
  const useProxy = params.get('useProxy') === 'true';
  const traffic = params.get('traffic') === 'true';
  const refreshSecRaw = params.get('refreshSec');
  const refreshSec = refreshSecRaw ? Math.max(15, parseInt(refreshSecRaw, 10) || 0) : null; // clamp min 15s
  const qrThresholdMinRaw = params.get('qrThresholdMin');
  const qrThresholdMin = qrThresholdMinRaw ? Math.max(1, parseInt(qrThresholdMinRaw, 10) || 0) : 10;
  const cuisine = params.get('cuisine') || null;
  const apptTime = params.get('apptTime') || null; // ISO 8601 expected
  const bufferMinRaw = params.get('bufferMin');
  const bufferMin = bufferMinRaw ? Math.max(0, Math.min(180, parseInt(bufferMinRaw, 10) || 0)) : 10; // clamp 0..180
  const forcedIntent = params.get('intent') || null;

  const warnings = [];
  if (!origin) warnings.push('Missing required parameter: origin');
  if (!destination) warnings.push('Missing required parameter: destination');
  if (!VALID_MODES.has(mode)) {
    warnings.push(`Invalid mode '${mode}', falling back to 'driving'`);
    mode = 'driving';
  }
  if (refreshSecRaw && !refreshSec) warnings.push('Invalid refreshSec value ignored');
  return { origin, destination, mode, units, apiKey, lang, warnings, useProxy, traffic, refreshSec, qrThresholdMin, cuisine, apptTime, bufferMin, intent: forcedIntent };
}

export function buildGoogleMapsScriptUrl (key, lang) {
  if (!key) throw new Error('Google Maps API key is required');
  const base = 'https://maps.googleapis.com/maps/api/js';
  const params = new URLSearchParams({ key, libraries: 'places', language: lang });
  return `${base}?${params.toString()}`;
}
