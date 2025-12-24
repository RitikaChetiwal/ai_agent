import nodemailer from "nodemailer";
import { vaultFetchRaw } from "../tools/vault.js"; // your existing vault helper (adjust path if needed)

const host = process.env.SMTP_HOST;
const port = parseInt(process.env.SMTP_PORT || "587", 10);

// Prefer vault for creds; fallback to env for dev
const user = vaultFetchRaw?.("SMTP_USER") ?? process.env.SMTP_USER;
const pass = vaultFetchRaw?.("SMTP_PASS") ?? process.env.SMTP_PASS;
if (!host || !user || !pass) {
  console.warn("[mailer] Missing SMTP credentials. Check env/vault.");
}

export const transporter = nodemailer.createTransport({
  host,
  port,
  secure: port === 465, // true for 465, false for 587/25
  auth: { user, pass },
});

export async function sendMail({
  to,
  subject,
  text,
  html,
  cc,
  bcc,
  attachments,
  from,
}) {
  const fromAddress = from || process.env.FROM_EMAIL || user;
  return transporter.sendMail({
    from: fromAddress,
    to,
    subject,
    text,
    html,
    cc,
    bcc,
    attachments, // [{ filename, content|path|buffer, contentType }]
  });
}
