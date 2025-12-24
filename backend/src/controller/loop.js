import { policy } from "./policy.js";
import { logger } from "../utils/logger.js";

export async function runAgent({ agent, goal, context }) {
  const start = Date.now();
  const steps = [];
  const messages = agent.messages(goal, context);

  for (let i = 1; i <= policy.maxSteps; i++) {
    const msg = await agent.step({ goal, context, messages });
    steps.push({ i, type: "llm", content: msg.content || null, toolCalls: msg.tool_calls?.length || 0 });
    messages.push(msg);

  if (msg.tool_calls?.length) {
  // ✅ Handle *every* tool call in this assistant message
  for (const tc of msg.tool_calls) {
    const toolName = tc.function?.name || "";
    const toolCallId = tc.id;
    let args = {};
    try { args = JSON.parse(tc.function?.arguments || "{}"); } catch { args = {}; }

    let result;
    try {
      result = await agent.tools.call(toolName, args);
    } catch (e) {
      result = { error: String(e) };
    }

    // Truncate result to keep token budget small
    const str = JSON.stringify(result);
    const truncated = str.length > policy.truncation.toolResultMaxChars
      ? str.slice(0, policy.truncation.toolResultMaxChars) + "…[truncated]"
      : str;

    messages.push({
      role: "tool",
      name: toolName,
      tool_call_id: toolCallId,   // ← must match exactly
      content: truncated          // string content
    });

    // for debugging / traces
    let parsed;
    try { parsed = JSON.parse(truncated.replace(/…\[truncated]$/, "")); } catch { parsed = { truncated }; }
    steps.push({ i, type: "tool", tool: toolName, result: parsed });
  }

  // After replying to ALL tool calls, loop continues so model can read them
  continue;
}


    // No tool call → assume final
    if (msg.content) {
      const duration = Date.now() - start;
      return { done: true, output: msg.content.trim(), steps, durationMs: duration };
    }

    if (Date.now() - start > policy.overallTimeoutMs) break;
  }

  return {
    done: false,
    output: "Max steps reached or timeout without a final answer.",
    steps,
    durationMs: Date.now() - (start)
  };
}
