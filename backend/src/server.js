import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import morgan from "morgan";
import ngrok from "@ngrok/ngrok";
import http from "http";
import { buildTools } from "./tools/index.js";
import { Agent } from "./agent/Agent.js";
import { runAgent } from "./controller/loop.js";
import { bus } from "./utils/bus.js";
import agentRouter from "./routes/agentRoutes.js";
import twilioRoutes from './routes/twilio.js';
import { startReminderCron } from "./scheduler/reminders.js";

mongoose.connect(process.env.MONGO_URI);
mongoose.connection.once("open", () =>
  console.log("[MongoDB] Connected successfully ✅")
);

const app = express();
// app.use(cors({ origin: true, credentials: true }));
// app.use(cors());
app.use(
  cors({
    origin: "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));  // Exotel status callbacks are typically x-www-form-urlencoded:
app.use(morgan("dev"));

const systemPrompt = `
    You are a careful task agent with strict rules:
    - Only call tools that are registered and necessary.
    - For time-related requests, prefer time_parse, then schedule_alarm.
    - For website tasks, use web_automate only if the domain is on the allowlist.
    - Never reveal secrets or vault contents.
    - If a tool returns an error with a hard stop (e.g., captcha, invalid_domain), stop and explain briefly.
    - Email drafting output rules (IMPORTANT):
    - If the user asks to "draft", "compose", or "write" an email (and NOT to send yet),
      respond with a SINGLE JSON object and nothing else.
    - JSON shape (example):
      {
        "type": "email_draft",
        "to": ["a@example.com","b@example.com"],   // array; may be empty if unknown
        "subject": "Subject here",
        "text": "Plain text body here",
        "html": "<p>Optional HTML body</p>"        // include when helpful
        "send_at_iso": "2025-11-05T12:00:00+05:30" // include only if user mentioned a time/date
      }
    - Never send the email yourself for a draft; just return the JSON.
    - When the user mentions a time/date (e.g., "at 12pm", "tomorrow 9:15", "on 5 Nov 2:05 pm"):
        • Use the time_parse tool to resolve it in Asia/Kolkata.  
        • If only a time is given, choose the next future occurrence (today if still upcoming, else tomorrow).  
        • Put the resolved time in "send_at_iso".
`;

const tools = buildTools();
const agent = new Agent({ tools, systemPrompt });

// Listen for alarms and execute payload tools (e.g., send_email)
bus.on("alarm", async (alarm) => {
  console.log("[ALARM EVENT]", JSON.stringify(alarm, null, 2));

  try {
    const p = alarm?.payload;
    if (!p?.tool) return console.log("[ALARM] No payload tool found");

    const { buildTools } = await import("./tools/index.js");
    const tools = buildTools();

    console.log(`[ALARM] Executing tool: ${p.tool}`);
    await tools.call(p.tool, p.args || {}); // ✅ Correct for ToolRegistry
    console.log(`[ALARM] Tool completed: ${p.tool}`);
  } catch (e) {
    console.error("[ALARM] Payload execution error:", e);
  }
});

app.get("/health", (_req, res) => {
  res.send("API is running.");
})

// Endpoint: run the agent with a goal (and optional context)
app.post("/agent/run", async (req, res) => {
  try {
    const { goal, context } = req.body;
    if (!goal) return res.status(400).json({ error: "goal is required" });

    const result = await runAgent({ agent, goal, context });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Optional helper endpoints 
app.get("/alarms", (req, res) => {
  res.json({ ok: true, tip: "Use the agent or list_alarms tool to see items." });
});

app.post("/vault/set", (req, res) => {
  // Convenience route so you don't expose raw to the LLM
  // Use the tool through the agent for general use; use this route for setup.
  res.status(405).json({ error: "Use the 🌍 Public URL: with vault tool or create an admin CLI." });
});

// SSE stream to browser
app.get("/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  const onAlarm = (payload) => {
    res.write(`event: alarm\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  bus.on("alarm", onAlarm);
  req.on("close", () => bus.off("alarm", onAlarm));
});

app.use("/agent", agentRouter);
console.log("[server] Mounted /agent routes");

app.use('/twilio', twilioRoutes);
console.log("[server] Mounted /twilio routes");

const server = http.createServer(app);

const PORT = Number(process.env.PORT || 5001);
const HOST = process.env.HOST
server.listen(PORT, async () => {
  console.log(`🚀 Local server: http://localhost:${PORT}/health`);
  // Only try ngrok in dev, and don't crash if token missing/invalid
  if (process.env.NODE_ENV !== "production") {
    try {
      const token = process.env.NGROK_AUTHTOKEN; // or rely on CLI config file
      if (!token) {
        console.warn("⚠️NGROK_AUTHTOKEN missing. Skipping ngrok.");
        return;
      }

      // Dynamically import so app still runs if package isn't installed
      // const ngrok = (await import("@ngrok/ngrok")).default;

      const listener = await ngrok.connect({
        addr: PORT,
        authtoken: token, // omit this if you used the CLI config method
      });

      console.log(`🌍 Public URL: ${listener.url()}`);
    } catch (err) {
      console.error("❌ ngrok failed (server still running):", err?.message || err);
    }
  }
  startReminderCron();
});