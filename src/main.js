/* global google */
console.log('DEBUG: main.js starting to load');
import { parseDeepLink } from './params.js';
import { loadGoogleMaps, initMap } from './map.js';
import { detectIntent } from './intent.js';
import { getMockRestaurants } from './restaurants.js';
import { computeAppointmentPlan } from './appointment.js';
import { parseAppointmentTimeFromText } from './appointmentTimeParser.js';
import { sanitizeDestinationForRouting } from './destinationSanitizer.js';
console.log('DEBUG: Imports complete');

// DOM refs
const statusEl = document.getElementById('status');
const summaryEl = document.getElementById('summary');
const mapEl = document.getElementById('map');
const foodEl = document.getElementById('foodPanel');
const gmapsShareEl = document.getElementById('gmapsShare');
const apptEl = document.getElementById('apptPanel');

function buildGoogleMapsExternalUrl (cfg, intentInfo) {
  if (intentInfo.isNearbyFood) {
    const q = `${intentInfo.cuisine || 'restaurants'} near ${cfg.origin}`;
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  }
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

// Static map helpers
function desiredStaticSize () {
  const w = Math.min(1280, Math.max(400, Math.round(mapEl.clientWidth || 1024)));
  const h = Math.min(1280, Math.max(300, Math.round(mapEl.clientHeight || 768)));
  return `${w}x${h}`;
}
function imgHtml (src, alt = 'Map') {
  return `<img src='${src}' alt='${alt}' style='width:100%;height:100%;object-fit:cover;display:block' onerror="this.style.opacity='0.4';this.alt='Map load error'"/>`;
}
async function loadStaticTravelMap (cfg) {
  const size = desiredStaticSize();
  const url = `/api/staticmap/travel/image?origin=${encodeURIComponent(cfg.origin)}&destination=${encodeURIComponent(cfg.destination)}&mode=${encodeURIComponent(cfg.mode)}&size=${encodeURIComponent(size)}`;
  try {
    mapEl.innerHTML = `<div style='position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;color:#888'>Loading static map...</div>`;
    const img = new Image(); img.src = url;
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('Static travel map failed')); });
    mapEl.innerHTML = imgHtml(url, 'Travel Map');
  } catch (e) { mapEl.innerHTML = `<div style='padding:16px;color:#f77'>Static map error: ${e.message}</div>`; }
}
async function loadStaticFoodMap (cfg, intentInfo, resultsCount) {
  const size = desiredStaticSize();
  const cuisineParam = intentInfo.cuisine ? `&cuisine=${encodeURIComponent(intentInfo.cuisine)}` : '';
  const url = `/api/staticmap/food/image?origin=${encodeURIComponent(cfg.origin)}${cuisineParam}&limit=${resultsCount || 9}&size=${encodeURIComponent(size)}`;
  try {
    mapEl.innerHTML = `<div style='position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;color:#888'>Loading food map...</div>`;
    const img = new Image(); img.src = url;
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('Static food map failed')); });
    mapEl.innerHTML = imgHtml(url, 'Nearby Food Map');
  } catch (e) { mapEl.innerHTML = `<div style='padding:16px;color:#f77'>Food map error: ${e.message}</div>`; }
}
async function loadStaticAppointmentMap (cfg) {
  if (!cfg.apptTime) { mapEl.innerHTML = `<div style='padding:16px;color:#bbb'>No apptTime provided</div>`; return; }
  const size = desiredStaticSize();
  const url = `/api/staticmap/appointment/image?origin=${encodeURIComponent(cfg.origin)}&destination=${encodeURIComponent(cfg.destination)}&apptTime=${encodeURIComponent(cfg.apptTime)}${cfg.bufferMin?`&bufferMin=${encodeURIComponent(cfg.bufferMin)}`:''}&size=${encodeURIComponent(size)}`;
  try {
    mapEl.innerHTML = `<div style='position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;color:#888'>Loading appointment map...</div>`;
    const img = new Image(); img.src = url;
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('Static appointment map failed')); });
    mapEl.innerHTML = imgHtml(url, 'Appointment Map');
  } catch (e) { mapEl.innerHTML = `<div style='padding:16px;color:#f77'>Appointment map error: ${e.message}</div>`; }
}
function shouldForceStatic () {
  const ua = navigator.userAgent || '';
  const isSTB = /XRE|STB|Set-Top|Android TV|Smart TV|Comcast|Roku|Apple TV|Fire TV|Chromecast|WebOS|Tizen/i.test(ua);
  if (isSTB) return true;
  const qs = window.location.search;
  if (/[?&](static|forceStatic)=1/i.test(qs)) return true;
  const interactiveRequested = /[?&]interactive=1/i.test(qs);
  return !interactiveRequested; // static unless explicitly interactive
}

