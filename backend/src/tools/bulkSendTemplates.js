// backend/src/tools/bulkSendTemplate.js
import { z } from "zod";
import { emailTemplates } from "../utils/emailTemplates.js";
import { sendMail } from "../utils/mailer.js";

/** simple mustache-style renderer: "Hi {{name}}" */
function render(str, params = {}) {
  return String(str).replace(/{{\s*([\w.]+)\s*}}/g, (_m, key) => {
    const val = key.split(".").reduce((acc, k) => acc?.[k], params);
    return (val ?? "").toString();
  });
}

export const bulkSendTemplateSchema = z.object({
  templateId: z.string().min(1),
  // either pass a flat list of emails...
  to: z.array(z.string().email()).optional(),
  // ...or pass objects with per-recipient params
  recipients: z.array(
    z.object({
      to: z.string().email(),
      params: z.record(z.any()).optional()
    })
  ).optional(),
  // default params merged for everyone
  params: z.record(z.any()).optional(),
  // throttling / batching
  throttleMs: z.number().min(0).max(10_000).default(250), // 4/s default
});

export async function bulkSendTemplateTool(args) {
  const input = bulkSendTemplateSchema.parse(args);

  const tpl = emailTemplates[input.templateId];
  if (!tpl) return { ok: false, error: `Unknown template: ${input.templateId}` };

  // normalize recipients
  let list = [];
  if (Array.isArray(input.recipients) && input.recipients.length) {
    list = input.recipients.map(r => ({ to: r.to, params: { ...input.params, ...(r.params || {}) } }));
  } else if (Array.isArray(input.to) && input.to.length) {
    list = input.to.map(e => ({ to: e, params: { ...(input.params || {}) } }));
  } else {
    return { ok: false, error: "Provide 'to' (array) or 'recipients' (array of {to, params})." };
  }

  const results = [];
  for (let i = 0; i < list.length; i++) {
    const { to, params } = list[i];
    try {
      const subject = tpl.subject ? render(tpl.subject, params) : "(no subject)";
      const html = tpl.html ? render(tpl.html, params) : undefined;
      const text = tpl.text ? render(tpl.text, params) : undefined;

      const info = await sendMail({ to, subject, html, text });
      results.push({ to, ok: true, messageId: info.messageId, accepted: info.accepted });
    } catch (e) {
      results.push({ to, ok: false, error: String(e?.message || e) });
    }
    if (i < list.length - 1 && input.throttleMs > 0) {
      await new Promise(r => setTimeout(r, input.throttleMs));
    }
  }

  const okCount = results.filter(r => r.ok).length;
  const failCount = results.length - okCount;
  return { ok: failCount === 0, sent: okCount, failed: failCount, results };
}

export default {
  name: "send_bulk_template",
  description: "Send a chosen template to many recipients (per-recipient merge fields supported).",
  schema: bulkSendTemplateSchema,
  run: bulkSendTemplateTool,
};
