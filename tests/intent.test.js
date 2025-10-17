import { detectIntent } from '../src/intent.js';

describe('detectIntent', () => {
  test('nearby food intent', () => {
    const r = detectIntent({ destination: 'best italian restaurants near me' });
    expect(r.intent).toBe('NearbyFood');
    expect(r.isNearbyFood).toBe(true);
    expect(r.cuisine).toBe('italian');
  });
  test('airport travel intent', () => {
    const r = detectIntent({ destination: 'Drive to JFK Airport' });
    expect(r.intent).toBe('TravelTime');
  });
  test('default travel intent', () => {
    const r = detectIntent({ destination: 'Random Place' });
    expect(r.intent).toBe('TravelTime');
  });
  test('forced appointment intent via intent parameter', () => {
    const r = detectIntent({ destination: 'Doctor Appointment', intent: 'AppointmentLeaveTime', apptTime: '2030-01-01T10:00:00Z' });
    expect(r.intent).toBe('AppointmentLeaveTime');
    expect(r.isAppointment).toBe(true);
  });
  test('appointment intent via keyword + apptTime', () => {
    const r = detectIntent({ destination: 'Doctor visit', apptTime: '2030-01-01T10:00:00Z' });
    expect(r.intent).toBe('AppointmentLeaveTime');
  });
});
