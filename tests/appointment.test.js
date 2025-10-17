import { computeAppointmentPlan } from '../src/appointment.js';

describe('computeAppointmentPlan', () => {
  test('future appointment yields Future status', () => {
    const now = new Date('2030-01-01T09:00:00Z');
    const plan = computeAppointmentPlan('2030-01-01T11:00:00Z', 3600, 15, now); // 1h travel +15m buffer
    expect(plan.valid).toBe(true);
    expect(plan.status).toBe('Future');
    // depart at 11:00 - 1h -15m = 09:45, which is > now 09:00
    expect(new Date(plan.departTimeISO).toISOString()).toBe('2030-01-01T09:45:00.000Z');
  });
  test('leave now window', () => {
    const now = new Date('2030-01-01T09:40:00Z');
    const plan = computeAppointmentPlan('2030-01-01T10:00:00Z', 900, 5, now); // 15m travel +5m buffer => need 20m lead -> depart 09:40
    expect(plan.status).toBe('LeaveNow');
  });
  test('late status', () => {
    const now = new Date('2030-01-01T10:05:00Z');
    const plan = computeAppointmentPlan('2030-01-01T10:00:00Z', 600, 0, now);
    expect(plan.status).toBe('Late');
  });
  test('invalid apptTime', () => {
    const plan = computeAppointmentPlan('not-a-date', 1000, 10);
    expect(plan.valid).toBe(false);
  });
});

