// Intent detection heuristics for prototype
// Returns { intent, cuisine, isNearbyFood }

const FOOD_KEYWORDS = ['restaurant', 'restaurants', 'italian', 'sushi', 'mexican', 'thai', 'indian'];
// Extend to support AppointmentLeaveTime intent
const APPT_KEYWORDS = ['appointment', 'doctor', 'dentist', 'meeting'];

export function detectIntent ({ origin, destination, cuisine: forcedCuisine, intent: forcedIntent, apptTime }) {
  const originLower = (origin || '').toLowerCase();
  const destLower = (destination || '').toLowerCase();
  const combinedLower = (destLower + ' ' + originLower).trim();
  // Forced intent overrides
  if (forcedIntent === 'AppointmentLeaveTime') {
    return { intent: 'AppointmentLeaveTime', cuisine: null, isNearbyFood: false, isAppointment: true };
  }
  // Appointment: if we have apptTime and any appointment keyword in destination OR origin
  if (apptTime && APPT_KEYWORDS.some(k => destLower.includes(k) || originLower.includes(k))) {
    return { intent: 'AppointmentLeaveTime', cuisine: null, isNearbyFood: false, isAppointment: true };
  }
  // Nearby food forced cuisine
  if (forcedCuisine) {
    return { intent: 'NearbyFood', cuisine: forcedCuisine.toLowerCase(), isNearbyFood: true, isAppointment: false };
  }
  // Food keywords (search combined to allow origin-only phrases but still bias destination)
  if (FOOD_KEYWORDS.some(k => destLower.includes(k))) {
    const cuisine = FOOD_KEYWORDS.find(k => destLower.includes(k) && k !== 'restaurant' && k !== 'restaurants') || null;
    return { intent: 'NearbyFood', cuisine, isNearbyFood: true, isAppointment: false };
  }
  // If no destination but origin contains appointment keywords and apptTime
  if (!destination && apptTime && APPT_KEYWORDS.some(k => originLower.includes(k))) {
    return { intent: 'AppointmentLeaveTime', cuisine: null, isNearbyFood: false, isAppointment: true };
  }
  // Airport / travel heuristics
  if (/\b(jfk|phl|ewr|lga)\b|airport/.test(destLower)) {
    return { intent: 'TravelTime', cuisine: null, isNearbyFood: false, isAppointment: false };
  }
  if (!destination && !origin) {
    return { intent: 'Unknown', cuisine: forcedCuisine || null, isNearbyFood: false, isAppointment: false };
  }
  return { intent: 'TravelTime', cuisine: null, isNearbyFood: false, isAppointment: false }; // default bias
}
