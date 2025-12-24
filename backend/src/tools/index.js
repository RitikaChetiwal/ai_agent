import { ToolRegistry } from "../agent/ToolRegistry.js";
import { timeParse } from "./timeParse.js";
import { scheduleAlarm, listAlarms } from "./scheduleAlarm.js";
import { webAutomate } from "./webAutomate.js";
import { vault } from "./vault.js";
import { z } from "zod";
import { sendEmail } from "./sendEmail.js";
import bulkSendTemplate from "./bulkSendTemplates.js";

export function buildTools() {
  const tools = new ToolRegistry();
  tools.register(timeParse.name, timeParse.schema, timeParse.handler, timeParse.description);
  tools.register(scheduleAlarm.name, scheduleAlarm.schema, scheduleAlarm.handler, scheduleAlarm.description);
  tools.register(webAutomate.name, webAutomate.schema, webAutomate.handler, webAutomate.description);
  tools.register(vault.name, vault.schema, vault.handler, vault.description);
  tools.register(sendEmail.name, sendEmail.schema, sendEmail.run, sendEmail.description);
  tools.register(bulkSendTemplate.name, bulkSendTemplate.schema, bulkSendTemplate.run, bulkSendTemplate.description);

  // Optional helper tool to list alarms (for UI/testing)
  tools.register(
    "list_alarms",
    z.object({}),
    async () => ({ items: listAlarms() }),
    "List scheduled alarms."
  );

  return tools;
}
