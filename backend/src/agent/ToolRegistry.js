// src/agent/ToolRegistry.js
import { zodToJsonSchema } from "zod-to-json-schema";

export class ToolRegistry {
  constructor() {
    this._tools = new Map();
  }

  register(name, schema, handler, description = "") {
    this._tools.set(name, { name, schema, handler, description });
  }

  // QoL: public check instead of peeking into _tools
  has(name) {
    return this._tools.has(name);
  }

  async call(name, args) {
    const t = this._tools.get(name);
    if (!t) throw new Error(`unknown_tool:${name}`);

    const parsed = t.schema.safeParse(args ?? {});
    if (!parsed.success) {
      const msg = parsed.error.errors
        .map(e => `${e.path.join(".") || "(root)"}: ${e.message}`)
        .join("; ");
      throw new Error(`invalid_args:${name}:${msg}`);
    }
    return await t.handler(parsed.data);
  }

  get handlers() {
    return Object.fromEntries(
      [...this._tools.entries()].map(([n, t]) => [n, (args) => this.call(n, args)])
    );
  }

  toOpenAITools() {
    const result = [];

    for (const t of this._tools.values()) {
      // ✅ convert zod -> JSON Schema without refs or definitions
      const jsonSchema = zodToJsonSchema(t.schema, {
        name: t.name,
        $refStrategy: "none", // critical line
        target: "openai"      // ensures openai-friendly schema
      });

      // Some versions of zod-to-json-schema wrap schema inside a { definitions: { ... } } object.
      // Extract the nested object if that happens:
      const parameters =
        jsonSchema.definitions && jsonSchema.definitions[t.name]
          ? jsonSchema.definitions[t.name]
          : jsonSchema;

      if (parameters.type !== "object" || !parameters.properties) {
        throw new Error(
          `Tool ${t.name} schema must be z.object(...). Got: ${JSON.stringify(parameters).slice(0, 200)}`
        );
      }

      result.push({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters
        }
      });
    }

    return result;
  }
}
export function listToolsForLLM() {
  // Convert your internal tool objects to the shape your LLM runtime expects
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.schema, // if your runner consumes zod directly; else convert
  }));
}

export async function runToolByName(name, args, ctx) {
  const tool = tools.find(t => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool.run(args, ctx);
}