import request from 'supertest';
import app from '../server.js';

describe('Minimal Hello World page', () => {
  test('GET /tt?minimal=1 returns Hello World', async () => {
    const res = await request(app).get('/tt?minimal=1');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<h1>Hello World</h1>');
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });
});

