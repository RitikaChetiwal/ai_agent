// models/Caller.js
import mongoose from "mongoose";

const callerSchema = new mongoose.Schema({
  phone: { type: String, unique: true, index: true }, // E.164: +91..., +1408...
  name: String,
  lastAppointmentStatus: { type: String, enum: ["booked", "cancelled", "pending", null], default: null },
  // 🟢 NEW: last appointment details remembered for this customer
  lastAppointmentDate: String,  // e.g., "12 Nov 2025"
  lastAppointmentTime: String,  // e.g., "11:30 AM"
  lastDoctorName: String,       // e.g., "Dr. Mehta"
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

export default mongoose.model("Caller", callerSchema);
