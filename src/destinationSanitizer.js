// Helper to sanitize destination string for routing when appointment phrase is embedded.
// Example: "Doctor appointment at 11:30am in 1805 Deer Drive PA" -> "1805 Deer Drive PA"
export function sanitizeDestinationForRouting (destination, apptTimeISO) {
  if (!destination) return destination;
  let src = String(destination);
  // Updated pattern: allow compact times (\d{3,4}) with am/pm
  const timePattern = /(doctor|dentist|appointment|meeting)[^\n]{0,80}?\b(at|@)\s*(?:\d{1,2}[:\.][0-5]\d|\d{3,4})\s*(am|pm)?\s+in\s+(.+)/i;
  const m = src.match(timePattern);
  if (m) {
    const addr = m[4].trim();
    if (addr.length >= 5) return addr; // basic sanity length
  }
  // Alternate pattern with comma/hyphen after time
  const alt = /(doctor|dentist|appointment|meeting)[^\n]{0,80}?\b(at|@)\s*(?:\d{1,2}[:\.][0-5]\d|\d{3,4})\s*(am|pm)?[,\-]\s*(.+)/i;
  const m2 = src.match(alt);
  if (m2) {
    const addr = m2[4].trim();
    if (addr.length >= 5) return addr;
  }
  // If phrase starts with keyword + time then address words later, attempt heuristic splitting on ' in '
  if (/\b(doctor|dentist|appointment|meeting)\b/i.test(src) && /\b in \b/i.test(src)) {
    const parts = src.split(/\b in \b/i);
    if (parts.length >= 2) {
      const tail = parts[parts.length - 1].trim();
      if (tail.length >= 5) return tail;
    }
  }
  return src; // unchanged
}
