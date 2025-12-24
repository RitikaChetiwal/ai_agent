// scheduler/reminders.js
import cron from 'node-cron';
import axios from 'axios';
import 'dotenv/config';

// ✅ your server listens on 5001 in server.js
const API_INTERNAL = 'http://localhost:5000';

export function startReminderCron() {
  console.log('[CRON] scheduler loading… (TZ=Asia/Kolkata)');

  // Optional heartbeat
  cron.schedule(
    '*/1 * * * *',
    () => {
      console.log('[CRON] tick (minute) — scheduler is alive');
    },
    { timezone: 'Asia/Kolkata' }
  );

  // ✅ Daily run at 1:50 PM IST
  // minute hour * * *
  cron.schedule(
    '30 16 * * *',
    async () => {
      try {
        console.log('[CRON] 16:30 IST → running Studio reminders for tomorrow…');
        const r = await axios.post(
          `${API_INTERNAL}/twilio/studio/run-reminders`
        );
        console.log('[CRON] Done:', r.data);
      } catch (e) {
        console.error('[CRON] Failed:', e.response?.data || e.message);
      }
    },
    { timezone: 'Asia/Kolkata' }
  );
}