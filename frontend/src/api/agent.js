import axios from 'axios'

const API = import.meta.env.VITE_API_BASE || 'http://localhost:5000'

export async function runAgent(payload) {
  const { data } = await axios.post(`${API}/agent/run`, payload)
  return data
}

// fallback helper to read alarms directly if needed
export async function listAlarms() {
  const { data } = await axios.get(`${API}/alarms`)
  return data
}

export async function sendEmail(payload) {
  // keep it consistent with the rest of your API calls
  const { data } = await axios.post(`${API}/agent/tool`, {
    name: "send_email",
    args: payload
  });
  return data;
}


export async function sendBulkTemplate({ templateId, emails, defaultParams, recipientsWithParams, throttleMs }) {
  // Use either emails[] or recipientsWithParams[]
  const args = {
    templateId,
    ...(recipientsWithParams?.length
      ? { recipients: recipientsWithParams }
      : { to: emails }),
    ...(defaultParams ? { params: defaultParams } : {}),
    ...(typeof throttleMs === "number" ? { throttleMs } : {})
  };
  const { data } = await axios.post(`${API}/agent/tool`, {
    name: "send_bulk_template",
    args
  });
  return data;
}

// NEW: templates API
export async function listEmailTemplates() {
  const { data } = await axios.get(`${API}/agent/templates`);
  return data.templates; // ["hello1","hello2","hello3"]
}

// export async function getEmailTemplate(id) {
//   const { data } = await axios.get(`${API}/agent/templates/${id}`);
//   return data; // { subject, html, text }
// }

export async function sendEmailTemplate(id, to) {
  const tpl = await getEmailTemplate(id);
  return sendEmail({
    to,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text, // fallback
  });
}

// NEW: schedule a bulk send for later via schedule_alarm
export async function scheduleBulkTemplate({ whenISO, templateId, emails, recipientsWithParams, defaultParams, throttleMs }) {
  const bulkArgs = {
    templateId,
    ...(recipientsWithParams?.length
      ? { recipients: recipientsWithParams }
      : { to: emails }),
    ...(defaultParams ? { params: defaultParams } : {}),
    ...(typeof throttleMs === "number" ? { throttleMs } : {})
  };
  const { data } = await axios.post(`${API}/agent/tool`, {
    name: "schedule_alarm",
    args: {
      when_iso: whenISO,                    // e.g. "2025-10-25T18:45:00+05:30"
      message: `Bulk mail: ${templateId}`,
      channel: "desktop",
      payload: {
        tool: "send_bulk_template",
        args: bulkArgs
      }
    }
  });
  return data;
}

// Schedule a single email to send at a specific ISO time (Asia/Kolkata preserved)
export async function scheduleEmail({ whenISO, to, subject, text, html }) {
  const args = {
    to,
    subject,
    ...(html ? { html } : { text: text || "" })
  };
  const { data } = await axios.post(`${API}/agent/tool`, {
    name: "schedule_alarm",
    args: {
      when_iso: whenISO,                // e.g. "2025-10-31T12:00:00+05:30"
      message: `Scheduled email: ${subject || "(no subject)"}`,
      channel: "desktop",
      payload: { tool: "send_email", args }
    }
  });
  return data;
}

// --- NEW: trigger an outbound Exotel AI call ---
// src/api/agent.js
export async function startAICall(to) {
  const { data } = await axios.post(`${API}/twilio/voice/outbound`, { to });
  return data;
}