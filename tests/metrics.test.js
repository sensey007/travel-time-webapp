import request from 'supertest';
import app from '../server.js';
import { jest } from '@jest/globals';

// Mock fetch for directions/matrix to avoid external calls
beforeEach(() => {
  global.fetch = jest.fn().mockImplementation(async (url) => {
    if (url.includes('directions')) {
      return { json: async () => ({ status: 'OK', routes: [ { overview_polyline: { points: 'abcd' }, legs: [ { start_address: 'A', end_address: 'B', distance: { text: '1 km', value: 1000 }, duration: { text: '2 mins', value: 120 } } ] } ] }) };
    }
    if (url.includes('distancematrix')) {
      return { json: async () => ({ status: 'OK', origin_addresses: ['A'], destination_addresses: ['B'], rows: [ { elements: [ { status: 'OK', distance: { text: '1 km', value: 1000 }, duration: { text: '2 mins', value: 120 }, duration_in_traffic: { text: '3 mins', value: 180 } } ] } ] }) };
    }
    return { json: async () => ({ status: 'OK' }) };
  });
  process.env.MAPS_API_KEY = 'TEST_KEY';
  process.env.RATE_LIMIT_MAX = '3';
});

describe('/metrics & rate limiting', () => {
  test('metrics increments and rate limiting triggers', async () => {
    // 3 allowed
    await request(app).get('/api/directions?origin=A&destination=B');
    await request(app).get('/api/directions?origin=A&destination=B');
    await request(app).get('/api/directions?origin=A&destination=B');
    // 4th should 429
    const limited = await request(app).get('/api/directions?origin=A&destination=B');
    expect(limited.status).toBe(429);
    const metricsRes = await request(app).get('/metrics');
    expect(metricsRes.status).toBe(200);
    expect(metricsRes.body.directionsCalls).toBe(3);
    expect(metricsRes.body.rateLimited).toBeGreaterThanOrEqual(1);
    expect(metricsRes.body.byPath['/api/directions']).toBeGreaterThanOrEqual(4);
  });
});

