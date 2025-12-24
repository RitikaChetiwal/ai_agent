import { z } from "zod";
import crypto from "crypto";
import fs from "fs";
import "dotenv/config";

const VAULT_FILE = "./data/vault.enc";
const KEY = crypto.createHash("sha256").update(String(process.env.VAULT_MASTER_KEY || "")).digest();

function encrypt(json) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(json), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function decrypt(b64) {
  const buf = Buffer.from(b64, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  return JSON.parse(dec);
}

function loadVault() {
  try {
    const raw = fs.readFileSync(VAULT_FILE, "utf-8");
    return decrypt(raw);
  } catch {
    return {};
  }
}

function saveVault(obj) {
  fs.writeFileSync(VAULT_FILE, encrypt(obj), "utf-8");
}

let VAULT = loadVault();

export const vaultSchema = z.object({
  op: z.enum(["set", "get"]),
  key: z.string(),
  value: z.string().optional()
});

export function vaultHandler({ op, key, value }) {
  if (op === "set") {
    if (!value) return { error: "missing_value" };
    VAULT[key] = value;
    saveVault(VAULT);
    return { ok: true };
  }
  if (op === "get") {
    if (!(key in VAULT)) return { error: "missing_key" };
    return { value: "[REDACTED]" }; // never return raw secret to the model
  }
  return { error: "invalid_op" };
}

export function vaultFetchRaw(key) {
  // Internal use only: returns raw value to tools (NOT sent to LLM)
  return VAULT[key] ?? null;
}

export const vault = {
  name: "vault",
  schema: vaultSchema,
  handler: vaultHandler,
  description: "Secure key/value secrets vault. Never returns raw values to the LLM."
};
