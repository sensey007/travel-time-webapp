import request from 'supertest';
import app from '../server.js';

describe('SSR fallback & diagnostic modes', () => {
  test('SSR without params reports missing origin/destination', async () => {
    const res = await request(app).get('/tt?ssr=1');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Travel Time SSR Fallback');
    expect(res.text).toContain('Missing origin or destination');
  });

  test('SSR without API key returns no key message (directions intent)', async () => {
    const res = await request(app).get('/tt?ssr=1&origin=Philadelphia,PA&destination=New+York,NY');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Travel Time SSR Fallback');
    // Without MAPS_API_KEY it should show this generic message
    expect(res.text).toContain('No API key or unsupported intent for SSR');
  });

  test('Safe mode basic page', async () => {
    const res = await request(app).get('/tt?safe=1');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Travel Time Safe Mode');
    expect(res.text).toContain('MAPS_API_KEY');
  });

  test('Plain mode diagnostic page', async () => {
    const res = await request(app).get('/tt?plain=1');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Travel Time Diagnostic (Plain Mode)');
    expect(res.text).toContain('Has MAPS_API_KEY');
  });
});

