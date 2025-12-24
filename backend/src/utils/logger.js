import pino from "pino";

export const logger = {
  info: (...a) => console.log("[INFO]", ...a),
  warn: (...a) => console.warn("[WARN]", ...a),
  error: (...a) => console.error("[ERROR]", ...a)
};

const logger2 = pino({ level: process.env.LOG_LEVEL || "info" });
export default logger2;