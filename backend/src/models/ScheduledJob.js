// src/models/ScheduledJob.js
import mongoose from "mongoose";

const ScheduledJobSchema = new mongoose.Schema({
  when_iso: { type: String, required: true },
  tool: { type: String, required: true },
  args: { type: Object, default: {} },
  delivered: { type: Boolean, default: false },
  delivered_at: { type: Date },
}, { timestamps: true });

export const ScheduledJob = mongoose.model("ScheduledJob", ScheduledJobSchema);
