// models/Call.js
import mongoose from "mongoose";

const transcriptSchema = new mongoose.Schema({
    from: { type: String, enum: ["caller", "assistant"], required: true },
    text: { type: String, trim: true },
    confidence: String,
    ts: { type: Date, default: Date.now }
});

const callSchema = new mongoose.Schema({
    sid: { type: String, required: true, unique: true },
    direction: { type: String, enum: ["inbound", "outbound"], default: "outbound" },
    from: String,
    to: String,
    status: String,
    startedAt: { type: Date, default: Date.now },
    endedAt: Date,
    durationSec: Number,
    rulesText: { type: String, default: '' },
    callerName: String,                // 🟢 New
    appointmentStatus: String,         // 🟢 New (booked / cancelled / pending)
    // 🟢 NEW: appointment details (per call)
    appointmentDate: String,  // store raw string (e.g., "12 Nov 2025" / "tomorrow")
    appointmentTime: String,  // store raw string (e.g., "11:30 AM")
    doctorName: String,       // e.g., "Dr. Mehta"
    transcripts: [transcriptSchema]
}, { timestamps: true });

export default mongoose.model("Call", callSchema);