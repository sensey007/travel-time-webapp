import { jest } from '@jest/globals';
import request from 'supertest';
import app from '../server.js';

function mockFetchOnce (impl) {
  global.fetch = jest.fn().mockImplementation(impl);
}

describe('/api/matrix', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV, MAPS_API_KEY: 'TEST_KEY' };
  });
  afterAll(() => { process.env = OLD_ENV; });

  test('400 without required params', async () => {
    const res = await request(app).get('/api/matrix');
    expect(res.status).toBe(400);
  });

  test('500 when api key missing', async () => {
    process.env.MAPS_API_KEY = '';
    const res = await request(app).get('/api/matrix?origin=A&destination=B');
    expect(res.status).toBe(500);
  });

  test('success payload', async () => {
    mockFetchOnce(async () => ({
      json: async () => ({
        status: 'OK',
        origin_addresses: ['A'],
        destination_addresses: ['B'],
        rows: [ { elements: [ { status: 'OK', distance: { text: '10 km', value: 10000 }, duration: { text: '15 mins', value: 900 }, duration_in_traffic: { text: '17 mins', value: 1020 } } ] } ]
      })
    }));
    const res = await request(app).get('/api/matrix?origin=A&destination=B');
    expect(res.status).toBe(200);
    expect(res.body.durationInTraffic.text).toBe('17 mins');
  });

  test('provider error', async () => {
    mockFetchOnce(async () => ({ json: async () => ({ status: 'OVER_QUERY_LIMIT' }) }));
    const res = await request(app).get('/api/matrix?origin=A&destination=B');
    expect(res.status).toBe(502);
  });
});
