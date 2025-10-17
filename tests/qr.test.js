import request from 'supertest';
import app from '../server.js';

describe('/api/qr', () => {
  test('requires url param', async () => {
    const res = await request(app).get('/api/qr');
    expect(res.status).toBe(400);
  });
  test('returns dataUrl', async () => {
    const res = await request(app).get('/api/qr?url=https%3A%2F%2Fexample.com');
    expect(res.status).toBe(200);
    expect(res.body.dataUrl.startsWith('data:image/png')).toBe(true);
  });
});

