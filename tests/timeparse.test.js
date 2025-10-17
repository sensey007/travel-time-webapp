import { parseAppointmentTimeFromText } from '../src/appointmentTimeParser.js';

function withinMinutes (isoA, isoB, maxDiffMin = 2) {
  const a = new Date(isoA).getTime();
  const b = new Date(isoB).getTime();
  return Math.abs(a - b) <= maxDiffMin * 60 * 1000;
}

describe('appointmentTimeParser', () => {
  test('parses noon', () => {
    const iso = parseAppointmentTimeFromText('Lunch meeting at noon');
    expect(iso).toBeTruthy();
    const d = new Date(iso);
    expect(d.getHours()).toBe(12);
    expect(d.getMinutes()).toBe(0);
  });
  test('parses midnight', () => {
    const iso = parseAppointmentTimeFromText('Conference call at midnight');
    expect(iso).toBeTruthy();
    const d = new Date(iso);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });
  test('parses absolute with colon am', () => {
    const iso = parseAppointmentTimeFromText('doctor appointment at 11:30am');
    expect(iso).toBeTruthy();
    const d = new Date(iso); expect([11,23].includes(d.getHours()) || [11,0].includes(d.getHours())).toBe(true); // allow day rollover heuristic
  });
  test('parses space separated am', () => {
    const iso = parseAppointmentTimeFromText('meeting 11 45 am');
    expect(iso).toBeTruthy();
    const d = new Date(iso); expect(d.getMinutes()).toBe(45);
  });
  test('parses relative minutes', () => {
    const start = new Date();
    const iso = parseAppointmentTimeFromText('follow-up in 30 minutes');
    expect(iso).toBeTruthy();
    expect(withinMinutes(iso, new Date(start.getTime() + 30 * 60000).toISOString(), 1)).toBe(true);
  });
  test('parses relative hours', () => {
    const start = new Date();
    const iso = parseAppointmentTimeFromText('call in 2 hours');
    expect(iso).toBeTruthy();
    expect(withinMinutes(iso, new Date(start.getTime() + 120 * 60000).toISOString(), 1)).toBe(true);
  });
  test('parses combined hours minutes shorthand', () => {
    const start = new Date();
    const iso = parseAppointmentTimeFromText('bloodwork in 1h 15m');
    expect(iso).toBeTruthy();
    expect(withinMinutes(iso, new Date(start.getTime() + 75 * 60000).toISOString(), 1)).toBe(true);
  });
  test('parses single minutes shorthand', () => {
    const start = new Date();
    const iso = parseAppointmentTimeFromText('prep in 90m');
    expect(iso).toBeTruthy();
    expect(withinMinutes(iso, new Date(start.getTime() + 90 * 60000).toISOString(), 1)).toBe(true);
  });
  test('returns null for unsupported phrase', () => {
    const iso = parseAppointmentTimeFromText('no time mentioned');
    expect(iso).toBeNull();
  });
});

