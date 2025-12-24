// utils/storage.js
import Call from "../models/Call.js";

export async function listCalls(limit = 50) {
  return await Call.find().sort({ startedAt: -1 }).limit(limit).lean();
}

export async function getCall(sid) {
  return await Call.findOne({ sid }).lean();
}

export async function upsertCallBySid(sid, patch) {
  await Call.updateOne({ sid }, { $set: patch }, { upsert: true });
}

export async function appendTurn(sid, turn) {
  await Call.updateOne(
    { sid },
    { $push: { transcripts: { ...turn, ts: new Date() } } },
    { upsert: true }
  );
}