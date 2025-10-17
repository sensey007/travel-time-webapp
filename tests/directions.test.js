import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../server.js';

// Helper to mock global fetch
function mockFetchOnce (impl) {
  global.fetch = jest.fn().mockImplementation(impl);
}

describe('/api/directions', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV, MAPS_API_KEY: 'TEST_KEY' };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  test('400 when missing params', async () => {
    const res = await request(app).get('/api/directions');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/origin/);
  });

  test('500 when api key missing', async () => {
    process.env.MAPS_API_KEY = '';
    const res = await request(app).get('/api/directions?origin=A&destination=B');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/MAPS_API_KEY/);
  });

  test('returns simplified data on success', async () => {
    mockFetchOnce(async () => ({
      json: async () => ({
        status: 'OK',
        routes: [
          {
            overview_polyline: { points: 'abcd' },
            legs: [
              {
                start_address: 'A',
                end_address: 'B',
                distance: { text: '10 km', value: 10000 },
                duration: { text: '15 mins', value: 900 }
              }
            ],
            warnings: [],
            waypoint_order: []
          }
        ]
      })
    }));
    const res = await request(app).get('/api/directions?origin=A&destination=B');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OK');
    expect(res.body.origin).toBe('A');
    expect(res.body.destination).toBe('B');
    expect(res.body.polyline).toBe('abcd');
  });

  test('handles provider error', async () => {
    mockFetchOnce(async () => ({ json: async () => ({ status: 'ZERO_RESULTS', routes: [] }) }));
    const res = await request(app).get('/api/directions?origin=A&destination=B');
    expect(res.status).toBe(502);
    expect(res.body.providerStatus).toBe('ZERO_RESULTS');
  });

  test('mock mode with missing key returns OK', async () => {
    process.env.MAPS_API_KEY = '';
    const res = await request(app).get('/api/directions?origin=A&destination=B&mock=true');
    expect(res.status).toBe(200);
    expect(res.body.providerStatus).toBe('MOCK');
  });
});
