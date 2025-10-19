/* global google */
console.log('DEBUG: main.js starting to load');
import { parseDeepLink } from './params.js';
console.log('DEBUG: parseDeepLink imported');
import { loadGoogleMaps, initMap } from './map.js';
console.log('DEBUG: map functions imported');
import { detectIntent } from './intent.js';
console.log('DEBUG: detectIntent imported');
import { getMockRestaurants } from './restaurants.js';
console.log('DEBUG: getMockRestaurants imported');
import { computeAppointmentPlan } from './appointment.js';
console.log('DEBUG: computeAppointmentPlan imported');
import { parseAppointmentTimeFromText } from './appointmentTimeParser.js';
console.log('DEBUG: parseAppointmentTimeFromText imported');
import { sanitizeDestinationForRouting } from './destinationSanitizer.js';
console.log('DEBUG: sanitizeDestinationForRouting imported');
console.log('DEBUG: All imports completed');

const statusEl = document.getElementById('status');
const summaryEl = document.getElementById('summary');
const mapEl = document.getElementById('map');
const qrEl = document.getElementById('qr');
const foodEl = document.getElementById('foodPanel');
const gmapsShareEl = document.getElementById('gmapsShare');
const apptEl = document.getElementById('apptPanel');

function buildGoogleMapsExternalUrl (cfg, intentInfo) {
  if (intentInfo.isNearbyFood) {
    const q = `${intentInfo.cuisine || 'restaurants'} near ${cfg.origin}`;
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  }
  // TravelTime / default: directions
  const base = 'https://www.google.com/maps/dir/?api=1';
  const p = new URLSearchParams({ origin: cfg.origin, destination: cfg.destination, travelmode: cfg.mode });
  return `${base}&${p.toString()}`;
}

async function renderExternalMapsQR (externalUrl, intentInfo) {
  if (!externalUrl) return;
  try {
    const qrResp = await fetch(`/api/qr?url=${encodeURIComponent(externalUrl)}`);
    const data = await qrResp.json().catch(() => ({}));
    if (qrResp.ok && data.dataUrl) {
      gmapsShareEl.style.display = 'block';
      const label = intentInfo.isNearbyFood ? 'Google Maps Search' : 'Google Maps Directions';
      gmapsShareEl.innerHTML = `<div class='panel-title'>Open in Google Maps</div>` +
        `<div class='qr-pair'>` +
        `<div class='qr-box'><div style='font-size:12px;font-weight:600'>${label}</div><img alt='Google Maps QR' src='${data.dataUrl}'/><small>${externalUrl.replace(/^https?:\/\//,'').slice(0,60)}${externalUrl.length>60?'\u2026':''}</small><small style='opacity:.5'>Scan to open native app / browser</small></div>` +
        `</div>`;
    }
  } catch { /* ignore */ }
}