// Countdown overlay
function setupDepartOverlay (plan) {
  try {
    if (!plan || !plan.valid) return;
    if (window.__departOverlayInterval) clearInterval(window.__departOverlayInterval);
    let overlay = document.getElementById('departCountdownOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'departCountdownOverlay';
      overlay.setAttribute('aria-live', 'polite');
      overlay.innerHTML = `<div class='overlay-main'>…</div><div class='overlay-appt'></div>`;
      mapEl.appendChild(overlay);
    } else if (!overlay.querySelector('.overlay-main')) {
      overlay.innerHTML = `<div class='overlay-main'>…</div><div class='overlay-appt'></div>`;
    }
    const mainEl = overlay.querySelector('.overlay-main');
    const apptSubEl = overlay.querySelector('.overlay-appt');
    function formatCountdown (leaveInSec, apptInSec) {
      if (leaveInSec <= 0 && apptInSec > 0) return 'LEAVE NOW';
      if (apptInSec <= 0) return 'LATE';
      if (leaveInSec > 3600) { const h = Math.floor(leaveInSec/3600); const m = Math.floor((leaveInSec%3600)/60); return `${h}h ${m}m`; }
      const m = Math.floor(leaveInSec/60); const s = leaveInSec % 60; return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }
    function formatApptLabel () {
      const apptDate = new Date(plan.apptTimeISO);
      const now = new Date();
      const opts = { hour: '2-digit', minute: '2-digit' };
      const timeStr = apptDate.toLocaleTimeString([], opts);
      const isToday = apptDate.toDateString() === now.toDateString();
      return isToday ? `Appt ${timeStr}` : `Appt ${apptDate.toLocaleDateString()} ${timeStr}`;
    }
    function updateOverlay () {
      const nowMs = Date.now();
      const departMs = new Date(plan.departTimeISO).getTime() - nowMs;
      const apptMs = new Date(plan.apptTimeISO).getTime() - nowMs;
      const leaveIn = Math.floor(departMs/1000); const apptIn = Math.floor(apptMs/1000);
      if (mainEl) mainEl.textContent = formatCountdown(leaveIn, apptIn);
      if (apptSubEl) apptSubEl.textContent = formatApptLabel();
      overlay.classList.remove('pulse-leave','pulse-late','small');
      // Soft pulse states
      if (leaveIn <= 0 && apptIn > 0) {
        overlay.style.background = 'rgba(255,80,0,0.78)'; overlay.classList.add('pulse-leave');
      } else if (apptIn <= 0) {
        overlay.style.background = 'rgba(200,30,30,0.78)'; overlay.classList.add('pulse-late');
      } else if (leaveIn < 300) { // less than 5 minutes to leave
        overlay.style.background = 'rgba(255,140,0,0.72)'; overlay.classList.add('pulse-leave');
      } else if (leaveIn < 1800) { // within 30 minutes
        overlay.style.background = 'rgba(0,0,0,0.55)';
      } else {
        overlay.style.background = 'rgba(0,0,0,0.60)'; overlay.classList.add('small');
      }
    }
    updateOverlay();
    window.__departOverlayInterval = setInterval(updateOverlay, 2000);
  } catch (e) { console.warn('Depart overlay setup failed:', e.message); }
}

