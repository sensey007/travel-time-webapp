import request from 'supertest';
import app from '../server.js';

describe('server endpoints', () => {
  test('/healthz returns ok', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
  test('root serves html', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<!DOCTYPE html>/i);
    expect(res.text).toMatch(/Travel Time/);
  });
});

