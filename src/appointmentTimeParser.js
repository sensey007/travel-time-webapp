// Appointment time parser supporting absolute times (11:30am), keywords (noon, midnight),
// and relative phrases (in 30 minutes, in 2 hours, in 1h 15m, in 90m).
// Returns ISO string or null.
export function parseAppointmentTimeFromText (text) {
  if (!text) return null;
  const now = new Date();
  const lower = String(text).toLowerCase();
  const isTomorrow = /\btomorrow\b/.test(lower);

  // --- Keyword handling ---
  if (/\bnoon\b/.test(lower)) {
    const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
    if (isTomorrow) candidate.setDate(candidate.getDate() + 1);
    if (!isTomorrow && candidate.getTime() < now.getTime() - 5 * 60 * 1000) candidate.setDate(candidate.getDate() + 1);
    return candidate.toISOString();
  }
  if (/\bmidnight\b/.test(lower)) {
    let candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    if (isTomorrow) {
      candidate.setDate(candidate.getDate() + 1);
    } else if (now.getTime() > candidate.getTime() + 5 * 60 * 1000) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate.toISOString();
  }

  // --- Absolute time patterns ---
  const r1 = /\b(\d{1,2})([:\.](\d{2}))\s*(am|pm)?\b/;
  let match = r1.exec(lower);
  if (!match) {
    const r2 = /\b(\d{1,2})\s+(\d{2})\s*(am|pm)\b/;
    const m2 = r2.exec(lower);
    if (m2) match = [m2[0], m2[1], ':' + m2[2], m2[2], m2[3]];
  }
  let simpleHour = null; let simpleSuffix = null;
  if (!match) {
    const r3 = /\b(\d{1,2})\s*(am|pm)\b/;
    const m3 = r3.exec(lower);
    if (m3) { simpleHour = parseInt(m3[1], 10); simpleSuffix = m3[2].toLowerCase(); }
    else {
      // If phrase contains relative indicator ' in ' then skip bare hour absolute heuristic.
      if (!lower.includes(' in ')) {
        // Require contextual 'at' to reduce false positives (e.g. street numbers)
        const r4 = /\bat\s+(\d{1,2})\b/;
        const m4 = r4.exec(lower);
        if (m4) simpleHour = parseInt(m4[1], 10);
      }
    }
  }
  if (match) {
    let hour = parseInt(match[1], 10);
    let minutes = parseInt(match[3], 10);
    const suffix = match[4] ? match[4].toLowerCase() : null;
    if (hour > 23 || minutes > 59) return null;
    if (suffix) {
      if (suffix === 'am' && hour === 12) hour = 0;
      if (suffix === 'pm' && hour < 12) hour += 12;
    } else {
      const nowHr = now.getHours();
      if (hour >= 1 && hour <= 7 && nowHr > hour + 1) hour = (hour + 12) % 24;
    }
    let candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minutes, 0, 0);
    if (isTomorrow) candidate.setDate(candidate.getDate() + 1);
    if (!isTomorrow && candidate.getTime() < now.getTime() - 5 * 60 * 1000) candidate.setDate(candidate.getDate() + 1);
    return candidate.toISOString();
  } else if (simpleHour != null) {
    if (simpleHour > 23) {
      // Invalid hour, allow fall-through to relative parsing instead of aborting.
    } else {
      let hour = simpleHour;
      if (simpleSuffix) {
        if (simpleSuffix === 'am' && hour === 12) hour = 0;
        if (simpleSuffix === 'pm' && hour < 12) hour += 12;
      } else {
        const nowHr = now.getHours();
        if (hour >= 1 && hour <= 7 && nowHr > hour + 1) hour = (hour + 12) % 24;
      }
      let candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0);
      if (isTomorrow) candidate.setDate(candidate.getDate() + 1);
      if (!isTomorrow && candidate.getTime() < now.getTime() - 5 * 60 * 1000) candidate.setDate(candidate.getDate() + 1);
      return candidate.toISOString();
    }
  }

  // --- Relative expressions ---
  // Look for 'in' then parse tokens following it.
  const inIndex = lower.indexOf(' in ');
  if (inIndex !== -1) {
    const after = lower.substring(inIndex + 4).trim();
    // Special natural language cases first
    if (/\bhalf (an )?hour\b/.test(after) || /\b(a )?half hour\b/.test(after)) {
      const candidate = new Date(now.getTime() + 30 * 60000);
      if (isTomorrow) candidate.setDate(candidate.getDate() + 1); // tomorrow relative
      return candidate.toISOString();
    }
    if (/\b(a )?quarter (of )?an? hour\b/.test(after) || /\bquarter hour\b/.test(after)) {
      const candidate = new Date(now.getTime() + 15 * 60000);
      if (isTomorrow) candidate.setDate(candidate.getDate() + 1);
      return candidate.toISOString();
    }
    // Token pattern: value + unit
    const tokenRegex = /(\d+)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/g;
    let totalMinutes = 0; let any = false; let token;
    while ((token = tokenRegex.exec(after)) !== null) {
      any = true;
      const val = parseInt(token[1], 10);
      const unit = token[2].toLowerCase();
      if (/^h(ours?|rs?)?$/.test(unit)) totalMinutes += val * 60; else totalMinutes += val;
    }
    if (any && totalMinutes > 0) {
      const candidate = new Date(now.getTime() + totalMinutes * 60000);
      if (isTomorrow) candidate.setDate(candidate.getDate() + 1);
      return candidate.toISOString();
    }
  }

  return null;
}
