import { parseDeepLink, buildGoogleMapsScriptUrl } from '../src/params.js';

describe('parseDeepLink', () => {
  test('parses basic params', () => {
    const cfg = parseDeepLink('?origin=A&destination=B&mode=driving');
    expect(cfg.origin).toBe('A');
    expect(cfg.destination).toBe('B');
    expect(cfg.mode).toBe('driving');
    expect(cfg.warnings).toHaveLength(0);
  });
  test('invalid mode falls back', () => {
    const cfg = parseDeepLink('?origin=A&destination=B&mode=flying');
    expect(cfg.mode).toBe('driving');
    expect(cfg.warnings.some(w => w.includes('Invalid mode'))).toBe(true);
  });
  test('missing required params', () => {
    const cfg = parseDeepLink('?origin=A');
    expect(cfg.destination).toBeNull();
    expect(cfg.warnings.some(w => w.includes('destination'))).toBe(true);
  });
  test('qrThresholdMin default', () => {
    const cfg = parseDeepLink('?origin=A&destination=B');
    expect(cfg.qrThresholdMin).toBe(10);
  });
  test('qrThresholdMin custom', () => {
    const cfg = parseDeepLink('?origin=A&destination=B&qrThresholdMin=5');
    expect(cfg.qrThresholdMin).toBe(5);
  });
  test('appointment params parsed', () => {
    const cfg = parseDeepLink('?origin=A&destination=B&apptTime=2030-01-01T10:00:00Z&bufferMin=25&intent=AppointmentLeaveTime');
    expect(cfg.apptTime).toBe('2030-01-01T10:00:00Z');
    expect(cfg.bufferMin).toBe(25);
    expect(cfg.intent).toBe('AppointmentLeaveTime');
  });
});

describe('buildGoogleMapsScriptUrl', () => {
  test('builds url with key and language', () => {
    const url = buildGoogleMapsScriptUrl('KEY123', 'en');
    expect(url).toContain('KEY123');
    expect(url).toContain('language=en');
  });
  test('throws without key', () => {
    expect(() => buildGoogleMapsScriptUrl('', 'en')).toThrow();
  });
});
