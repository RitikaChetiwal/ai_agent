// controllers/twilioController.js
import twilio from 'twilio';
import { askOpenAI } from '../services/openaiText.js';
import { upsertCallBySid, appendTurn, listCalls, getCall } from '../utils/storage.js';
import Call from '../models/Call.js';
import Caller from '../models/Caller.js';   // NEW

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const callerId = process.env.TWILIO_CALLER_ID;
const publicUrl = process.env.PUBLIC_URL;

const client = twilio(accountSid, authToken);

/** INBOUND: start flow + create history */

function normalizeNumber(num = '') {
  return num?.startsWith('+') ? num : ('+' + (num || '').replace(/\D/g, ''));
}

function extractName(transcript = '') {
  const m = transcript.match(
    /(?:\bi'?m\b|\bi am\b|\bmy name is\b|\bthis is\b|\bmera naam\b)\s+([A-Za-z][A-Za-z .'-]{1,40})/i
  );
  if (!m) return null;
  const raw = m[1].replace(/\b(hai|here)\b.*$/i, '').trim();
  return raw.split(/\s+/).slice(0, 2).map(w => (w[0]?.toUpperCase() || '') + w.slice(1).toLowerCase()).join(' ');
}

// --- Light extractors (robust enough for "12/11", "12-11-2025", "12 Nov", "tomorrow") ---
function extractDate(text = "") {
  const rel = text.match(/\b(tomorrow|today|day after|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i);
  if (rel) return rel[1];
  const dmy = text.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/); // 12/11[/2025]
  if (dmy) return dmy[0];
  const mon = text.match(/\b(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\w*(?:\s*\d{2,4})?\b/i);
  if (mon) return mon[0];
  return null;
}

function extractTime(text = "") {
  const t = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i); // 11 / 11:30 / 11:30am
  return t ? t[0] : null;
}

