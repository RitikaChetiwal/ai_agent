import express from "express";
import { buildTools } from "../tools/index.js";
import { emailTemplates } from "../utils/emailTemplates.js";

const router = express.Router();

// Log once so we KNOW this file was loaded
console.log("[agentRoutes] init: /agent routes registering");

// POST /agent/tool  → run a tool (send_email etc.)
router.post("/tool", async (req, res) => {
  try {
    const { name, args } = req.body || {};
    const tools = buildTools();
    const out = await tools.call(name, args);
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// GET /agent/templates  → ["Template1","Template2","Template3"]
router.get("/templates", (_req, res) => {
  res.json({ templates: Object.keys(emailTemplates) });
});

// GET /agent/templates/:id  → { subject, html, text }
router.get("/templates/:id", (req, res) => {
  const tpl = emailTemplates[req.params.id];
  if (!tpl) return res.status(404).json({ error: "Template not found" });
  res.json(tpl);
});

// Quick health check
router.get("/ping", (_req, res) => res.json({ ok: true, route: "agent" }));

export default router;
