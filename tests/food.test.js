import request from 'supertest';
import app from '../server.js';
import { jest } from '@jest/globals';

function mockFetchSequence (responses) {
  let i = 0;
  global.fetch = jest.fn().mockImplementation(async (url) => {
    const r = responses[i] || responses[responses.length - 1];
    i++;
    return { json: async () => r };
  });
}

describe('/api/food', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV, MAPS_API_KEY: 'TEST_KEY' };
  });
  afterAll(() => { process.env = OLD_ENV; });

  test('400 without origin', async () => {
    const res = await request(app).get('/api/food');
    expect(res.status).toBe(400);
  });

  test('mock without key', async () => {
    process.env.MAPS_API_KEY = '';
    const res = await request(app).get('/api/food?origin=A&mock=true');
    expect(res.status).toBe(200);
    expect(res.body.providerStatus).toBe('MOCK');
  });

  test('success geocode + nearby', async () => {
    mockFetchSequence([
      { status: 'OK', results: [ { geometry: { location: { lat: 1, lng: 2 } } } ] }, // geocode
      { status: 'OK', results: [ { name: 'Test R', rating: 4.6, user_ratings_total: 50, vicinity: 'Addr', place_id: 'p1', geometry: { location: { lat: 1.001, lng: 2.001 } } } ] } // nearby
    ]);
    const res = await request(app).get('/api/food?origin=City&cuisine=italian');
    expect(res.status).toBe(200);
    expect(res.body.results[0].name).toBe('Test R');
  });

  test('geocode failure returns 502', async () => {
    mockFetchSequence([
      { status: 'ZERO_RESULTS', results: [] }
    ]);
    const res = await request(app).get('/api/food?origin=Nowhere');
    expect(res.status).toBe(502);
    expect(res.body.providerStatus).toBe('ZERO_RESULTS');
  });
});

