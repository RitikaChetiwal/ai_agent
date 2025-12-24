import { z } from "zod";
import { sendMail } from "../utils/mailer.js";

const recipientsSchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform(val => {
    if (Array.isArray(val)) return val.map(s => s.trim()).filter(Boolean);
    if (typeof val === "string") {
      return val.split(/[,;\n]/g).map(s => s.trim()).filter(Boolean);
    }
    return [];
  })
  .refine(arr => arr.length > 0, "Recipient required");

export const sendEmailSchema = z.object({
  to: recipientsSchema,                         // ← new
  subject: z.string().default("(No Subject)"),  // ← already changed
  text: z.string().optional(),
  html: z.string().optional(),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  from: z.string().optional(),
  attachments: z.array(
    z.object({
      filename: z.string(),
      path: z.string().optional(),
      content: z.any().optional(),
      contentType: z.string().optional(),
      encoding: z.string().optional(),
    })
  ).optional(),
});

export async function sendEmailTool(args, ctx) {
  const input = sendEmailSchema.parse(args);
  console.log("[SMTP] Sending to:", input.to, "Subject:", input.subject);
  const res = await sendMail(input);
  return {
    ok: true,
    messageId: res.messageId,
    accepted: res.accepted,
    rejected: res.rejected,
    response: res.response,
  };
}

export const sendEmail = {
  name: "send_email",
  description: "Send an email to one or more recipients",
  schema: sendEmailSchema,
  run: sendEmailTool,
};