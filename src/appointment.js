// Appointment utilities
// computeAppointmentPlan(apptTimeISO, durationSec, bufferMin, nowDate = new Date())
// Returns { valid, apptTimeISO, durationSec, bufferMin, departTimeISO, leaveInSec, status }
export function computeAppointmentPlan (apptTimeISO, durationSec, bufferMin, nowDate = new Date()) {
  if (!apptTimeISO) return { valid: false, error: 'missing_apptTime' };
  const apptDate = new Date(apptTimeISO);
  if (isNaN(apptDate.getTime())) return { valid: false, error: 'invalid_apptTime' };
  const dur = Math.max(0, durationSec || 0);
  const buf = Math.max(0, bufferMin || 0);
  const departMs = apptDate.getTime() - dur * 1000 - buf * 60000;
  const now = nowDate.getTime();
  let status = 'Future';
  if (apptDate.getTime() <= now) status = 'Late';
  else if (departMs <= now) status = 'LeaveNow';
  const leaveInSec = Math.max(0, Math.floor((departMs - now) / 1000));
  return {
    valid: true,
    apptTimeISO: apptDate.toISOString(),
    durationSec: dur,
    bufferMin: buf,
    departTimeISO: new Date(departMs).toISOString(),
    leaveInSec,
    status
  };
}

