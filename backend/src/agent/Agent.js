import OpenAI from "openai";
import { ToolRegistry } from "./ToolRegistry.js";
import { sendEmailSchema, sendEmailTool } from "../tools/sendEmail.js";
import "dotenv/config";

const OPENAI_MODEL = process.env.OPENAI_MODEL;

export class Agent {
  constructor({ model = process.env.OPENAI_MODEL, tools, systemPrompt }) {
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    // If caller didn't pass a registry, create one now
    this.tools = tools ?? new ToolRegistry();
    // Register the email tool only if not already present
    // if (!this.tools._tools?.has?.("send_email")) {
    if (!this.tools.has?.("send_email")) {
      this.tools.register(
        "send_email",
        sendEmailSchema,
        sendEmailTool,
        "Send an email to one or more recipients"
      );
    }
    this.systemPrompt = systemPrompt;
    this.model = model;
  }

  messages(goal, context = "") {
    return [
      { role: "system", content: this.systemPrompt },
      { role: "user", content: context || goal }
    ];
  }

  async step({ goal, context, messages }) {
    const resp = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0.2,
      messages: messages ?? this.messages(goal, context),
      tools: this.tools.toOpenAITools(),  // ✅ correct method name
      tool_choice: "auto"
    });

    const msg = resp.choices[0].message;
    return msg;
  }
}
