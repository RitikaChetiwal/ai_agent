import { Router } from 'express';
import {
  inboundVoice,
  gatherHandler,
  outboundDial,
  outboundAnswerTwiML,
  callStatus,
  listCallHistory,
  getCallBySid,
  startStudioReminder,
  runStudioReminders,
  reminderCallback,
} from '../controller/twilioController.js';
import Caller from '../models/Caller.js';

const router = Router();

router.post('/voice/inbound', inboundVoice);
router.post('/voice/gather', gatherHandler);
router.post('/voice/outbound', outboundDial);
router.post('/voice/outbound/twiml', outboundAnswerTwiML);

// NEW: status webhook from Twilio
router.post('/voice/status', callStatus);

// routes/twilio.js
// Optional debug route — requires Caller import above
router.get('/caller/:phone', async (req, res) => {
  const raw = req.params.phone || '';
  const phone = raw.startsWith('+') ? raw : '+' + raw.replace(/\D/g, '');
  const doc = await Caller.findOne({ phone }).lean();
  res.json(doc || {});
});

// NEW: your own history APIs
router.get('/voice/history', listCallHistory);
router.get('/voice/history/:sid', getCallBySid);

router.post('/studio/reminder', startStudioReminder);   // trigger one call
router.post('/studio/run-reminders', runStudioReminders); // trigger batch for tomorrow

// Studio → HTTP Request widget posts here after user presses 1 or 2
router.post('/studio/reminder-callback', reminderCallback);


export default router;