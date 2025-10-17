/* global google */
import { buildGoogleMapsScriptUrl } from './params.js';
import { decodePolyline } from './polyline.js';

export async function loadGoogleMaps (apiKey, lang = 'en') {
  if (window.google && window.google.maps) return window.google.maps;
  const url = buildGoogleMapsScriptUrl(apiKey, lang);
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Google Maps JS API'));
    document.head.appendChild(s);
  });
  return window.google.maps;
}

export function initMap (container, { origin, destination }) {
  const map = new google.maps.Map(container, { zoom: 7, center: { lat: 39.9526, lng: -75.1652 }, mapTypeControl: false, streetViewControl: false, fullscreenControl: false });
  const geocoder = new google.maps.Geocoder();
  const directionsService = new google.maps.DirectionsService();
  const directionsRenderer = new google.maps.DirectionsRenderer({ map });

  function geocodeIfLatLng (value) {
    if (!value) return Promise.resolve(null);
    const parts = value.split(',').map(p => p.trim());
    if (parts.length === 2 && parts.every(p => /^-?\d+(\.\d+)?$/.test(p))) {
      return Promise.resolve({ location: { lat: parseFloat(parts[0]), lng: parseFloat(parts[1]) }, formatted_address: value });
    }
    return new Promise((resolve, reject) => {
      geocoder.geocode({ address: value }, (results, status) => {
        if (status === 'OK' && results[0]) resolve(results[0]); else reject(new Error(`Geocode failed for '${value}': ${status}`));
      });
    });
  }

  async function route (mode) {
    const [o, d] = await Promise.all([geocodeIfLatLng(origin), geocodeIfLatLng(destination)]);
    const originLoc = o ? (o.geometry ? o.geometry.location : o.location) : null;
    const destLoc = d ? (d.geometry ? d.geometry.location : d.location) : null;
    if (!originLoc || !destLoc) throw new Error('Could not resolve origin or destination');
    return new Promise((resolve, reject) => {
      directionsService.route({ origin: originLoc, destination: destLoc, travelMode: mode.toUpperCase() }, (result, status) => {
        if (status === 'OK') { directionsRenderer.setDirections(result); resolve(result); } else { reject(new Error(`Directions request failed: ${status}`)); }
      });
    });
  }

  return { map, route, directionsRenderer, decodePolyline };
}
