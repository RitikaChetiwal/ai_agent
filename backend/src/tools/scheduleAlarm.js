// src/tools/scheduleAlarm.js
import { z } from "zod";
import { DateTime } from "luxon";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../utils/logger.js";
import { bus } from "../utils/bus.js"; // <-- emit 'alarm' so UI can ring
import { ScheduledJob } from "../models/ScheduledJob.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve to your repo's backend/data/alarms.json reliably
const FILE = path.resolve(__dirname, "../../data/alarms.json");

// In-memory timers (id -> NodeJS.Timeout)
const timers = new Map();

// Build a registry instance for this module
// const tools = buildTools();

// ---------- storage helpers ----------
function load() {
  try {
    if (!fs.existsSync(FILE)) return [];
    const raw = fs.readFileSync(FILE, "utf-8");
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function save(list) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2), "utf-8");
}

// Single source of truth in memory
const alarms = load(); // [{id, when_iso, channel, message, delivered, delivered_at?}]

// ---------- scheduling ----------
function scheduleTimer(alarm) {
  const now = DateTime.now();
  const when = DateTime.fromISO(alarm.when_iso);
  const ms = when.toMillis() - now.toMillis();
  if (!when.isValid) return;
  if (ms <= 0) return;

  // avoid double timers
  if (timers.has(alarm.id)) clearTimeout(timers.get(alarm.id));

  const t = setTimeout(() => {
    try {
      logger.info("ALARM FIRING:", alarm.id, alarm.message);

      // If an automation payload was attached, execute it first
      if (alarm?.payload?.tool) {
        (async () => {
          try {
            // Lazy-load buildTools at runtime to avoid circular import
            const { buildTools } = await import("./index.js");
            const tools = buildTools();
            await tools.call(alarm.payload.tool, alarm.payload.args || {});
            logger.info(`Payload executed: ${alarm.payload.tool}`);
          } catch (e) {
            logger.error(`Payload failed: ${alarm.payload.tool}`, e);
          }
        })();
      }

      // mark delivered
      const idx = alarms.findIndex(a => a.id === alarm.id);
      if (idx !== -1) {
        alarms[idx].delivered = true;
        alarms[idx].delivered_at = DateTime.now().toISO();
        save(alarms);
      }

      // push to clients (SSE/WebSocket listeners)
      bus.emit("alarm", {
        id: alarm.id,
        when_iso: alarm.when_iso,
        message: alarm.message,
        channel: alarm.channel || "desktop",
        payload: alarm.payload || null 
      });
    } finally {
      timers.delete(alarm.id);
    }
  }, ms);

  timers.set(alarm.id, t);
}

// Reschedule all pending alarms on boot
function reschedulePending() {
  for (const a of alarms) {
    if (!a.delivered) scheduleTimer(a);
  }
}
reschedulePending();

async function onAlarmFire(alarm) {
  if (alarm.payload?.tool === "send_email") {
    await registry.call("send_email", alarm.payload.args);
  }
}
// (Removed onAlarmFire; we execute payload inline above)

// ---------- tool API ----------
export const scheduleAlarmSchema = z.object({
  when_iso: z.string().describe("ISO timestamp (UTC or with offset) when the alarm should fire."),
  channel: z.enum(["desktop", "push", "sms", "email"]).default("desktop"),
  message: z.string().default("Reminder"),
  // Optional: tool payload to run when alarm fires
  payload: z.object({
    tool: z.string(),
    args: z.record(z.any()).default({})
  }).optional()
});

export async function scheduleAlarmHandler({ when_iso, channel = "desktop", message = "Reminder", payload }) {
  const when = DateTime.fromISO(when_iso);
  if (!when.isValid) return { error: "invalid_time" };
  if (when < DateTime.now()) return { error: "past_time" };

  const job = await ScheduledJob.create({
    when_iso,
    tool: payload?.tool || "send_email",
    args: payload?.args || {},
  });

  return { scheduled: true, id: job._id.toString() };
}
export const listAlarms = () => alarms;

export const scheduleAlarm = {
  name: "schedule_alarm",
  schema: scheduleAlarmSchema,
  handler: scheduleAlarmHandler,
  description: "Schedule and deliver a reminder. Emits 'alarm' on the server event bus for the UI to ring."
};
