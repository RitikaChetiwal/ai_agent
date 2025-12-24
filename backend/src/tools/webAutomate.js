import { z } from "zod";
import { chromium } from "playwright";
import { vaultFetchRaw } from "./vault.js";

const Step = z.discriminatedUnion("action", [
  z.object({ action: z.literal("type"), selector: z.string(), value_ref: z.string(), secret: z.boolean().optional() }),
  z.object({ action: z.literal("click"), selector: z.string() }),
  z.object({ action: z.literal("waitFor"), selector: z.string(), timeoutMs: z.number().optional() }),
  z.object({ action: z.literal("screenshot"), path: z.string().default("screenshot.png") })
]);

export const webAutomateSchema = z.object({
  start_url: z.string().url(),
  steps: z.array(Step).min(1),
  domain_allowlist: z.array(z.string()).min(1)
});

function allowed(url, list) {
  try {
    const u = new URL(url);
    return list.some(d => u.hostname.endsWith(d));
  } catch {
    return false;
  }
}

export async function webAutomateHandler({ start_url, steps, domain_allowlist }) {
  if (!allowed(start_url, domain_allowlist)) return { error: "invalid_domain" };

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  const artifacts = [];
  let notes = [];

  try {
    await page.route("**/*", (route) => {
      // Block some trackers/popups
      const u = route.request().url();
      if (/\.(png|jpg|gif|svg|woff2?)$/i.test(u)) return route.abort(); // speed up
      return route.continue();
    });

    await page.goto(start_url, { waitUntil: "domcontentloaded", timeout: 15000 });

    for (const s of steps) {
      if (s.action === "type") {
        const ref = s.value_ref;
        const [ns, key] = ref.split(".");
        if (ns !== "vault") return { error: "unsupported_value_ref" };
        const raw = vaultFetchRaw(key);
        if (!raw) return { error: "missing_secret" };
        await page.fill(s.selector, raw, { timeout: 10000 });
      } else if (s.action === "click") {
        await page.click(s.selector, { timeout: 10000 });
      } else if (s.action === "waitFor") {
        await page.waitForSelector(s.selector, { timeout: s.timeoutMs ?? 15000 });
      } else if (s.action === "screenshot") {
        await page.screenshot({ path: `./${s.path}`, fullPage: true });
        artifacts.push(s.path);
      }
    }

    return { status: "ok", artifacts, notes };
  } catch (e) {
    const msg = String(e);
    if (/Timeout/i.test(msg)) return { error: "selector_timeout", detail: msg };
    if (/captcha/i.test(msg)) return { error: "captcha_detected" };
    if (/Denied|forbidden/i.test(msg)) return { error: "access_denied" };
    return { error: "automation_error", detail: msg };
  } finally {
    await browser.close();
  }
}

export const webAutomate = {
  name: "web_automate",
  schema: webAutomateSchema,
  handler: webAutomateHandler,
  description: "Headless browser steps with domain allowlist and secret injection via vault."
};
