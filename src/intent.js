// Intent detection heuristics for prototype
// Returns { intent, cuisine, isNearbyFood }

const FOOD_KEYWORDS = ['restaurant', 'restaurants', 'italian', 'sushi', 'mexican', 'thai', 'indian'];
// Extend to support AppointmentLeaveTime intent
const APPT_KEYWORDS = ['appointment', 'doctor', 'dentist', 'meeting'];

export function detectIntent ({ destination, cuisine: forcedCuisine, intent: forcedIntent, apptTime }) {
  if (!destination && !forcedIntent) return { intent: 'Unknown', cuisine: forcedCuisine || null, isNearbyFood: false, isAppointment: false };
  const lower = (destination || '').toLowerCase();
  if (forcedIntent && forcedIntent === 'AppointmentLeaveTime') {
    return { intent: 'AppointmentLeaveTime', cuisine: null, isNearbyFood: false, isAppointment: true };
  }
  if (apptTime && (forcedIntent === 'AppointmentLeaveTime' || APPT_KEYWORDS.some(k => lower.includes(k)))) {
    return { intent: 'AppointmentLeaveTime', cuisine: null, isNearbyFood: false, isAppointment: true };
  }
  if (forcedCuisine) {
    return { intent: 'NearbyFood', cuisine: forcedCuisine.toLowerCase(), isNearbyFood: true, isAppointment: false };
  }
  if (FOOD_KEYWORDS.some(k => lower.includes(k))) {
    const cuisine = FOOD_KEYWORDS.find(k => lower.includes(k) && k !== 'restaurant' && k !== 'restaurants') || null;
    return { intent: 'NearbyFood', cuisine, isNearbyFood: true, isAppointment: false };
  }
  if (/\b(jfk|phl|ewr|lga)\b|airport/.test(lower)) {
    return { intent: 'TravelTime', cuisine: null, isNearbyFood: false, isAppointment: false };
  }
  return { intent: 'TravelTime', cuisine: null, isNearbyFood: false, isAppointment: false }; // default bias
}