function extractDoctor(text = "") {
  const m = text.match(/\b(?:dr\.?|doctor)\s+([A-Za-z][A-Za-z .'-]{1,40})/i);
  if (!m) return null;
  // keep first 1–2 tokens
  return "Dr. " + m[1].trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}


export async function inboundVoice(req, res) {
  const callSid = req.body.CallSid;
  const rawFrom = normalizeNumber(req.body.From || '');
  const rawTo = normalizeNumber(req.body.To || '');

  // Try to load the call we created earlier (esp. for outbound)
  let doc = null;
  try { doc = await getCall(callSid); } catch { }

  // Decide the HUMAN’s number correctly based on direction
  const isOutbound = doc?.direction === 'outbound';
  const customerPhone = isOutbound
    ? normalizeNumber(doc?.to || rawFrom)   // callee we dialed
    : normalizeNumber(rawFrom);             // inbound caller

  // Ensure a Caller exists for the human number
  await Caller.updateOne(
    { phone: customerPhone },
    { $setOnInsert: {} },
    { upsert: true, timestamps: true }
  );

  // Look up name from Caller directory
  const profile = await Caller.findOne({ phone: customerPhone });
  const previousName = profile?.name || null;

  // Seed/refresh Call record (don’t change direction)
  await upsertCallBySid(callSid, {
    direction: doc?.direction || 'inbound',
    from: rawFrom,
    to: rawTo,
    startedAt: doc?.startedAt || Date.now(),
    status: 'in-progress',
    callerName: previousName || null, // convenience copy
  });

  // Build TwiML
  const vr = new twilio.twiml.VoiceResponse();
  const gather = vr.gather({
    input: 'speech',
    action: `${process.env.PUBLIC_URL}/twilio/voice/gather`,
    method: 'POST',
    language: 'en-IN',
    speechTimeout: 'auto'
  });

  if (previousName) {
    // Correctly greets the callee on outbound, or caller on inbound
    gather.say({ voice: 'Polly.Aditi' }, `Welcome back, ${previousName}! How can I help you today?`);
  } else {
    gather.say({ voice: 'Polly.Aditi' }, `Hi! This is your AI assistant. May I know your name, please?`);
  }

  res.type('text/xml').send(vr.toString());
}


/** GATHER HANDLER: append caller + assistant turns */
export async function gatherHandler(req, res) {
  const callSid = req.body.CallSid;
  const transcript = req.body.SpeechResult || '';
  const confidence = req.body.Confidence || '';

  // Save caller turn
  if (transcript) {
    await appendTurn(callSid, { from: 'caller', text: transcript, confidence });
  }

  // Load current call doc
  const doc = await getCall(callSid);
  const customRules = (doc?.rulesText || '').trim();

  let callerName = doc?.callerName;
  let appointmentStatus = doc?.appointmentStatus;

  // Decide the HUMAN's phone based on direction
  const customerPhone =
    doc?.direction === 'inbound'
      ? normalizeNumber(doc?.from || req.body.From || '')
      : normalizeNumber(doc?.to || req.body.To || '');

  // Base prompt (keeps your original guardrails)
  const basePrompt = `
      You are a clinic's AI assistant. Keep replies short (<=25 words), polite, and conversational.
      If caller hasn't given a name yet, ask for it once.
      If they mention booking or canceling, record intent as 'booked' or 'cancelled'.
      Never repeat name requests once known.
      `;

  // If custom rules exist (from the UI), append them
  const systemPrompt = customRules
    ? `${basePrompt}\n\nCUSTOM RULES FROM UI:\n${customRules}`
    : basePrompt;

  const userPrompt = `
      Previous context:
      ${(doc?.transcripts || []).slice(-5).map(t => `${t.from}: ${t.text}`).join("\n")}
      Current user: ${transcript}
      `;

  let answer = 'I didn’t catch that. Could you please repeat?';
  try {
    answer = await askOpenAI(systemPrompt, userPrompt);
  } catch (e) {
    console.error('[OpenAI Error]', e.message);
  }

  // --- Name extraction (robust) ---
  const m = transcript.match(
    /(?:\bi'?m\b|\bi am\b|\bmy name is\b|\bthis is\b|\bmera naam\b)\s+([A-Za-z][A-Za-z .'-]{1,40})/i
  );
  const cleanName = (raw = '') => {
    const x = raw.replace(/\b(hai|here)\b.*$/i, '').trim();
    return x.split(/\s+/).slice(0, 2).map(w => (w[0]?.toUpperCase() || '') + w.slice(1).toLowerCase()).join(' ');
  };

  const maybeName = m ? cleanName(m[1]) : null;

  if (maybeName && !callerName) {
    callerName = maybeName;

    // Update Caller (single source of truth) + copy to Call for convenience
    await Caller.updateOne(
      { phone: customerPhone },
      { $set: { name: callerName } },
      { upsert: true, timestamps: true }
    );

    await upsertCallBySid(callSid, { callerName });

    // Personalize reply immediately
    answer = `Nice to meet you, ${callerName}! How can I help you today?`;
    console.log(`[AI MEMORY] Saved name: ${customerPhone} → ${callerName}`);
  }



  // --- Appointment intent ---
  if (/book|schedule|confirm/i.test(transcript)) appointmentStatus = 'booked';
  else if (/cancel|resched|call off/i.test(transcript)) appointmentStatus = 'cancelled';

  if (appointmentStatus) {
    // Save on Caller + copy to Call
    await Caller.updateOne(
      { phone: customerPhone },
      { $set: { lastAppointmentStatus: appointmentStatus } },
      { upsert: true, timestamps: true }
    );

    await upsertCallBySid(callSid, { appointmentStatus });
    console.log(`[AI MEMORY] Saved status: ${customerPhone} → ${appointmentStatus}`);
  }

  // Save assistant turn
  await appendTurn(callSid, { from: 'assistant', text: answer });

  // changes**************************

  // --- NEW: extract appointment details from this turn ---
  const apptDate = extractDate(transcript);
  const apptTime = extractTime(transcript);
  const docName = extractDoctor(transcript);

  // Update Call (convenience copies for this call)
  const callPatch = {};
  if (apptDate) callPatch.appointmentDate = apptDate;
  if (apptTime) callPatch.appointmentTime = apptTime;
  if (docName) callPatch.doctorName = docName;
  if (Object.keys(callPatch).length) {
    await upsertCallBySid(callSid, callPatch);
    console.log(`[AI MEMORY] Saved call appt: date=${apptDate || '-'} time=${apptTime || '-'} doctor=${docName || '-'}`);
  }

  // Update Caller directory (last known)
  const callerPatch = {};
  if (apptDate) callerPatch.lastAppointmentDate = apptDate;
  if (apptTime) callerPatch.lastAppointmentTime = apptTime;
  if (docName) callerPatch.lastDoctorName = docName;
  if (Object.keys(callerPatch).length) {
    await Caller.updateOne(
      { phone: customerPhone },
      { $set: callerPatch },
      { upsert: true, timestamps: true }
    );
    console.log(`[AI MEMORY] Saved caller appt: ${customerPhone} →`, callerPatch);
  }


  // Build TwiML
  const vr = new twilio.twiml.VoiceResponse();

  if (!callerName) {
    vr.say({ voice: 'Polly.Aditi' }, 'Hi there! May I know your name, please?');
  } else {
    vr.say({ voice: 'Polly.Aditi' }, answer);
  }

  const g = vr.gather({
    input: 'speech',
    action: `${publicUrl}/twilio/voice/gather`,
    method: 'POST',
    language: 'en-IN',
    speechTimeout: 'auto'
  });
  g.say({ voice: 'Polly.Aditi' }, 'Anything else?');

  vr.say({ voice: 'Polly.Aditi' }, 'Goodbye!');
  vr.hangup();

  res.type('text/xml').send(vr.toString());
}



/** OUTBOUND: create call + record */
export async function outboundDial(req, res) {
  try {
    const { to, rulesText } = req.body || {};
    if (!to) return res.status(400).json({ error: "missing 'to' in body" });

    const callee = normalizeNumber(to);            // ✅ CUSTOMER (human)
    const twilioNum = normalizeNumber(callerId);      // your Twilio number

    const twimlUrl = `${publicUrl}/twilio/voice/outbound/twiml`;
    const statusCb = `${publicUrl}/twilio/voice/status`;

    const call = await client.calls.create({
      to: callee,
      from: twilioNum,
      url: twimlUrl,
      statusCallback: statusCb,
      statusCallbackMethod: 'POST',
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']
    });

    // Create/seed the call record (no customer fields in Call model)
    await upsertCallBySid(call.sid, {
      direction: 'outbound',
      from: twilioNum,   // network From (Twilio)
      to: callee,        // network To   (CUSTOMER)
      startedAt: Date.now(),
      status: 'initiated',
      rulesText: (rulesText || '').trim() || null,
    });

    // Ensure a Caller profile exists for the CUSTOMER phone
    await Caller.updateOne(
      { phone: callee },
      { $setOnInsert: {} },
      { upsert: true, timestamps: true }
    );


    res.json({ ok: true, sid: call.sid });
  } catch (e) {
    console.error('Outbound error:', e.message);
    res.status(500).json({ error: e.message });
  }
}


/** OUTBOUND TwiML: reuse inbound flow */
export async function outboundAnswerTwiML(req, res) {
  const callSid = req.body.CallSid;
  await upsertCallBySid(callSid, { status: 'answered' });

  const vr = new twilio.twiml.VoiceResponse();
  vr.say({ voice: 'Polly.Aditi' }, 'Hello! This is your AI assistant calling about your appointment.');
  vr.redirect('/twilio/voice/inbound');
  res.type('text/xml').send(vr.toString());
}

/** STATUS WEBHOOK: Twilio -> update status/duration */
export async function callStatus(req, res) {
  const { CallSid, CallStatus, CallDuration, Timestamp } = req.body || {};
  await upsertCallBySid(CallSid, {
    status: CallStatus,
    durationSec: CallDuration ? Number(CallDuration) : undefined,
    endedAt: ['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes((CallStatus || '').toLowerCase()) ? Date.now() : undefined,
    lastEventAt: Timestamp || Date.now()
  });
  res.sendStatus(204);
}

/** API: list & get history */
export async function listCallHistory(req, res) {
  const limit = Number(req.query.limit || 50);
  const data = await listCalls(limit);
  res.json(data);
}

export async function getCallBySid(req, res) {
  const doc = await getCall(req.params.sid);
  if (!doc) return res.status(404).json({ error: 'not found' });
  res.json(doc);
}

// Kick off a Studio Flow execution for a single customer
export async function startStudioReminder(req, res) {
  try {
    const { phone, name, date, time, doctor } = req.body || {};
    if (!phone || !date || !time) {
      return res.status(400).json({ error: "phone, date, and time are required" });
    }

    const to = phone.startsWith("+") ? phone : "+" + phone.replace(/\D/g, "");
    const from = process.env.TWILIO_CALLER_ID;
    const flowSid = process.env.STUDIO_FLOW_SID;

    // If you want Studio to call your AI TwiML, pass it here:
    const twimlUrl = `${process.env.PUBLIC_URL}/twilio/voice/outbound/twiml`;

    const exec = await client.studio.v2.flows(flowSid).executions.create({
      to,
      from,
      parameters: {
        phone: to,
        from,
        name: name || "",
        date,
        time,
        doctor: doctor || "",
        twimlUrl  // Studio's "Make Outbound Call" uses this if you selected "Use TwiML from URL"
      }
    });

    return res.json({ ok: true, executionSid: exec.sid });
  } catch (e) {
    console.error("[StudioReminder] error:", e.message);
    return res.status(500).json({ error: e.message });
  }
}

function toTomorrowString() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  // Adjust to your stored format (you used free-text; keep this flexible)
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); // e.g. "12 Nov 2025"
}

// // GET or POST /twilio/studio/run-reminders
// export async function runStudioReminders(req, res) {
//   try {
//     const tomorrow = toTomorrowString();
//     // Find customers with lastAppointmentDate that "matches" tomorrow (string contains is fine for now)
//     const people = await Caller.find({
//       lastAppointmentDate: { $regex: tomorrow, $options: "i" }
//     }).lean();

//     const from = process.env.TWILIO_CALLER_ID;
//     const flowSid = process.env.STUDIO_FLOW_SID;
//     const twimlUrl = `${process.env.PUBLIC_URL}/twilio/voice/outbound/twiml`;

//     const results = [];
//     for (const p of people) {
//       if (!p.phone) continue;
//       const to = p.phone;

//       const exec = await client.studio.v2.flows(flowSid).executions.create({
//         to,
//         from,
//         parameters: {
//           phone: to,
//           from,
//           name: p.name || "",
//           date: p.lastAppointmentDate || "",
//           time: p.lastAppointmentTime || "",
//           doctor: p.lastDoctorName || "",
//           twimlUrl
//         }
//       });
//       results.push({ phone: to, executionSid: exec.sid });
//     }

//     return res.json({ ok: true, count: results.length, results });
//   } catch (e) {
//     console.error("[RunStudioReminders] error:", e.message);
//     return res.status(500).json({ error: e.message });
//   }
// }

// changed function to get immediate reminder
// GET or POST /twilio/studio/run-reminders
export async function runStudioReminders(req, res) {
  try {
    const { phone } = req.body || {};

    const from = process.env.TWILIO_CALLER_ID;
    const flowSid = process.env.STUDIO_FLOW_SID;
    const twimlUrl = `${process.env.PUBLIC_URL}/twilio/voice/outbound/twiml`;

    const results = [];

    // 🔹 QUICK MODE: if phone is provided, call only this number right now
    if (phone) {
      const normalized =
        phone.startsWith('+') ? phone : '+' + (phone || '').replace(/\D/g, '');

      const exec = await client.studio.v2.flows(flowSid).executions.create({
        to: normalized,
        from,
        parameters: {
          phone: normalized,
          from,
          // simple defaults, your Studio flow already has safe defaults
          name: '',
          date: '',
          time: '',
          doctor: '',
          twimlUrl,
        },
      });

      results.push({ phone: normalized, executionSid: exec.sid });

      return res.json({ ok: true, count: 1, results });
    }

    // 🔹 BATCH MODE (old behavior): call everyone with appointment tomorrow
    const tomorrow = toTomorrowString();
    const people = await Caller.find({
      lastAppointmentDate: { $regex: tomorrow, $options: 'i' },
    }).lean();

    for (const p of people) {
      if (!p.phone) continue;
      const to = p.phone;

      const exec = await client.studio.v2.flows(flowSid).executions.create({
        to,
        from,
        parameters: {
          phone: to,
          from,
          name: p.name || '',
          date: p.lastAppointmentDate || '',
          time: p.lastAppointmentTime || '',
          doctor: p.lastDoctorName || '',
          twimlUrl,
        },
      });

      results.push({ phone: to, executionSid: exec.sid });
    }

    return res.json({ ok: true, count: results.length, results });
  } catch (e) {
    console.error('[RunStudioReminders] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

export async function reminderCallback(req, res) {
  try {
    const { phone, choice, date, time, doctor } = req.body || {};
    const num = phone?.startsWith("+") ? phone : "+" + (phone || "").replace(/\D/g, "");

    if (choice === "1") {
      // Confirmed
      await Caller.updateOne(
        { phone: num },
        { $set: { lastAppointmentStatus: "booked" } },
        { upsert: true, timestamps: true }
      );
    } else if (choice === "2") {
      // Wants reschedule
      await Caller.updateOne(
        { phone: num },
        { $set: { lastAppointmentStatus: "pending" } },
        { upsert: true, timestamps: true }
      );
      // Optional: you can trigger your AI assistant to call back immediately
      // or send an SMS with a reschedule link.
    }

    // If you passed date/time/doctor back, you could update them as well:
    if (date || time || doctor) {
      await Caller.updateOne(
        { phone: num },
        {
          $set: {
            ...(date ? { lastAppointmentDate: date } : {}),
            ...(time ? { lastAppointmentTime: time } : {}),
            ...(doctor ? { lastDoctorName: doctor } : {}),
          }
        },
        { upsert: true, timestamps: true }
      );
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("[ReminderCallback] error:", e.message);
    return res.status(500).json({ error: e.message });
  }
}