// --- Static Map Helpers (new) -------------------------------------------------
function desiredStaticSize () {
  // Try to approximate container size while staying within API limits
  const w = Math.min(1280, Math.max(400, Math.round(mapEl.clientWidth || 1024))); // clamp
  const h = Math.min(1280, Math.max(300, Math.round(mapEl.clientHeight || 768)));
  return `${w}x${h}`;
}
function imgHtml (src, alt = 'Map') {
  return `<img src='${src}' alt='${alt}' style='width:100%;height:100%;object-fit:cover;display:block' onerror="this.style.opacity='0.4';this.alt='Map load error'"/>`;
}
async function loadStaticTravelMap (cfg) {
  console.log('DEBUG: Loading static travel map');
  const size = desiredStaticSize();
  const url = `/api/staticmap/travel/image?origin=${encodeURIComponent(cfg.origin)}&destination=${encodeURIComponent(cfg.destination)}&mode=${encodeURIComponent(cfg.mode)}&size=${encodeURIComponent(size)}`;
  console.log('DEBUG: Static travel map URL:', url);
  try {
    mapEl.innerHTML = `<div style='position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;color:#888'>Loading static map...</div>`;
    const img = new Image();
    img.src = url;
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('Static travel map failed')); });
    console.log('DEBUG: Static travel map loaded successfully');
    mapEl.innerHTML = imgHtml(url, 'Travel Map');
  } catch (e) {
    console.log('DEBUG: Static travel map error:', e.message);
    mapEl.innerHTML = `<div style='padding:16px;color:#f77;font-size:14px'>Static map error: ${e.message}</div>`;
  }
}
async function loadStaticFoodMap (cfg, intentInfo, resultsCount) {
  console.log('DEBUG: Loading static food map');
  const size = desiredStaticSize();
  const cuisineParam = intentInfo.cuisine ? `&cuisine=${encodeURIComponent(intentInfo.cuisine)}` : '';
  const url = `/api/staticmap/food/image?origin=${encodeURIComponent(cfg.origin)}${cuisineParam}&limit=${resultsCount || 9}&size=${encodeURIComponent(size)}`;
  console.log('DEBUG: Static food map URL:', url);
  try {
    mapEl.innerHTML = `<div style='position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;color:#888'>Loading static food map...</div>`;
    const img = new Image();
    img.src = url;
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('Static food map failed')); });
    console.log('DEBUG: Static food map loaded successfully');
    mapEl.innerHTML = imgHtml(url, 'Nearby Food Map');
  } catch (e) {
    console.log('DEBUG: Static food map error:', e.message);
    mapEl.innerHTML = `<div style='padding:16px;color:#f77;font-size:14px'>Static food map error: ${e.message}</div>`;
  }
}
async function loadStaticAppointmentMap (cfg) {
  console.log('DEBUG: Loading static appointment map');
  if (!cfg.apptTime) { 
    console.log('DEBUG: No apptTime provided for appointment map');
    mapEl.innerHTML = `<div style='padding:16px;color:#bbb'>No apptTime provided</div>`; 
    return; 
  }
  const size = desiredStaticSize();
  const url = `/api/staticmap/appointment/image?origin=${encodeURIComponent(cfg.origin)}&destination=${encodeURIComponent(cfg.destination)}&apptTime=${encodeURIComponent(cfg.apptTime)}${cfg.bufferMin?`&bufferMin=${encodeURIComponent(cfg.bufferMin)}`:''}&size=${encodeURIComponent(size)}`;
  console.log('DEBUG: Static appointment map URL:', url);
  try {
    mapEl.innerHTML = `<div style='position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;color:#888'>Loading appointment map...</div>`;
    const img = new Image(); img.src = url;
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('Static appointment map failed')); });
    console.log('DEBUG: Static appointment map loaded successfully');
    mapEl.innerHTML = imgHtml(url, 'Appointment Map');
  } catch (e) {
    console.log('DEBUG: Static appointment map error:', e.message);
    mapEl.innerHTML = `<div style='padding:16px;color:#f77;font-size:14px'>Static appointment map error: ${e.message}</div>`;
  }
}
function shouldForceStatic () {
  console.log('DEBUG: Checking if should force static mode');
  
  // Always force static for STB devices (detect by user agent)
  const userAgent = navigator.userAgent || '';
  const isSTB = /XRE|STB|Set-Top|Android TV|Smart TV|Comcast|Roku|Apple TV|Fire TV|Chromecast|WebOS|Tizen/i.test(userAgent);
  console.log('DEBUG: User agent:', userAgent);
  console.log('DEBUG: Is STB device:', isSTB);
  
  if (isSTB) {
    console.log('DEBUG: STB device detected, forcing static mode');
    return true;
  }
  
  // Check URL parameters
  const qs = window.location.search;
  if (/[?&](static|forceStatic)=1/i.test(qs)) {
    console.log('DEBUG: Static mode forced by URL parameter');
    return true;
  }
  
  // If interactive=1 present AND no forceStatic flags -> allow interactive
  const interactiveRequested = /[?&]interactive=1/i.test(qs);
  console.log('DEBUG: Interactive mode requested:', interactiveRequested);
  
  const result = !interactiveRequested; // force static when not explicitly requested
  console.log('DEBUG: Should force static:', result);
  return result;
}
// -----------------------------------------------------------------------------

