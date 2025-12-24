# AI Agent (Alarms + Website Login)

## Prereqs
- Node.js 18+
- `npm i`
- Copy `.env.example` → `.env` and fill values.
- (First run creates `data/vault.enc` and `data/alarms.json`)

## Run
```bash
npm run dev


---

## Step-by-step guidance (do these in order)

1) **Set up project**  
   - Create folder → paste files above.  
   - `npm install`  
   - Copy `.env.example` → `.env` and fill.

2) **Allowlist a website** you own or a simple demo domain in `.env` → `ALLOWLIST_DOMAINS=yourdomain.com`.

3) **Start server**: `npm run dev`.

4) **Schedule an alarm**  
   - Use the curl in README “Test 1”.  
   - Confirm: the JSON shows `scheduled: true` and the console will print when it fires.

5) **Store site creds** in the vault  
   - For now, use the agent with `vault` tool through the `/agent/run` endpoint (or quickly add an admin CLI).  
   - Make sure you never echo raw passwords into logs or model outputs (the given vault tool already prevents that).

6) **Run a login flow**  
   - Use the curl in README “Test 2”.  
   - Adjust selectors to match your real login page.  
   - If your site uses 2FA/captcha, expect a **hard stop**; use official APIs or a manual OTP prompt in your UI in v2.

7) **Harden delivery channel**  
   - Replace the MVP console “alarm delivery” with your preferred channel:  
     - Desktop (Electron/toast),  
     - Push (Web Push with a Service Worker),  
     - Email (Resend/SES),  
     - SMS (MSG91/2Factor).  
   - Swap the `// MVP delivery` section inside `scheduleAlarm.js`.

8) **Add a tiny UI (optional)**  
   - Build a small React page with a goal box and a “Run Agent” button posting to `/agent/run`, plus a “Steps” timeline from the response’s `steps[]`.

9) **Write your golden tests** (at least 10 alarms + 10 logins) and run them manually.  
   - Aim for ≥80% pass; refine parsing/steps if needed.

---

## Notes & customization

- **Natural time parsing**: the included parser is deterministic and safe for MVP (covers “in N minutes/hours,” “tomorrow,” “next Monday,” explicit HH:MM am/pm). If you need more coverage, extend `timeParse.js` with extra patterns.
- **Security**:  
  - Vault uses AES-256-GCM with a key derived from `VAULT_MASTER_KEY`. Keep this secret safe.  
  - The **LLM never sees raw secrets** — tools fetch secrets internally.  
  - **Domain allowlist** blocks automation to unknown sites.
- **Controller limits**: max 6 steps, 25s total, truncates tool outputs to reduce hallucination risk and cost.
- **Swap models**: Want local? Start Ollama/vLLM with an OpenAI-compatible API and pass `baseURL` to the OpenAI client. The agent code stays the same.

---

If you hit an error anywhere, paste the error line and I’ll fix it. If you tell me the **exact site** you want to automate first, I’ll tailor the `steps[]` for that site’s selectors so it works out of the box.
