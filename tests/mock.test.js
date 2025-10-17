import request from 'supertest';
import app from '../server.js';

describe('mock mode endpoints', () => {
  beforeEach(() => {
    process.env.MAPS_API_KEY = ''; // ensure missing key
  });
  test('directions mock works without key', async () => {
    const res = await request(app).get('/api/directions?origin=A&destination=B&mock=true');
    expect(res.status).toBe(200);
    expect(res.body.providerStatus).toBe('MOCK');
  });
  test('matrix mock works without key', async () => {
    const res = await request(app).get('/api/matrix?origin=A&destination=B&mock=true');
    expect(res.status).toBe(200);
    expect(res.body.providerStatus).toBe('MOCK');
  });
  test('directions still 500 without mock', async () => {
    const res = await request(app).get('/api/directions?origin=A&destination=B');
    expect(res.status).toBe(500); // preserve original failure path
  });
});

