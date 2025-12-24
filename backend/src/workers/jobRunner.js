// src/workers/jobRunner.js
import { DateTime } from "luxon";
import { ScheduledJob } from "../models/ScheduledJob.js";
import { buildTools } from "../tools/index.js";

export async function runDueJobs() {
  const now = DateTime.now();
  const due = await ScheduledJob.find({
    delivered: false,
    when_iso: { $lte: now.toISO() }
  });

  if (!due.length) return;

  const tools = buildTools();

  for (const job of due) {
    try {
      console.log("[JobRunner] Executing:", job.tool, job.when_iso);
      await tools.call(job.tool, job.args);
      job.delivered = true;
      job.delivered_at = new Date();
      await job.save();
    } catch (e) {
      console.error("[JobRunner] Error:", e);
    }
  }
}