(async function bootstrap () {
  console.log('DEBUG: bootstrap function starting');
  const cfg = parseDeepLink(window.location.search);
  // Attempt early time extraction (for appointment-only mode if origin missing)
  let extractedApptTime = cfg.apptTime;
  if (!extractedApptTime && cfg.destination) {
    try { extractedApptTime = parseAppointmentTimeFromText(cfg.destination) || null; } catch { extractedApptTime = null; }
  }
  // NEW: fallback parse from origin text if still not found
  if (!extractedApptTime && cfg.origin) {
    try {
      const parsedFromOrigin = parseAppointmentTimeFromText(cfg.origin);
      if (parsedFromOrigin) {
        extractedApptTime = parsedFromOrigin;
        console.log('DEBUG: Extracted appointment time from origin string:', extractedApptTime);
      }
    } catch { /* ignore */ }
  }
  console.log('DEBUG: parseDeepLink completed, config:', cfg);
  if (cfg.warnings.length) {
    statusEl.innerHTML = cfg.warnings.map(w => `<div class='warn'>${w}</div>`).join('');
  } else {
    statusEl.textContent = 'Loading map\u2026';
  }
  if (!cfg.origin || !cfg.destination) {
    // New: Allow appointment-only mode if we have an extracted appointment time in destination OR origin
    if (extractedApptTime) {
      statusEl.classList.remove('loading');
      statusEl.innerHTML = '<div class="warn">Origin or destination missing. Showing appointment plan only.</div>';
      const intentInfo = { intent: 'AppointmentLeaveTime' };
      const durationSec = 0; // unknown travel time without origin/destination
      const plan = computeAppointmentPlan(extractedApptTime, durationSec, cfg.bufferMin);
      apptEl.style.display = 'block';
      if (!plan.valid) {
        apptEl.innerHTML = '<div class="panel-title">Appointment</div><div class="warn">Invalid appointment time</div>';
      } else {
        const departLocal = new Date(plan.departTimeISO).toLocaleTimeString();
        const apptLocal = new Date(plan.apptTimeISO).toLocaleTimeString();
        apptEl.innerHTML = `<div class='panel-title'>Appointment Plan</div>` +
          `<div class='appt-field'><strong>Appointment:</strong> ${apptLocal}</div>` +
          `<div class='appt-field'><strong>Buffer:</strong> ${plan.bufferMin} min</div>` +
          `<div class='appt-field'><strong>Depart by:</strong> ${departLocal}</div>` +
          `<div class='appt-field' id='apptStatus'><strong>Status:</strong> ${plan.status}</div>` +
          `<div class='appt-field' id='apptCountdown'></div>` +
          `<div class='appt-field' style='opacity:.6'><em>Add origin & destination parameters to compute travel time.</em></div>`;
        function fmt (s) { const m = Math.floor(s/60); const r = s%60; return `${m}m ${r}s`; }
        function updateCountdown () {
          const now = Date.now();
          const leaveIn = Math.floor((new Date(plan.departTimeISO).getTime() - now)/1000);
          const apptIn = Math.floor((new Date(plan.apptTimeISO).getTime() - now)/1000);
          const statusEl2 = document.getElementById('apptStatus');
          if (leaveIn <= 0 && apptIn > 0) { statusEl2.innerHTML = '<strong>Status:</strong> LeaveNow'; }
          if (apptIn <= 0) { statusEl2.innerHTML = '<strong>Status:</strong> Late'; }
          const cdEl = document.getElementById('apptCountdown');
          if (cdEl) {
            if (apptIn <= 0) cdEl.textContent = 'Appointment time reached';
            else if (leaveIn > 0) cdEl.textContent = 'Time until depart: ' + fmt(leaveIn);
            else cdEl.textContent = 'Time until appointment: ' + fmt(apptIn);
          }
        }
        updateCountdown();
        setInterval(updateCountdown, 30000);
        // ENHANCED SUMMARY: include depart time & status
        summaryEl.innerHTML = `<strong>Appointment:</strong> ${apptLocal}<br/><strong>Depart by:</strong> ${departLocal}<br/><strong>Buffer:</strong> ${plan.bufferMin}m<br/><strong>Status:</strong> ${plan.status}`;
      }
      // Map panel: show placeholder static message
      mapEl.innerHTML = '<div style="padding:16px;color:#888;font-size:14px">No map (origin/destination missing). Provide ?origin=...&destination=... for route.</div>';
      return; // stop further processing
    }
    statusEl.classList.remove('loading');
    statusEl.classList.add('error');
    statusEl.innerHTML += '<div>Usage: ?origin=ADDRESS&destination=ADDRESS&mode=driving</div>';
    return;
  }
  // Overwrite cfg.apptTime if we extracted one
  if (extractedApptTime && !cfg.apptTime) cfg.apptTime = extractedApptTime;
  try {
    const forceStatic = shouldForceStatic();
    console.log('DEBUG: forceStatic result:', forceStatic);
    
    // Determine whether interactive explicitly requested AND not forced static
    const interactiveRequested = /[?&]interactive=1/i.test(window.location.search) && !forceStatic;
    console.log('DEBUG: interactiveRequested result:', interactiveRequested);
    const injected = document.getElementById('gmaps-script-template').textContent;
    let injectedKey = null;
    try { injectedKey = JSON.parse(injected).key; } catch { /* ignore */ }
    const apiKey = injectedKey && injectedKey !== '__GOOGLE_MAPS_API_KEY__' ? injectedKey : cfg.apiKey;
    const mockMode = (!apiKey) && cfg.useProxy && /[?&]mock=true/.test(window.location.search);

    let mapCtl = null; // we will keep old logic if interactive allowed
    let interactiveEnabled = false;
    // Removed undefined noMap check; STB always starts in static mode unless interactive requested
    try {
      if (interactiveRequested) {
        if (!apiKey && !mockMode) throw new Error('No Google Maps API key provided');
        if (!mockMode) {
          await loadGoogleMaps(apiKey, cfg.lang);
          if (typeof google === 'undefined' || !google || !google.maps) throw new Error('Google Maps API not available');
          mapCtl = initMap(mapEl, cfg);
          interactiveEnabled = true;
        }
      }
    } catch (e) {
      console.warn('Interactive map disabled (fallback static):', e.message);
      interactiveEnabled = false;
    }

    // Auto-extract appointment time from destination if not provided
    let apptTime = cfg.apptTime;
    if (!apptTime && cfg.destination) {
      const extractedTime = parseAppointmentTimeFromText(cfg.destination);
      if (extractedTime) {
        apptTime = extractedTime;
        console.log('DEBUG: Extracted appointment time from destination:', apptTime);
      }
    }

    // Preserve original destination for intent detection (keywords) before sanitizing
    const originalDestination = cfg.destination;

    // Sanitize destination for routing if appointment time present and keywords embedded
    if (apptTime) {
      const cleanedDest = sanitizeDestinationForRouting(cfg.destination, apptTime);
      if (cleanedDest !== cfg.destination) {
        console.log('DEBUG: Sanitized destination for routing:', cleanedDest);
        cfg.destination = cleanedDest; // mutate cfg for downstream API calls / summaries
      }
    }

    // Detect intent using original destination (before keyword removal) to retain Appointment intent
    const intentInfo = detectIntent({ origin: cfg.origin, destination: originalDestination, apptTime, cuisine: cfg.cuisine, intent: cfg.intent });
    const externalMapsUrl = buildGoogleMapsExternalUrl(cfg, intentInfo);
    renderExternalMapsQR(externalMapsUrl, intentInfo); // QR always available

    // Nearby food intent: we render restaurants + static map (always static for simplicity)
    if (intentInfo.isNearbyFood) {
      statusEl.textContent = 'Loading nearby restaurants\u2026';
      const suppressionMsg = `<div class='warn' style='margin-top:4px'>Route suppressed for NearbyFood intent</div>`;
      try {
        const foodUrl = `/api/staticmap/food?origin=${encodeURIComponent(cfg.origin)}${intentInfo.cuisine ? `&cuisine=${encodeURIComponent(intentInfo.cuisine)}` : ''}${mockMode ? '&mock=true' : ''}`;
        const foodResp = await fetch(foodUrl);
        const foodData = await foodResp.json();
        if (foodResp.ok && foodData.results?.length) {
          const list = foodData.results;
            foodEl.style.display = 'block';
            const clusterInfo = foodData.clusterDistance?.text ? `<div class='cluster-meta'>Approx cluster distance: ${foodData.clusterDistance.text}</div>` : '';
            const sourceBadge = foodData.source === 'cache' ? "<span style='font-size:11px;opacity:.6'>(cache)</span>" : '';
            foodEl.innerHTML = `<div class='panel-title'>Nearby ${intentInfo.cuisine || 'restaurants'} (${list.length}) ${sourceBadge}</div>` + clusterInfo +
              list.map(r => `<div class='restaurant-item'>\u2022 <strong>${r.name}</strong>${r.rating ? ` \u2b50 ${r.rating}` : ''}${r.user_ratings_total ? ` (${r.user_ratings_total})` : ''}<br/><span style='opacity:.8'>${r.vicinity || ''}</span></div>`).join('');
            summaryEl.innerHTML = `<strong>${cfg.origin}</strong><br/>Showing nearby ${intentInfo.cuisine || 'restaurants'}` + suppressionMsg;
            // Always static map
            await loadStaticFoodMap(cfg, intentInfo, list.length);
        } else {
          const ps = foodData?.providerStatus || foodData?.error || 'UNKNOWN';
          const providerMsg = foodData?.providerRaw?.error_message;
          const list = getMockRestaurants(intentInfo.cuisine);
          foodEl.style.display = 'block';
          foodEl.innerHTML = `<div class='panel-title'>Nearby ${intentInfo.cuisine || 'food'} (mock)</div>` +
            list.map(r => `<div class='restaurant-item'>\u2022 ${r}</div>`).join('');
          summaryEl.innerHTML = `<strong>${cfg.origin}</strong><br/>Showing mock ${intentInfo.cuisine || 'restaurants'} (API error ${ps})` + suppressionMsg;
          statusEl.innerHTML = `<div class='warn'>Places API fallback (status ${ps})${providerMsg ? `: ${providerMsg}` : ''}</div>`;
          await loadStaticFoodMap(cfg, intentInfo, list.length);
        }
      } catch (e) {
        const list = getMockRestaurants(intentInfo.cuisine);
        foodEl.style.display = 'block';
        foodEl.innerHTML = `<div class='panel-title'>Nearby ${intentInfo.cuisine || 'food'} (mock)</div>` + list.map(r => `<div class='restaurant-item'>\u2022 ${r}</div>`).join('');
        summaryEl.innerHTML = `<strong>${cfg.origin}</strong><br/>Showing mock ${intentInfo.cuisine || 'restaurants'} (exception)` + suppressionMsg;
        statusEl.innerHTML = `<div class='warn'>Exception loading Places: ${e.message}</div>`;
        await loadStaticFoodMap(cfg, intentInfo, list.length);
      }
      statusEl.textContent = 'Ready';
      statusEl.classList.remove('loading');
      return; // done for food intent
    }

    // Travel or appointment intent
    let leg;
    let trafficData = null;

    if (cfg.useProxy) {
      statusEl.textContent = 'Fetching route (server proxy)\u2026';
      const proxyUrl = `/api/directions?origin=${encodeURIComponent(cfg.origin)}&destination=${encodeURIComponent(cfg.destination)}&mode=${encodeURIComponent(cfg.mode)}&lang=${encodeURIComponent(cfg.lang)}${mockMode ? '&mock=true' : ''}`;
      const resp = await fetch(proxyUrl);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const providerStatus = data.providerStatus || 'UNKNOWN';
        throw new Error(`Directions API error (providerStatus=${providerStatus})`);
      }
      leg = { start_address: data.origin, end_address: data.destination, distance: data.distance, duration: data.duration };
      if (cfg.traffic) {
        try {
          const mUrl = `/api/matrix?origin=${encodeURIComponent(cfg.origin)}&destination=${encodeURIComponent(cfg.destination)}&mode=${encodeURIComponent(cfg.mode)}&lang=${encodeURIComponent(cfg.lang)}${mockMode ? '&mock=true' : ''}`;
          const mResp = await fetch(mUrl);
          const mData = await mResp.json().catch(() => ({}));
          if (mResp.ok) trafficData = mData; else console.warn('Matrix error', mData);
        } catch (e) { /* ignore traffic error */ }
      }
    } else if (interactiveEnabled && mapCtl) {
      // interactive route (will still display static afterwards for STB consistency if forceStatic)
      const result = await mapCtl.route(cfg.mode);
      leg = result.routes[0].legs[0];
    } else {
      // fallback mock leg
      leg = { start_address: cfg.origin, end_address: cfg.destination, distance: { text: '120 km', value: 120000 }, duration: { text: '1 hour 25 mins', value: 5100 } };
    }

    // Summary
    if (trafficData && trafficData.durationInTraffic) {
      const trafficTxt = trafficData.durationInTraffic.text;
      summaryEl.innerHTML = `<strong>${leg.start_address}</strong> \u2192 <strong>${leg.end_address}</strong><br/>Distance: ${leg.distance.text} | Base: ${leg.duration.text} | Traffic: ${trafficTxt}`;
    } else {
      summaryEl.innerHTML = `<strong>${leg.start_address}</strong> \u2192 <strong>${leg.end_address}</strong><br/>Distance: ${leg.distance.text} | Duration: ${leg.duration.text}`;
    }
    // If appointment intent active, append depart/status info to summary
    if (intentInfo.intent === 'AppointmentLeaveTime' && apptTime) {
      const durationSec = (trafficData?.durationInTraffic?.value) || (trafficData?.duration?.value) || (leg?.duration?.value) || 0;
      const planTmp = computeAppointmentPlan(apptTime, durationSec, cfg.bufferMin);
      if (planTmp.valid) {
        const departLocal = new Date(planTmp.departTimeISO).toLocaleTimeString();
        const apptLocal = new Date(planTmp.apptTimeISO).toLocaleTimeString();
        summaryEl.innerHTML += `<br/><strong>Appointment:</strong> ${apptLocal} (buffer ${planTmp.bufferMin}m)` +
          `<br/><strong>Depart by:</strong> ${departLocal}` +
          `<br/><strong>Status:</strong> ${planTmp.status}`;
      }
    }

    // Static map selection
    console.log('DEBUG: Selecting static map type');
    console.log('DEBUG: Intent:', intentInfo.intent);
    console.log('DEBUG: Has apptTime:', !!cfg.apptTime);
    
    if (intentInfo.intent === 'AppointmentLeaveTime' && apptTime) {
      console.log('DEBUG: Loading appointment static map');
      await loadStaticAppointmentMap({ ...cfg, apptTime });
    } else {
      console.log('DEBUG: Loading travel static map');
      await loadStaticTravelMap(cfg);
    }

    // Appointment panel (unchanged logic) - still useful even with static map
    if (intentInfo.intent === 'AppointmentLeaveTime' && apptTime) {
      const durationSec = (trafficData?.durationInTraffic?.value) || (trafficData?.duration?.value) || (leg?.duration?.value) || 0;
      const plan = computeAppointmentPlan(apptTime, durationSec, cfg.bufferMin);
      apptEl.style.display = 'block';
      if (!plan.valid) {
        apptEl.innerHTML = `<div class='panel-title'>Appointment</div><div class='warn'>Invalid appointment time</div>`;
      } else {
        const departLocal = new Date(plan.departTimeISO).toLocaleTimeString();
        const apptLocal = new Date(plan.apptTimeISO).toLocaleTimeString();
        apptEl.innerHTML = `<div class='panel-title'>Appointment Plan</div>` +
          `<div class='appt-field'><strong>Appointment:</strong> ${apptLocal}</div>` +
          `<div class='appt-field'><strong>Travel:</strong> ${(Math.round(durationSec/60))} min</div>` +
          `<div class='appt-field'><strong>Buffer:</strong> ${plan.bufferMin} min</div>` +
          `<div class='appt-field'><strong>Depart by:</strong> ${departLocal}</div>` +
          `<div class='appt-field' id='apptStatus'><strong>Status:</strong> ${plan.status}</div>` +
          `<div class='appt-field' id='apptCountdown'></div>`;
        function fmt (s) { const m = Math.floor(s/60); const r = s%60; return `${m}m ${r}s`; }
        function updateCountdown () {
          const now = Date.now();
          const leaveIn = Math.floor((new Date(plan.departTimeISO).getTime() - now)/1000);
          const apptIn = Math.floor((new Date(plan.apptTimeISO).getTime() - now)/1000);
          const statusEl2 = document.getElementById('apptStatus');
          if (leaveIn <= 0 && apptIn > 0) { statusEl2.innerHTML = '<strong>Status:</strong> LeaveNow'; }
          if (apptIn <= 0) { statusEl2.innerHTML = '<strong>Status:</strong> Late'; }
          const cdEl = document.getElementById('apptCountdown');
          if (cdEl) {
            if (apptIn <= 0) cdEl.textContent = 'Appointment time reached';
            else if (leaveIn > 0) cdEl.textContent = 'Time until depart: ' + fmt(leaveIn);
            else cdEl.textContent = 'Time until appointment: ' + fmt(apptIn);
          }
        }
        updateCountdown();
        setInterval(updateCountdown, 30000); // update every 30s
      }
    }

    statusEl.textContent = 'Ready';
    statusEl.classList.remove('loading');
  } catch (err) {
    console.error(err);
    statusEl.classList.remove('loading');
    statusEl.classList.add('error');
    statusEl.textContent = 'Error: ' + err.message;
    // Provide static fallback if not already present
    if (!mapEl.querySelector('img')) {
      mapEl.innerHTML = `<div style='padding:16px;color:#f77;font-size:14px'>Map unavailable</div>`;
    }
  }
})();