// Bootstrap IIFE
(async function bootstrap () {
  console.log('DEBUG: bootstrap function starting');
  const cfg = parseDeepLink(window.location.search);
  let extractedApptTime = cfg.apptTime;
  if (!extractedApptTime && cfg.destination) {
    try { extractedApptTime = parseAppointmentTimeFromText(cfg.destination) || null; } catch { extractedApptTime = null; }
  }
  if (!extractedApptTime && cfg.origin) {
    try { const parsedFromOrigin = parseAppointmentTimeFromText(cfg.origin); if (parsedFromOrigin) extractedApptTime = parsedFromOrigin; } catch { /* ignore */ }
  }
  if (cfg.warnings.length) {
    statusEl.innerHTML = cfg.warnings.map(w => `<div class='warn'>${w}</div>`).join('');
  } else {
    statusEl.textContent = 'Loading…';
  }

  if (!cfg.origin || !cfg.destination) {
    if (extractedApptTime) {
      statusEl.classList.remove('loading');
      statusEl.innerHTML = '<div class="warn">Origin or destination missing. Appointment plan only.</div>';
      const plan = computeAppointmentPlan(extractedApptTime, 0, cfg.bufferMin);
      apptEl.style.display = 'block';
      if (!plan.valid) {
        apptEl.innerHTML = '<div class="panel-title">Appointment</div><div class="warn">Invalid appointment time</div>';
      } else {
        const departLocal = new Date(plan.departTimeISO).toLocaleTimeString();
        const apptLocal = new Date(plan.apptTimeISO).toLocaleTimeString();
        const statusClass = plan.status === 'Late' ? 'late' : (plan.status === 'LeaveNow' ? 'leave' : 'future');
        apptEl.innerHTML = `<div class='panel-title'>Appointment</div>` +
          `<div class='appt-row appt-important'>Appt: <span class='value'>${apptLocal}</span></div>` +
          `<div class='appt-row appt-important'>Depart: <span class='value'>${departLocal}</span></div>` +
          `<div class='appt-row appt-status' id='apptStatus'>Status: <span class='value status-val ${statusClass}'>${plan.status}</span></div>` +
          `<div class='appt-meta'>Buffer ${plan.bufferMin}m</div>`;
        function updateStatusOnly () {
          const now = Date.now();
            const leaveIn = Math.floor((new Date(plan.departTimeISO).getTime() - now)/1000);
            const apptIn = Math.floor((new Date(plan.apptTimeISO).getTime() - now)/1000);
            const statusEl2 = document.getElementById('apptStatus');
            if (!statusEl2) return;
            let statusTxt = plan.status;
            if (leaveIn <= 0 && apptIn > 0) statusTxt = 'LeaveNow';
            if (apptIn <= 0) statusTxt = 'Late';
            const sc = statusTxt === 'Late' ? 'late' : (statusTxt === 'LeaveNow' ? 'leave' : 'future');
            statusEl2.innerHTML = `Status: <span class='value status-val ${sc}'>${statusTxt}</span>`;
        }
        updateStatusOnly(); setInterval(updateStatusOnly, 30000);
        summaryEl.innerHTML = `<strong>Appointment:</strong> ${apptLocal}<br/><strong>Depart:</strong> ${departLocal}<br/><strong>Buffer:</strong> ${plan.bufferMin}m<br/><strong>Status:</strong> ${plan.status}`;
        setupDepartOverlay(plan);
      }
      mapEl.innerHTML = '<div style="padding:16px;color:#888;font-size:14px">No map (origin/destination missing).</div>';
      if (typeof window.hideLoadingSplash === 'function') window.hideLoadingSplash('Appointment only ready');
      return;
    }
    statusEl.classList.remove('loading'); statusEl.classList.add('error');
    statusEl.innerHTML += '<div>Usage: ?origin=ADDRESS&destination=ADDRESS</div>';
    if (typeof window.hideLoadingSplash === 'function') window.hideLoadingSplash('Missing params');
    return;
  }

  if (extractedApptTime && !cfg.apptTime) cfg.apptTime = extractedApptTime;

  try {
    const forceStatic = shouldForceStatic();
    const injected = document.getElementById('gmaps-script-template').textContent;
    let injectedKey = null; try { injectedKey = JSON.parse(injected).key; } catch {}
    const apiKey = injectedKey && injectedKey !== '__GOOGLE_MAPS_API_KEY__' ? injectedKey : cfg.apiKey;
    const mockMode = (!apiKey) && /[?&]mock=true/.test(window.location.search);

    let mapCtl = null; let interactiveEnabled = false;
    if (!forceStatic) {
      try {
        if (!apiKey && !mockMode) throw new Error('No Google Maps API key');
        if (!mockMode) {
          await loadGoogleMaps(apiKey, cfg.lang);
          if (!google?.maps) throw new Error('Google Maps API not available');
          mapCtl = initMap(mapEl, cfg); interactiveEnabled = true;
        }
      } catch (e) { console.warn('Interactive disabled:', e.message); }
    }

    // Extract apptTime from destination if not provided
    let apptTime = cfg.apptTime;
    if (!apptTime && cfg.destination) {
      const extractedTime = parseAppointmentTimeFromText(cfg.destination); if (extractedTime) apptTime = extractedTime;
    }
    if (apptTime && !cfg.apptTime) cfg.apptTime = apptTime;
    const originalDestination = cfg.destination;
    if (apptTime) {
      const cleaned = sanitizeDestinationForRouting(cfg.destination, apptTime);
      if (cleaned !== cfg.destination) cfg.destination = cleaned;
    }
    const intentInfo = detectIntent({ origin: cfg.origin, destination: originalDestination, apptTime, cuisine: cfg.cuisine, intent: cfg.intent });
    const externalMapsUrl = buildGoogleMapsExternalUrl(cfg, intentInfo);
    renderExternalMapsQR(externalMapsUrl, intentInfo);

    if (intentInfo.isNearbyFood) {
      statusEl.textContent = 'Loading nearby restaurants…';
      try {
        const foodUrl = `/api/staticmap/food?origin=${encodeURIComponent(cfg.origin)}${intentInfo.cuisine?`&cuisine=${encodeURIComponent(intentInfo.cuisine)}`:''}${mockMode?'&mock=true':''}`;
        const foodResp = await fetch(foodUrl); const foodData = await foodResp.json().catch(()=>({}));
        if (foodResp.ok && foodData.results?.length) {
          const list = foodData.results; foodEl.style.display='block';
          const clusterInfo = foodData.clusterDistance?.text ? `<div class='cluster-meta'>Approx cluster distance: ${foodData.clusterDistance.text}</div>` : '';
          const sourceBadge = foodData.source==='cache'?"<span style='font-size:11px;opacity:.6'>(cache)</span>":'';
          foodEl.innerHTML = `<div class='panel-title'>Nearby ${intentInfo.cuisine || 'restaurants'} (${list.length}) ${sourceBadge}</div>` + clusterInfo +
            list.map(r=>`<div class='restaurant-item'>• <strong>${r.name}</strong>${r.rating?` ⭐ ${r.rating}`:''}${r.user_ratings_total?` (${r.user_ratings_total})`:''}<br/><span style='opacity:.8'>${r.vicinity||''}</span></div>`).join('');
          summaryEl.innerHTML = `<strong>${cfg.origin}</strong><br/>Nearby ${intentInfo.cuisine || 'restaurants'}`;
          await loadStaticFoodMap(cfg, intentInfo, list.length);
        } else {
          const ps = foodData?.providerStatus || foodData?.error || 'UNKNOWN';
          const list = getMockRestaurants(intentInfo.cuisine); foodEl.style.display='block';
          foodEl.innerHTML = `<div class='panel-title'>Nearby ${intentInfo.cuisine || 'food'} (mock)</div>` + list.map(r=>`<div class='restaurant-item'>• ${r}</div>`).join('');
          summaryEl.innerHTML = `<strong>${cfg.origin}</strong><br/>Mock ${intentInfo.cuisine || 'restaurants'} (API ${ps})`;
          statusEl.innerHTML = `<div class='warn'>Places API fallback (${ps})</div>`;
          await loadStaticFoodMap(cfg, intentInfo, list.length);
        }
      } catch (e) {
        const list = getMockRestaurants(intentInfo.cuisine); foodEl.style.display='block';
        foodEl.innerHTML = `<div class='panel-title'>Nearby ${intentInfo.cuisine || 'food'} (mock)</div>` + list.map(r=>`<div class='restaurant-item'>• ${r}</div>`).join('');
        summaryEl.innerHTML = `<strong>${cfg.origin}</strong><br/>Mock ${intentInfo.cuisine || 'restaurants'} (exception)`;
        statusEl.innerHTML = `<div class='warn'>Exception loading Places: ${e.message}</div>`;
        await loadStaticFoodMap(cfg, intentInfo, list.length);
      }
      statusEl.textContent='Ready'; statusEl.classList.remove('loading');
      if (typeof window.hideLoadingSplash==='function') window.hideLoadingSplash('Nearby food ready');
      return;
    }

    // Travel / Appointment path
    let leg; let trafficData=null; let routeFetched=false; let providerStatus=null;
    const cleanedTravelDest = cfg.destination ? cfg.destination.replace(/^\s*(drive|go|travel)\s+to\s+/i,'').trim() : cfg.destination;

    if (!interactiveEnabled) {
      try {
        statusEl.textContent='Fetching route…';
        const proxyUrl = `/api/directions?origin=${encodeURIComponent(cfg.origin)}&destination=${encodeURIComponent(cleanedTravelDest)}&mode=${encodeURIComponent(cfg.mode)}&lang=${encodeURIComponent(cfg.lang)}${mockMode?'&mock=true':''}`;
        const resp = await fetch(proxyUrl); const data = await resp.json().catch(()=>({})); providerStatus = data.providerStatus || null;
        if (!resp.ok) throw new Error(`Directions error (${providerStatus||'UNKNOWN'})`);
        leg = { start_address:data.origin, end_address:data.destination, distance:data.distance, duration:data.duration }; routeFetched=true;
        if (cfg.traffic) {
          try { const mUrl = `/api/matrix?origin=${encodeURIComponent(cfg.origin)}&destination=${encodeURIComponent(cleanedTravelDest)}&mode=${encodeURIComponent(cfg.mode)}&lang=${encodeURIComponent(cfg.lang)}${mockMode?'&mock=true':''}`;
            const mResp = await fetch(mUrl); const mData = await mResp.json().catch(()=>({})); if (mResp.ok) trafficData=mData; } catch (e){ console.warn('Matrix exception', e.message); }
        }
      } catch (e) { console.warn('Proxy route failed:', e.message); }
    }

    if (!routeFetched && interactiveEnabled && mapCtl) {
      try { const result = await mapCtl.route(cfg.mode); if (result?.routes?.length) { leg = result.routes[0].legs[0]; providerStatus='OK'; routeFetched=true; } } catch (e) { console.warn('Interactive route failed:', e.message); }
    }

    if (!routeFetched) { leg = { start_address: cfg.origin, end_address: cfg.destination, distance:{ text:'120 km', value:120000 }, duration:{ text:'1 hour 25 mins', value:5100 } }; if (!providerStatus) providerStatus='MOCK_FALLBACK'; }

    const baseSummary = trafficData && trafficData.durationInTraffic
      ? `<strong>${leg.start_address}</strong> → <strong>${leg.end_address}</strong><br/>Distance: ${leg.distance.text} | Base: ${leg.duration.text} | Traffic: ${trafficData.durationInTraffic.text}`
      : `<strong>${leg.start_address}</strong> → <strong>${leg.end_address}</strong><br/>Distance: ${leg.distance.text} | Duration: ${leg.duration.text}`;
    summaryEl.innerHTML = baseSummary + (providerStatus ? `<br/><span style='font-size:11px;opacity:.6'>providerStatus: ${providerStatus}</span>` : '');

    // Appointment enrichment (removed from summary to avoid duplication for minimalist panel)
    if (intentInfo.intent === 'AppointmentLeaveTime' && apptTime) {
      // Previously appended appointment details to summary; now skip to keep panel minimalist.
      // We could still compute plan if needed for other logic, but summary remains route-only.
    }

    // Static map selection
    if (intentInfo.intent === 'AppointmentLeaveTime' && apptTime) {
      await loadStaticAppointmentMap(cfg);
    } else {
      await loadStaticTravelMap(cfg);
    }

    // Appointment panel & overlay
    if (intentInfo.intent === 'AppointmentLeaveTime' && apptTime) {
      const durationSec = (trafficData?.durationInTraffic?.value) || (trafficData?.duration?.value) || (leg?.duration?.value) || 0;
      const plan = computeAppointmentPlan(apptTime, durationSec, cfg.bufferMin);
      apptEl.style.display='block';
      if (!plan.valid) {
        apptEl.innerHTML = `<div class='panel-title'>Appointment</div><div class='warn'>Invalid appointment time</div>`;
      } else {
        const departLocal = new Date(plan.departTimeISO).toLocaleTimeString();
        const apptLocal = new Date(plan.apptTimeISO).toLocaleTimeString();
        const statusClass = plan.status === 'Late' ? 'late' : (plan.status === 'LeaveNow' ? 'leave' : 'future');
        apptEl.innerHTML = `<div class='panel-title'>Appointment</div>` +
          `<div class='appt-row appt-important'>Appt: <span class='value'>${apptLocal}</span></div>` +
          `<div class='appt-row appt-important'>Depart: <span class='value'>${departLocal}</span></div>` +
          `<div class='appt-row appt-status' id='apptStatus'>Status: <span class='value status-val ${statusClass}'>${plan.status}</span></div>` +
          `<div class='appt-meta'>Travel ${Math.round(durationSec/60)}m • Buffer ${plan.bufferMin}m</div>`;
        function updateStatusOnly () {
          const now = Date.now();
          const leaveIn = Math.floor((new Date(plan.departTimeISO).getTime() - now)/1000);
          const apptIn = Math.floor((new Date(plan.apptTimeISO).getTime() - now)/1000);
          const statusEl2 = document.getElementById('apptStatus');
          if (!statusEl2) return;
          let statusTxt = plan.status;
          if (leaveIn <= 0 && apptIn > 0) statusTxt = 'LeaveNow';
          if (apptIn <= 0) statusTxt = 'Late';
          const sc = statusTxt === 'Late' ? 'late' : (statusTxt === 'LeaveNow' ? 'leave' : 'future');
          statusEl2.innerHTML = `Status: <span class='value status-val ${sc}'>${statusTxt}</span>`;
        }
        updateStatusOnly(); setInterval(updateStatusOnly, 30000);
        setupDepartOverlay(plan);
      }
    }

    statusEl.textContent='Ready'; statusEl.classList.remove('loading');
    if (typeof window.hideLoadingSplash==='function') window.hideLoadingSplash('Ready');
  } catch (err) {
    console.error(err); statusEl.classList.remove('loading'); statusEl.classList.add('error'); statusEl.textContent = 'Error: ' + err.message;
    if (!mapEl.querySelector('img')) mapEl.innerHTML = `<div style='padding:16px;color:#f77;font-size:14px'>Map unavailable</div>`;
    if (typeof window.hideLoadingSplash==='function') window.hideLoadingSplash('Error');
  }
})();
