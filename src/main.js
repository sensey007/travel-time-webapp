/* global google */
import { parseDeepLink } from './params.js';
import { loadGoogleMaps, initMap } from './map.js';
import { detectIntent } from './intent.js';
import { getMockRestaurants } from './restaurants.js';
import { computeAppointmentPlan } from './appointment.js';

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
        `<div class='qr-box'><div style='font-size:12px;font-weight:600'>${label}</div><img alt='Google Maps QR' src='${data.dataUrl}'/><small>${externalUrl.replace(/^https?:\/\//,'').slice(0,60)}${externalUrl.length>60?'…':''}</small><small style='opacity:.5'>Scan to open native app / browser</small></div>` +
        `</div>`;
    }
  } catch { /* ignore */ }
}

(async function bootstrap () {
  const cfg = parseDeepLink(window.location.search);
  if (cfg.warnings.length) {
    statusEl.innerHTML = cfg.warnings.map(w => `<div class='warn'>${w}</div>`).join('');
  } else {
    statusEl.textContent = 'Loading map…';
  }
  if (!cfg.origin || !cfg.destination) {
    statusEl.classList.remove('loading');
    statusEl.classList.add('error');
    statusEl.innerHTML += '<div>Usage: ?origin=ADDRESS&destination=ADDRESS&mode=driving</div>';
    return;
  }
  try {
    const noMap = /[?&]noMap=1/.test(window.location.search);
    const injected = document.getElementById('gmaps-script-template').textContent;
    let injectedKey = null;
    try { injectedKey = JSON.parse(injected).key; } catch { /* ignore */ }
    const apiKey = injectedKey && injectedKey !== '__GOOGLE_MAPS_API_KEY__' ? injectedKey : cfg.apiKey;
    const mockMode = (!apiKey) && cfg.useProxy && /[?&]mock=true/.test(window.location.search);
    if (noMap) {
      mapEl.innerHTML = '<div style="padding:16px;color:#bbb;font-size:14px">Map disabled (noMap=1)</div>';
    } else {
      if (!apiKey && !mockMode) throw new Error('No Google Maps API key provided (server env MAPS_API_KEY or apiKey query param). For mock mode append &mock=true&useProxy=true or add noMap=1');
      if (!mockMode) {
        try {
          await loadGoogleMaps(apiKey, cfg.lang);
        } catch (e) {
          mapEl.innerHTML = '<div style="padding:16px;color:#f77;font-size:14px">Map load failed; using text mode</div>';
        }
      } else {
        mapEl.innerHTML = '<div style="padding:16px;color:#bbb;font-size:14px">Mock Map (no Google Maps API key)</div>';
      }
    }
    const mapCtl = (noMap || mockMode) ? { decodePolyline: () => [], map: null, route: async () => ({ routes: [ { legs: [ { start_address: cfg.origin, end_address: cfg.destination, distance: { text: '120 km', value: 120000 }, duration: { text: '1 hour 25 mins', value: 5100 } } ] } ] }) } : initMap(mapEl, cfg);

    const intentInfo = detectIntent(cfg);
    const externalMapsUrl = buildGoogleMapsExternalUrl(cfg, intentInfo);
    // For NearbyFood we can start external QR early (non-blocking)
    renderExternalMapsQR(externalMapsUrl, intentInfo);
    if (intentInfo.isNearbyFood) {
      statusEl.textContent = 'Loading nearby restaurants…';
      const suppressionMsg = `<div class='warn' style='margin-top:4px'>Route suppressed for NearbyFood intent</div>`;
      try {
        const foodUrl = `/api/food?origin=${encodeURIComponent(cfg.origin)}${intentInfo.cuisine ? `&cuisine=${encodeURIComponent(intentInfo.cuisine)}` : ''}${mockMode ? '&mock=true' : ''}`;
        const foodResp = await fetch(foodUrl);
        const foodData = await foodResp.json();
        if (foodResp.ok && foodData.results?.length) {
          const list = foodData.results;
          foodEl.style.display = 'block';
          const clusterInfo = foodData.clusterDistance?.text ? `<div class='cluster-meta'>Approx cluster distance: ${foodData.clusterDistance.text}</div>` : '';
          const sourceBadge = foodData.source === 'cache' ? "<span style='font-size:11px;opacity:.6'>(cache)</span>" : '';
          foodEl.innerHTML = `<div class='panel-title'>Nearby ${intentInfo.cuisine || 'restaurants'} (${list.length}) ${sourceBadge}</div>` + clusterInfo +
            list.map(r => `<div class='restaurant-item'>• <strong>${r.name}</strong>${r.rating ? ` ⭐ ${r.rating}` : ''}${r.user_ratings_total ? ` (${r.user_ratings_total})` : ''}<br/><span style='opacity:.8'>${r.vicinity || ''}</span></div>`).join('');
          // Map markers
          if (!mockMode && mapCtl.map && google?.maps) {
            const bounds = new google.maps.LatLngBounds();
            list.forEach(r => { if (r.location?.lat && r.location?.lng) { const pos = { lat: r.location.lat, lng: r.location.lng }; bounds.extend(pos); new google.maps.Marker({ map: mapCtl.map, position: pos, title: r.name }); } });
            if (foodData.clusterCenter?.lat && foodData.clusterCenter?.lng) {
              const cc = { lat: foodData.clusterCenter.lat, lng: foodData.clusterCenter.lng };
              bounds.extend(cc);
              new google.maps.Marker({ map: mapCtl.map, position: cc, title: 'Cluster Center', icon: { path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW, scale: 6, fillColor: '#4dabf7', fillOpacity: 0.95, strokeColor: '#1c7ed6', strokeWeight: 1 } });
              if (foodData.clusterDistance?.meters) {
                const radius = Math.min(Math.max(foodData.clusterDistance.meters, 200), 5000);
                new google.maps.Circle({ map: mapCtl.map, center: cc, radius, strokeColor: '#4dabf7', strokeOpacity: 0.6, strokeWeight: 1, fillColor: '#1971c2', fillOpacity: 0.08 });
              }
            }
            try { const geocoder = new google.maps.Geocoder(); geocoder.geocode({ address: cfg.origin }, (results, status) => { if (status === 'OK' && results[0]) { const loc = results[0].geometry.location; new google.maps.Marker({ map: mapCtl.map, position: loc, title: cfg.origin, icon: { path: google.maps.SymbolPath.CIRCLE, scale: 5, fillColor: '#51cf66', fillOpacity: 0.9, strokeColor: '#2b8a3e', strokeWeight: 1 } }); if (bounds.isEmpty()) bounds.extend(loc); } }); } catch {}
            if (!bounds.isEmpty()) { mapCtl.map.fitBounds(bounds); google.maps.event.addListenerOnce(mapCtl.map, 'bounds_changed', () => { if (mapCtl.map.getZoom() > 16) mapCtl.map.setZoom(16); }); }
          }
          summaryEl.innerHTML = `<strong>${cfg.origin}</strong><br/>Showing nearby ${intentInfo.cuisine || 'restaurants'}` + suppressionMsg;
        } else {
          const ps = foodData?.providerStatus || foodData?.error || 'UNKNOWN';
          const providerMsg = foodData?.providerRaw?.error_message;
          const list = getMockRestaurants(intentInfo.cuisine);
          foodEl.style.display = 'block';
          foodEl.innerHTML = `<div class='panel-title'>Nearby ${intentInfo.cuisine || 'food'} (mock)</div>` +
            list.map(r => `<div class='restaurant-item'>• ${r}</div>`).join('');
          summaryEl.innerHTML = `<strong>${cfg.origin}</strong><br/>Showing mock ${intentInfo.cuisine || 'restaurants'} (API error ${ps})` + suppressionMsg;
          statusEl.innerHTML = `<div class='warn'>Places API fallback (status ${ps})${providerMsg ? `: ${providerMsg}` : ''}</div>`;
        }
      } catch (e) {
        const list = getMockRestaurants(intentInfo.cuisine);
        foodEl.style.display = 'block';
        foodEl.innerHTML = `<div class='panel-title'>Nearby ${intentInfo.cuisine || 'food'} (mock)</div>` + list.map(r => `<div class='restaurant-item'>• ${r}</div>`).join('');
        summaryEl.innerHTML = `<strong>${cfg.origin}</strong><br/>Showing mock ${intentInfo.cuisine || 'restaurants'} (exception)` + suppressionMsg;
        statusEl.innerHTML = `<div class='warn'>Exception loading Places: ${e.message}</div>`;
      }
      statusEl.textContent = 'Ready';
      statusEl.classList.remove('loading');
      return;
    }

    let leg;
    let trafficData = null; // single fetch traffic info

    if (cfg.useProxy) {
      statusEl.textContent = 'Fetching route (server proxy)…';
      const proxyUrl = `/api/directions?origin=${encodeURIComponent(cfg.origin)}&destination=${encodeURIComponent(cfg.destination)}&mode=${encodeURIComponent(cfg.mode)}&lang=${encodeURIComponent(cfg.lang)}${mockMode ? '&mock=true' : ''}`;
      const resp = await fetch(proxyUrl);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const providerStatus = data.providerStatus || 'UNKNOWN';
        throw new Error(`Directions API error (providerStatus=${providerStatus})`);
      }
      leg = { start_address: data.origin, end_address: data.destination, distance: data.distance, duration: data.duration };
      if (data.polyline && window.google && mapCtl.map) {
        const path = mapCtl.decodePolyline(data.polyline).map(p => ({ lat: p.lat, lng: p.lng }));
        const poly = new google.maps.Polyline({ path, strokeColor: '#4285F4', strokeOpacity: 0.8, strokeWeight: 5 });
        poly.setMap(mapCtl.map);
        const bounds = new google.maps.LatLngBounds();
        path.forEach(pt => bounds.extend(pt));
        mapCtl.map.fitBounds(bounds);
      }
      if (cfg.traffic) {
        try {
          const mUrl = `/api/matrix?origin=${encodeURIComponent(cfg.origin)}&destination=${encodeURIComponent(cfg.destination)}&mode=${encodeURIComponent(cfg.mode)}&lang=${encodeURIComponent(cfg.lang)}${mockMode ? '&mock=true' : ''}`;
          const mResp = await fetch(mUrl);
          const mData = await mResp.json().catch(() => ({}));
          if (mResp.ok) trafficData = mData; else console.warn('Matrix error', mData);
        } catch (e) { /* ignore traffic error */ }
      }
    } else {
      const result = await mapCtl.route(cfg.mode);
      leg = result.routes[0].legs[0];
    }

    if (trafficData && trafficData.durationInTraffic) {
      const trafficTxt = trafficData.durationInTraffic.text;
      summaryEl.innerHTML = `<strong>${leg.start_address}</strong> → <strong>${leg.end_address}</strong><br/>Distance: ${leg.distance.text} | Base: ${leg.duration.text} | Traffic: ${trafficTxt}`;
    } else {
      summaryEl.innerHTML = `<strong>${leg.start_address}</strong> → <strong>${leg.end_address}</strong><br/>Distance: ${leg.distance.text} | Duration: ${leg.duration.text}`;
    }

    // For TravelTime intent, ensure external QR rendered (if not already)
    if (!intentInfo.isNearbyFood) {
      renderExternalMapsQR(externalMapsUrl, intentInfo);
    }

    // AppointmentLeaveTime handling
    if (intentInfo.intent === 'AppointmentLeaveTime' && cfg.apptTime) {
      const durationSec = (trafficData?.durationInTraffic?.value) || (trafficData?.duration?.value) || (leg?.duration?.value) || 0;
      const plan = computeAppointmentPlan(cfg.apptTime, durationSec, cfg.bufferMin);
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
  }
})();
