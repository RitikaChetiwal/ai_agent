import { z } from "zod";
import { DateTime } from "luxon";


export const timeParseSchema = z.object({
  text: z.string(),
  now_iso: z.string().optional(),
  tz: z.string().default("Asia/Kolkata")
});

const weekdays = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];

export function timeParseHandler({ text, now_iso, tz }) {
  const now = now_iso ? DateTime.fromISO(now_iso, { zone: tz }) : DateTime.now().setZone(tz);
  const lower = text.trim().toLowerCase();

    // explicit date like "31st october 3:58 pm ist" (optional year)
  {
    const monthMap = {
      jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
      apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
      aug: 8, august: 8, sep: 9, sept: 9, september: 9,
      oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
    };

    // allow optional "on"/"at", ordinal (st/nd/rd/th), optional year, optional "ist"
    const m = lower.match(
      /(?:on\s+|at\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(\d{4}))?(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*ist)?\b/
    );
    if (m) {
      const [, dayStr, monStr, yearStr, hourStr, minStr, apStr] = m;
      const day = parseInt(dayStr, 10);
      const month = monthMap[monStr];
      let year = yearStr ? parseInt(yearStr, 10) : now.year;

      let hour = parseInt(hourStr, 10);
      const minute = minStr ? parseInt(minStr, 10) : 0;
      if (apStr) {
        const ap = apStr.toLowerCase();
        if (ap === "pm" && hour < 12) hour += 12;
        if (ap === "am" && hour === 12) hour = 0;
      }

      let dt = DateTime.fromObject(
        { year, month, day, hour, minute, second: 0, millisecond: 0 },
        { zone: tz }
      );

      // If no year given and the time is already past, assume next year.
      if (!yearStr && dt < now) {
        dt = dt.plus({ years: 1 });
      }

      if (dt.isValid) {
        return { when_iso: dt.toISO(), confidence: 0.98 };
      }
    }
  }

  // in N minutes/hours
  let m = lower.match(/^in\s+(\d+)\s*(min|mins|minute|minutes|hour|hours)$/);
  if (m) {
    const n = parseInt(m[1], 10);
    const unit = m[2].startsWith("hour") ? "hours" : "minutes";
    const dt = now.plus({ [unit]: n });
    return { when_iso: dt.toISO(), confidence: 0.95 };
  }

  // tomorrow HH[:MM][am|pm]?
  m = lower.match(/^tomorrow\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (m) {
    let h = parseInt(m[1], 10);
    const mm = m[2] ? parseInt(m[2], 10) : 0;
    const ap = m[3];
    if (ap) {
      if (ap === "pm" && h < 12) h += 12;
      if (ap === "am" && h === 12) h = 0;
    }
    const dt = now.plus({ days: 1 }).set({ hour: h, minute: mm, second: 0, millisecond: 0 });
    return { when_iso: dt.toISO(), confidence: 0.9 };
  }

  // next weekday HH[:MM]?
  m = lower.match(/^next\s+([a-z]+)(?:\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/);
  if (m) {
    const wd = m[1];
    const idx = weekdays.indexOf(wd);
    if (idx >= 0) {
      let target = now;
      const daysAhead = (idx + 7 - now.weekday % 7) || 7;
      target = target.plus({ days: daysAhead });
      let hour = 9, minute = 0; // default 9:00 if not provided
      if (m[2]) {
        hour = parseInt(m[2], 10);
        minute = m[3] ? parseInt(m[3], 10) : 0;
        const ap = m[4];
        if (ap) {
          if (ap === "pm" && hour < 12) hour += 12;
          if (ap === "am" && hour === 12) hour = 0;
        }
      }
      target = target.set({ hour, minute, second: 0, millisecond: 0 });
      return { when_iso: target.toISO(), confidence: 0.85 };
    }
  }

  // explicit HH:MM am/pm today or tomorrow guess
  m = lower.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (m) {
    let h = parseInt(m[1], 10);
    const mm = m[2] ? parseInt(m[2], 10) : 0;
    const ap = m[3];
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    let dt = now.set({ hour: h, minute: mm, second: 0, millisecond: 0 });
    if (dt < now) dt = dt.plus({ days: 1 }); // if time already passed today, choose tomorrow
    return { when_iso: dt.toISO(), confidence: 0.8 };
  }

  return { error: "ambiguous_time" };
}

export const timeParse = {
  name: "time_parse",
  schema: timeParseSchema,
  handler: timeParseHandler,
  description: "Resolve natural language time to ISO timestamp in a timezone (defaults to Asia/Kolkata)."
};

// src/tools/timeParse.js


/**
 * Helpers
 */
function pickTimezone(tz) {
  try {
    // sanity check IANA TZ
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format();
    return tz;
  } catch {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  }
}

function parseExplicitAmPm(text) {
  // e.g. 12:59:06 PM, 9 pm, 09:05am, 7:3 pm (we'll normalize)
  const m = text.match(/\b(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?\s*(am|pm)\b/i);
  if (!m) return null;
  let [_, hh, mm, ss, ap] = m;
  let H = parseInt(hh, 10);
  const M = parseInt(mm ?? "0", 10);
  const S = parseInt(ss ?? "0", 10);
  ap = ap.toLowerCase();

  // normalize hour
  if (ap === "am") {
    H = (H % 12);            // 12am -> 0
  } else {
    H = (H % 12) + 12;       // 12pm -> 12, 1pm -> 13, etc.
  }
  return { H, M, S, apRaw: ap, matched: m[0] };
}

function windowJustBeforeAfter(text) {
  // "just before 1 pm", "just after 8:30 am"
  const m = text.match(/just\s+(before|after)\s+(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)\b/i);
  if (!m) return null;
  const dir = m[1].toLowerCase(); // before | after
  let H = parseInt(m[2], 10);
  const M = parseInt(m[3] ?? "0", 10);
  const ap = m[4].toLowerCase();

  // normalize base hour for the reference time
  if (ap === "am") H = (H % 12);
  else H = (H % 12) + 12;

  // We want a time very near the ref:
  // - "just before 1 pm" -> 12:59:xx
  // - "just after 1 pm"  -> 13:00:xx
  if (dir === "before") {
    // if there are minutes on ref, subtract a few seconds
    let date = new Date();
    date.setHours(H, M, 0, 0);
    date = new Date(date.getTime() - 10 * 1000); // 10 seconds before
    return { H: date.getHours(), M: date.getMinutes(), S: date.getSeconds() };
  } else {
    let date = new Date();
    date.setHours(H, M, 0, 0);
    date = new Date(date.getTime() + 10 * 1000); // 10 seconds after
    return { H: date.getHours(), M: date.getMinutes(), S: date.getSeconds() };
  }
}

function meridiemFromWords(text) {
  const t = text.toLowerCase();
  if (/\bmorning\b/.test(t)) return "am";
  if (/\bafternoon\b/.test(t)) return "pm";
  if (/\bevening\b/.test(t)) return "pm";
  if (/\bnight\b/.test(t)) return "pm";
  return null;
}

function buildISO({ year, month, day, H, M, S, tz }) {
  // Build as local in tz. Using Intl alone can’t format ISO with offset reliably,
  // so we construct in system tz and then adjust by calculating the tz offset at that instant.
  const sys = new Date();
  const when = new Date(sys.getFullYear(), sys.getMonth(), sys.getDate(), H, M, S, 0);

  // if a different day is requested, shift it
  when.setFullYear(year, month - 1, day);

  // Compute offset for requested tz at that instant
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
  // Parse parts to get wall time in tz and then derive offset vs UTC by difference
  const parts = fmt.formatToParts(when).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
  // Recompose "YYYY-MM-DDTHH:mm:ss" in tz wall time:
  const wall = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  const wallDate = new Date(wall + "Z"); // interpret as UTC first
  // Now find real UTC instant that displays as "wall" in tz:
  const displayed = new Date(fmt.format(when)); // this is a string in local TZ locale, not reliable to parse
  // Simpler: compute offset by measuring difference between wall (treated as UTC) and actual instant
  const offsetMs = wallDate.getTime() - when.getTime();
  const real = new Date(when.getTime() - offsetMs);

  // Format with numeric offset like +05:30
  const offMin = -real.getTimezoneOffset(); // system tz offset; not precise for other tz
  // To avoid system-offset confusion, we fallback to using the original "when" in local system tz
  // and append offset string of the *requested tz* using DateTimeFormat; but JS can't give it directly.
  // Practical compromise: return ISO without Z, plus explicit tz field.
  const iso = real.toISOString(); // UTC ISO
  return { iso, tz };
}

/**
 * Exports
 */
export const name = "time_parse";
export const description = "Parse a natural-language time expression into an ISO timestamp for today by default.";
export const schema = z.object({
  text: z.string().describe("The human-readable time expression, e.g. 'tomorrow 7am' or 'just before 1 pm'"),
  now_iso: z.string().optional().describe("Optional ISO to interpret relative time from; defaults to now."),
  tz: z.string().optional().describe("IANA time zone, e.g. 'Asia/Kolkata'. Defaults to system time zone.")
});

export async function handler({ text, now_iso, tz }) {
  const raw = String(text || "");
  const t = raw.trim();
  const zone = pickTimezone(tz);

  // 1) Handle "just before/after X am/pm"
  const near = windowJustBeforeAfter(t);
  if (near) {
    const base = now_iso ? new Date(now_iso) : new Date();
    const Y = base.getFullYear(), M0 = base.getMonth() + 1, D = base.getDate();
    const out = buildISO({ year: Y, month: M0, day: D, H: near.H, M: near.M, S: near.S, tz: zone });
    return { when_iso: out.iso, confidence: 0.95, tz: zone };
  }

  // 2) Explicit AM/PM time → not ambiguous
  const expl = parseExplicitAmPm(t);
  if (expl) {
    const base = now_iso ? new Date(now_iso) : new Date();
    const Y = base.getFullYear(), M0 = base.getMonth() + 1, D = base.getDate();
    const out = buildISO({ year: Y, month: M0, day: D, H: expl.H, M: expl.M, S: expl.S, tz: zone });
    return { when_iso: out.iso, confidence: 0.98, tz: zone };
  }

  // 3) If no AM/PM but meridiem words exist, bias accordingly for HH(:mm)(:ss)
  const mWords = meridiemFromWords(t);
  const m24 = t.match(/\b(\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?\b/);
  if (m24) {
    let H = parseInt(m24[1], 10);
    const M = parseInt(m24[2] ?? "0", 10);
    const S = parseInt(m24[3] ?? "0", 10);

    if (H <= 12 && mWords) {
      if (mWords === "am") H = (H % 12);
      else H = (H % 12) + 12;
      const base = now_iso ? new Date(now_iso) : new Date();
      const Y = base.getFullYear(), MM = base.getMonth() + 1, D = base.getDate();
      const out = buildISO({ year: Y, month: MM, day: D, H, M, S, tz: zone });
      return { when_iso: out.iso, confidence: 0.8, tz: zone };
    }
  }

  // 4) If we reach here, we really can’t be sure → ask for confirmation
  return { error: "ambiguous_time" };
}
