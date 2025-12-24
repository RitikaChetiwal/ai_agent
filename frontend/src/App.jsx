import { useState, useEffect, useRef } from 'react'
import {
  runAgent, listAlarms, sendEmail, scheduleEmail, listEmailTemplates, sendEmailTemplate, sendBulkTemplate, scheduleBulkTemplate, startAICall
} from './api/agent'

window.api = { sendEmail, scheduleEmail, startAICall };

export default function App() {
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [alarms, setAlarms] = useState([])

  // email state
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [emailResp, setEmailResp] = useState(null)

  // template state
  const [templates, setTemplates] = useState(["Template1", "Template2", "Template3"])
  const [tplData, setTplData] = useState({})
  const [previewTpl, setPreviewTpl] = useState(null)

  const [bulkTo, setBulkTo] = useState("")
  const [bulkTplId, setBulkTplId] = useState("")
  const [bulkResp, setBulkResp] = useState(null)

  // scheduling
  const [sendLaterList, setSendLaterList] = useState(false);
  const [whenList, setWhenList] = useState("");
  const [relMinList, setRelMinList] = useState("");
  const [sendLaterCSV, setSendLaterCSV] = useState(false);
  const [whenCSV, setWhenCSV] = useState("");
  const [relMinCSV, setRelMinCSV] = useState("");

  // CSV state
  const [csvHeaders, setCsvHeaders] = useState([])
  const [csvRows, setCsvRows] = useState([])
  const [csvToCol, setCsvToCol] = useState("")
  const [csvMap, setCsvMap] = useState({})

  const [bulkMode, setBulkMode] = useState('paste');
  const [scheduleISO, setScheduleISO] = useState("");
  const [draft, setDraft] = useState(null);

  // NEW: Twilio/Voice features
  const [activeTab, setActiveTab] = useState('agent'); // agent, email, bulk, voice, callers, history
  const [callPhone, setCallPhone] = useState('');
  const [callHistory, setCallHistory] = useState([]);
  const [callers, setCallers] = useState([]);
  const [selectedCall, setSelectedCall] = useState(null);
  const [selectedCaller, setSelectedCaller] = useState(null);

  // Studio reminders
  const [reminderPhone, setReminderPhone] = useState('');
  const [reminderName, setReminderName] = useState('');
  const [reminderDate, setReminderDate] = useState('');
  const [reminderTime, setReminderTime] = useState('');
  const [reminderDoctor, setReminderDoctor] = useState('');

  // Call initiation message
  const [callMessage, setCallMessage] = useState('');

  const canScheduleCSV = !busy
    && !!bulkTplId && csvRows.length > 0
    && !!csvToCol
    && (!sendLaterCSV || (!!whenCSV || !!relMinCSV));

  const audioRef = useRef(null);
  const API = import.meta.env.VITE_API_BASE || 'http://localhost:5001';

  // Load call history
  const loadCallHistory = async () => {
    try {
      const response = await fetch(`${API}/twilio/voice/history?limit=50`);
      const data = await response.json();
      console.log('📞 Call History Response:', data);
      if (data.length > 0) {
        console.log('📞 First call structure:', data[0]);
        console.log('📞 Available ID fields:', {
          sid: data[0].sid,
          callSid: data[0].callSid,
          _id: data[0]._id
        });
      }
      setCallHistory(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to load call history:', e);
    }
  };

  // Load callers
  const loadCallers = async () => {
    try {
      // This would need a backend endpoint - for now using mock
      // In production, add GET /twilio/callers endpoint
      setCallers([]);
    } catch (e) {
      console.error('Failed to load callers:', e);
    }
  };

  useEffect(() => {
    const es = new EventSource(`${API}/events`);
    es.addEventListener("alarm", (ev) => {
      const payload = JSON.parse(ev.data);
      audioRef.current?.play?.();
      if (Notification.permission === "granted") {
        new Notification("Reminder", { body: payload.message });
      }
    });
    return () => es.close();
  }, []);

  useEffect(() => {
    if (Notification && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // Load data when switching tabs
  useEffect(() => {
    if (activeTab === 'history') loadCallHistory();
    if (activeTab === 'callers') loadCallers();
  }, [activeTab]);

  // Clear error when switching tabs
  useEffect(() => {
    setError('');
    setCallMessage('');
  }, [activeTab]);

  // --- Assistant Rules (free text) ---
  const DEFAULT_RULES = [
    "You are an AI receptionist for SmileBright Dental Care.",
    "ONLY handle dental appointments: book, cancel, reschedule.",
    "Politely refuse anything non-dental: 'Sorry, I can only assist with dental appointments.'",
    "Keep replies under 25 words. Be warm and concise.",
    "If name unknown: ask once, then remember.",
    "If urgent pain: offer earliest slot politely.",
    "Recognize date/time/doctor names (e.g., Dr. Mehta) and confirm.",
  ].join("\n");

  const [rulesText, setRulesText] = useState(() =>
    localStorage.getItem("assistant.rulesText.v1") || DEFAULT_RULES
  );

  useEffect(() => {
    localStorage.setItem("assistant.rulesText.v1", rulesText || "");
  }, [rulesText]);


  const onSendEmail = async () => {
    setBusy(true); setError(''); setEmailResp(null);
    try {
      const cleanedTo = to.split(",").map(s => s.trim()).filter(Boolean);
      if (cleanedTo.length === 0) {
        throw new Error("Please enter at least one recipient email.");
      }
      const payload = {
        to: cleanedTo.length === 1 ? cleanedTo[0] : cleanedTo,
        subject: subject || "(no subject)",
        text: message || "",
      };
      const data = await sendEmail(payload);
      setEmailResp(data);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onRun = async () => {
    setBusy(true); setError(''); setResult(null)
    try {
      const data = await runAgent({ goal })
      setResult(data)
      const maybe = extractJsonObject(data?.output || "");
      if (maybe && (maybe.type === "email_draft" || (maybe.subject && (maybe.text || maybe.html)))) {
        const toArr = Array.isArray(maybe.to)
          ? maybe.to
          : typeof maybe.to === "string"
            ? maybe.to.split(/[,;\n]/g).map(s => s.trim()).filter(Boolean)
            : [];
        setDraft({
          to: toArr,
          subject: maybe.subject || "",
          text: maybe.text || "",
          html: maybe.html || "",
          send_at_iso: maybe.send_at_iso || ""
        });
        setScheduleISO(maybe.send_at_iso || "");
      } else {
        setDraft(null);
        setScheduleISO("");
      }
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  const onListAlarms = async () => {
    setBusy(true);
    setError('')
    try {
      const data = await runAgent({
        goal: "List all alarms as JSON using the list_alarms tool and return only the JSON."
      })
      try {
        const parsed = JSON.parse(data?.output || '{}')
        setAlarms(parsed.items || [])
      } catch {
        const d = await listAlarms()
        setAlarms(d.items || d.data || [])
      }
    } catch (e) {
      setError(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  // NEW: Start AI call
  const onStartCall = async () => {
    if (!callPhone.trim()) { setError('Please enter a phone number'); return; }
    setBusy(true); setError(''); setCallMessage('');
    try {
      const r = await fetch(`${API}/twilio/voice/outbound`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: callPhone, rulesText }) // 👈 attach free-text rules
      });
      const data = await r.json();
      if (!r.ok) {
        // Check if it's an unverified number error
        const errorMsg = data?.error || 'Failed to start call';
        if (errorMsg.toLowerCase().includes('unverified') || errorMsg.toLowerCase().includes('not verified')) {
          throw new Error('The phone number is unverified. Please verify the number in your Twilio account.');
        }
        throw new Error(errorMsg);
      }

      // Only show success message AFTER successful API response
      setCallMessage('AI call is initiated via twilio');
      setEmailResp({ success: true, message: `Call initiated: ${data.sid}` });
      setCallPhone('');
      setTimeout(loadCallHistory, 1000);

      // Clear the message after 5 seconds
      setTimeout(() => setCallMessage(''), 5000);
    } catch (e) {
      setError(String(e?.message || e));
      setCallMessage(''); // Ensure call message is cleared on error
    } finally {
      setBusy(false);
    }
  };


  // NEW: Start Studio reminder
  const onStartReminder = async () => {
    if (!reminderPhone || !reminderDate || !reminderTime) {
      setError('Phone, date, and time are required for reminders');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${API}/twilio/studio/reminder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: reminderPhone,
          name: reminderName,
          date: reminderDate,
          time: reminderTime,
          doctor: reminderDoctor,
          rulesText // 👈 attach free-text rules
        })
      });

      const data = await response.json();
      setEmailResp({ success: true, message: `Reminder scheduled: ${data.executionSid}` });
      setReminderPhone('');
      setReminderName('');
      setReminderDate('');
      setReminderTime('');
      setReminderDoctor('');
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  // NEW: Run batch reminders
  const onRunBatchReminders = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${API}/twilio/studio/run-reminders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rulesText }) // optional
      });

      const data = await response.json();
      setEmailResp({ success: true, message: `Batch reminders sent: ${data.count} calls` });
      setTimeout(loadCallHistory, 1000);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  // QUICK REMINDER: call just this number right now (using Studio Flow)
  const onRunQuickReminder = async () => {
    if (!reminderPhone) {
      setError('Phone is required for quick reminder');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${API}/twilio/studio/run-reminders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: reminderPhone }),
      });

      const data = await response.json();
      if (!response.ok || data.ok === false) {
        throw new Error(data?.error || 'Failed to start quick reminder');
      }

      setEmailResp({
        success: true,
        message: `Quick reminder call started to ${reminderPhone}`,
      });
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };


  // View call details
  const viewCallDetails = async (sid) => {
    try {
      const response = await fetch(`${API}/twilio/voice/history/${sid}`);
      const data = await response.json();
      setSelectedCall(data);
    } catch (e) {
      setError('Failed to load call details');
    }
  };

  function parseCSV(text) {
    const rows = [];
    let i = 0, field = '', row = [], inQuotes = false;
    function pushField() { row.push(field); field = ''; }
    function pushRow() { rows.push(row); row = []; }

    while (i < text.length) {
      const c = text[i++];
      if (c === '"') {
        if (inQuotes && text[i] === '"') { field += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (c === ',' && !inQuotes) {
        pushField();
      } else if ((c === '\n' || c === '\r') && !inQuotes) {
        if (c === '\r' && text[i] === '\n') i++;
        pushField(); pushRow();
      } else {
        field += c;
      }
    }
    if (field.length || row.length) { pushField(); pushRow(); }
    if (!rows.length) return { headers: [], data: [] };
    const headers = rows.shift().map(h => h.trim());
    const data = rows.filter(r => r.length && r.some(x => x.trim() !== ''))
      .map(r => Object.fromEntries(headers.map((h, idx) => [h, (r[idx] ?? '').trim()])));
    return { headers, data };
  }

  function extractPlaceholders(tpl = {}) {
    const all = [tpl.subject, tpl.html, tpl.text].filter(Boolean).join(' ');
    const matches = Array.from(all.matchAll(/{{\s*([\w.]+)\s*}}/g)).map(m => m[1]);
    return Array.from(new Set(matches));
  }

  function emailsCount(s) {
    return (s || "").split(/[\n,]/g).map(x => x.trim()).filter(Boolean).length || 0;
  }

  function extractJsonObject(str = "") {
    const fence = str.match(/```json\s*([\s\S]*?)```/i);
    if (fence) {
      try { return JSON.parse(fence[1]); } catch { }
    }
    const brace = str.indexOf("{");
    if (brace === -1) return null;
    let depth = 0, i = brace;
    for (; i < str.length; i++) {
      if (str[i] === "{") depth++;
      if (str[i] === "}") { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) return null;
    try {
      return JSON.parse(str.slice(brace, i + 1));
    } catch {
      return null;
    }
  }

  const onScheduleBulk = async (evt) => {
    evt?.preventDefault();
    setBusy(true);
    setError('');
    setBulkResp(null);
    try {
      let whenISO = scheduleISO;
      if (!whenISO && sendLaterList) {
        if (whenList) {
          whenISO = whenList;
        } else if (relMinList) {
          const now = new Date();
          now.setMinutes(now.getMinutes() + Number(relMinList));
          whenISO = now.toISOString();
        }
      }
      if (bulkMode === 'paste') {
        const emailArr = bulkTo.split(/[\n,]/g).map(s => s.trim()).filter(Boolean);
        if (emailArr.length === 0) throw new Error("No emails provided.");
        const payload = { templateId: bulkTplId, emails: emailArr };
        let data;
        if (whenISO) {
          payload.whenISO = whenISO;
          data = await scheduleBulkTemplate(payload);
        } else {
          data = await sendBulkTemplate(payload);
        }
        setBulkResp(data);
      } else {
        if (!csvToCol) throw new Error("Please select the email column.");
        const recipientsWithParams = csvRows.map(row => ({
          email: row[csvToCol],
          params: Object.fromEntries(Object.entries(csvMap).map(([k, v]) => [k, row[v] || '']))
        }));
        const payload = { templateId: bulkTplId, recipientsWithParams };
        let data;
        if (whenISO) {
          payload.whenISO = whenISO;
          data = await scheduleBulkTemplate(payload);
        } else {
          data = await sendBulkTemplate(payload);
        }
        setBulkResp(data);
      }
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden" style={{
      background: '#435663',
      backgroundSize: '400% 400%',
      animation: 'gradientShift 15s ease infinite'
    }}>
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute w-96 h-96 bg-white/10 rounded-full blur-3xl -top-48 -left-48" style={{ animation: 'float 20s ease-in-out infinite' }} />
        <div className="absolute w-96 h-96 bg-purple-500/10 rounded-full blur-3xl top-1/3 -right-48" style={{ animation: 'float 25s ease-in-out infinite 5s' }} />
        <div className="absolute w-96 h-96 bg-blue-500/10 rounded-full blur-3xl bottom-0 left-1/3" style={{ animation: 'float 30s ease-in-out infinite 10s' }} />
      </div>

      <div className="relative max-w-6xl mx-auto p-8">
        {/* Header */}
        <header className="text-center mb-12 animate-slideUp">
          <h1 className="text-6xl font-black mb-4 tracking-tight h-20" style={{
            background: 'linear-gradient(135deg, #ffffff 0%, #e0e7ff 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            textShadow: '0 4px 20px rgba(0,0,0,0.2)'
          }}>
            🤖 AI Agent Console
          </h1>
          <p className="text-xl text-white/90 font-medium">Multi-Channel Automation Hub</p>
        </header>

        {/* Tab Navigation */}
        <div className="mb-8 flex gap-2 flex-wrap justify-center animate-slideUp">
          {[
            { id: 'agent', icon: '🤖', label: 'Agent' },
            { id: 'email', icon: '📧', label: 'Email' },
            { id: 'voice', icon: '📞', label: 'Voice Calls' },
            { id: 'history', icon: '📊', label: 'Call History' },
            { id: 'rules', icon: '🛡️', label: 'Rules' },
            { id: 'alarms', icon: '⏰', label: 'Alarms' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="px-6 py-3 rounded-xl font-semibold transition-all duration-300 transform hover:scale-105"
              style={{
                background: activeTab === tab.id
                  ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                  : 'rgba(255, 255, 255, 0.15)',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                color: '#ffffff',
                boxShadow: activeTab === tab.id ? '0 8px 32px rgba(102, 126, 234, 0.4)' : 'none'
              }}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Agent Tab */}
        {activeTab === 'agent' && (
          <section className="rounded-2xl p-8 mb-6 backdrop-blur-xl border border-white/20 shadow-2xl animate-slideUp" style={{
            background: 'rgba(255, 255, 255, 0.1)'
          }}>
            <h2 className="text-3xl font-bold text-white mb-6 flex items-center gap-3">
              <span>🎯</span>
              Task Agent
            </h2>
            <textarea
              className="w-full rounded-xl p-4 mb-4 font-mono text-base backdrop-blur-xl border-2 border-white/30 focus:border-purple-400 transition-all duration-200 resize-none"
              style={{
                background: 'rgba(255, 255, 255, 0.95)',
                minHeight: '120px'
              }}
              placeholder="Enter your task here... (e.g., 'Draft an email to john@example.com about the Q4 meeting')"
              value={goal}
              onChange={e => setGoal(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  onRun();
                }
              }}
            />
            <div className="flex gap-4">
              <button
                className="flex-1 py-3.5 rounded-xl font-bold text-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-105 shadow-xl"
                style={{
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: '#ffffff'
                }}
                onClick={onRun}
                disabled={busy || !goal.trim()}
              >
                {busy ? '🔄 Processing...' : '🚀 Run Agent'}
              </button>
            </div>
            {result && (
              <div className="mt-6 rounded-xl p-6 backdrop-blur-xl border border-white/30 animate-fadeIn" style={{
                background: 'rgba(255, 255, 255, 0.95)'
              }}>
                <h3 className="text-xl font-bold text-gray-800 mb-3 flex items-center gap-2">
                  <span>✅</span>
                  Agent Response
                </h3>
                <pre className="whitespace-pre-wrap text-gray-700 text-sm font-mono bg-gray-50 p-4 rounded-lg border border-gray-200 overflow-auto max-h-96">
                  {result.output || JSON.stringify(result, null, 2)}
                </pre>
              </div>
            )}
          </section>
        )}

        {/* Email Tab */}
        {activeTab === 'email' && (
          <section className="rounded-2xl p-8 mb-6 backdrop-blur-xl border border-white/20 shadow-2xl animate-slideUp" style={{
            background: 'rgba(255, 255, 255, 0.1)'
          }}>
            <h2 className="text-3xl font-bold text-white mb-6 flex items-center gap-3">
              <span>📧</span>
              Send Email
            </h2>
            <div className="space-y-4">
              <input
                className="w-full rounded-xl p-4 backdrop-blur-xl border-2 border-white/30 focus:border-purple-400 transition-all duration-200"
                style={{ background: 'rgba(255, 255, 255, 0.95)' }}
                placeholder="To (comma-separated)"
                value={to}
                onChange={e => setTo(e.target.value)}
              />
              <input
                className="w-full rounded-xl p-4 backdrop-blur-xl border-2 border-white/30 focus:border-purple-400 transition-all duration-200"
                style={{ background: 'rgba(255, 255, 255, 0.95)' }}
                placeholder="Subject"
                value={subject}
                onChange={e => setSubject(e.target.value)}
              />
              <textarea
                className="w-full rounded-xl p-4 backdrop-blur-xl border-2 border-white/30 focus:border-purple-400 transition-all duration-200 resize-none"
                style={{ background: 'rgba(255, 255, 255, 0.95)', minHeight: '150px' }}
                placeholder="Message"
                value={message}
                onChange={e => setMessage(e.target.value)}
              />
              <button
                className="w-full py-3.5 rounded-xl font-bold text-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-105 shadow-xl"
                style={{
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: '#ffffff'
                }}
                onClick={onSendEmail}
                disabled={busy}
              >
                {busy ? '📤 Sending...' : '🚀 Send Email'}
              </button>
            </div>
            {emailResp && (
              <div className="mt-6 rounded-xl p-6 backdrop-blur-xl border border-green-300 animate-fadeIn" style={{
                background: 'rgba(220, 252, 231, 0.95)'
              }}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">✅</span>
                  <div>
                    <strong className="text-green-700 text-lg">Success!</strong>
                    <p className="text-green-600 mt-1">{emailResp.message || 'Email sent successfully'}</p>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Bulk Mail Tab */}
        {activeTab === 'bulk' && (
          <section className="rounded-2xl p-8 mb-6 backdrop-blur-xl border border-white/20 shadow-2xl animate-slideUp" style={{
            background: 'rgba(255, 255, 255, 0.1)'
          }}>
            <h2 className="text-3xl font-bold text-white mb-6 flex items-center gap-3">
              <span>📨</span>
              Bulk Email
            </h2>
            <div className="space-y-4">
              <div className="flex gap-4 mb-4">
                <button
                  onClick={() => setBulkMode('paste')}
                  className="flex-1 py-3 rounded-xl font-semibold transition-all duration-200"
                  style={{
                    background: bulkMode === 'paste'
                      ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                      : 'rgba(255, 255, 255, 0.2)',
                    color: '#ffffff'
                  }}
                >
                  📝 Paste List
                </button>
                <button
                  onClick={() => setBulkMode('csv')}
                  className="flex-1 py-3 rounded-xl font-semibold transition-all duration-200"
                  style={{
                    background: bulkMode === 'csv'
                      ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                      : 'rgba(255, 255, 255, 0.2)',
                    color: '#ffffff'
                  }}
                >
                  📊 CSV Upload
                </button>
              </div>

              <select
                className="w-full rounded-xl p-4 backdrop-blur-xl border-2 border-white/30"
                style={{ background: 'rgba(255, 255, 255, 0.95)' }}
                value={bulkTplId}
                onChange={e => setBulkTplId(e.target.value)}
              >
                <option value="">Select Template</option>
                {templates.map(t => <option key={t} value={t}>{t}</option>)}
              </select>

              {bulkMode === 'paste' ? (
                <textarea
                  className="w-full rounded-xl p-4 backdrop-blur-xl border-2 border-white/30 resize-none"
                  style={{ background: 'rgba(255, 255, 255, 0.95)', minHeight: '150px' }}
                  placeholder="Enter emails (one per line or comma-separated)"
                  value={bulkTo}
                  onChange={e => setBulkTo(e.target.value)}
                />
              ) : (
                <div>
                  <input
                    type="file"
                    accept=".csv"
                    className="w-full p-4 rounded-xl backdrop-blur-xl border-2 border-white/30"
                    style={{ background: 'rgba(255, 255, 255, 0.95)' }}
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        const { headers, data } = parseCSV(reader.result);
                        setCsvHeaders(headers);
                        setCsvRows(data);
                        if (headers.length) setCsvToCol(headers[0]);
                      };
                      reader.readAsText(file);
                    }}
                  />
                  {csvHeaders.length > 0 && (
                    <div className="mt-4 p-4 rounded-xl" style={{ background: 'rgba(255, 255, 255, 0.95)' }}>
                      <p className="font-semibold text-gray-700 mb-2">Select Email Column:</p>
                      <select
                        className="w-full p-3 rounded-lg border-2 border-gray-300"
                        value={csvToCol}
                        onChange={e => setCsvToCol(e.target.value)}
                      >
                        {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}

              <button
                className="w-full py-3.5 rounded-xl font-bold text-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-105 shadow-xl"
                style={{
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: '#ffffff'
                }}
                onClick={onScheduleBulk}
                disabled={busy || !bulkTplId || (bulkMode === 'paste' ? !bulkTo.trim() : csvRows.length === 0)}
              >
                {busy ? '📤 Sending...' : '🚀 Send Bulk Emails'}
              </button>
            </div>
            {bulkResp && (
              <div className="mt-6 rounded-xl p-6 backdrop-blur-xl border border-green-300 animate-fadeIn" style={{
                background: 'rgba(220, 252, 231, 0.95)'
              }}>
                <strong className="text-green-700 text-lg">Bulk emails processed!</strong>
              </div>
            )}
          </section>
        )}

        {/* Voice Calls Tab */}
        {activeTab === 'voice' && (
          <section className="rounded-2xl p-8 mb-6 backdrop-blur-xl border border-white/20 shadow-2xl animate-slideUp" style={{
            background: 'rgba(255, 255, 255, 0.1)'
          }}>
            <h2 className="text-3xl font-bold text-white mb-6 flex items-center gap-3">
              <span>📞</span>
              Voice Calls & Reminders
            </h2>



            {/* Quick Call */}
            <div className="mb-8 p-6 rounded-xl backdrop-blur-xl border border-white/30" style={{
              background: 'rgba(255, 255, 255, 0.95)'
            }}>
              <h3 className="text-xl font-bold text-gray-800 mb-4">🎙️ Start AI Call</h3>
              <div className="flex gap-4">
                <input
                  className="flex-1 rounded-xl p-4 border-2 border-gray-300 focus:border-purple-500 transition-all duration-200"
                  placeholder="Phone number (e.g., +919876543210)"
                  value={callPhone}
                  onChange={e => setCallPhone(e.target.value)}
                />
                <button
                  className="px-8 py-3.5 rounded-xl font-bold text-lg transition-all duration-200 disabled:opacity-50 transform hover:scale-105 shadow-lg"
                  style={{
                    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                    color: '#ffffff'
                  }}
                  onClick={onStartCall}
                  disabled={busy}
                >
                  📞 Call Now
                </button>
              </div>
              <p className="text-xs text-gray-600 mt-2 line-clamp-2">
                Using rules: {rulesText.split("\n")[0] || "(no rules)"}
              </p>

              {/* Call Initiation Message */}
              {callMessage && (
                <div className="mt-4 p-4 rounded-xl backdrop-blur-xl border border-green-300 animate-fadeIn" style={{
                  background: 'rgba(220, 252, 231, 0.95)'
                }}>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">📞</span>
                    <strong className="text-green-700 text-lg">{callMessage}</strong>
                  </div>
                </div>
              )}

              {/* Error Message for Voice Tab */}
              {error && !callMessage && (
                <div className="mt-4 p-4 rounded-xl backdrop-blur-xl border border-red-300 animate-shake" style={{
                  background: 'rgba(254, 226, 226, 0.95)'
                }}>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">⚠️</span>
                    <div>
                      <strong className="text-red-600 text-lg">Error</strong>
                      <p className="text-red-700 mt-1">{error}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 🔸 Quick one-off reminder call */}
            <div
              className="mb-8 p-4 rounded-xl border border-dashed border-yellow-400 flex flex-col sm:flex-row items-center gap-4"
              style={{ background: 'rgba(255, 255, 255, 0.96)' }}>
              <div className="flex-1 w-full">
                <p className="text-sm font-semibold text-yellow-800 mb-1">
                  🧪 Quick Reminder — Call this number now using the Studio reminder flow
                </p>
                <input
                  className="w-full rounded-xl p-3 border-2 border-gray-300 focus:border-yellow-500 transition-all"
                  placeholder="Enter phone number (e.g. +91XXXXXXXXXX)"
                  value={reminderPhone}
                  onChange={(e) => setReminderPhone(e.target.value)}
                />
              </div>
              <button
                onClick={onRunQuickReminder}
                disabled={busy}
                className="px-4 py-3 mt-4 rounded-xl font-bold shadow-lg transform hover:scale-105 transition-all duration-200 disabled:opacity-50"
                style={{
                  background: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
                  color: '#ffffff',
                  whiteSpace: 'nowrap',
                }}
              >
                📞 Call
              </button>
            </div>

            {/* Studio Reminder */}
            <div className="mb-8 p-6 rounded-xl backdrop-blur-xl border border-white/30" style={{
              background: 'rgba(255, 255, 255, 0.95)'
            }}>
              <h3 className="text-xl font-bold text-gray-800 mb-4">🔔 Schedule Appointment Reminder</h3>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <input
                  className="rounded-xl p-4 border-2 border-gray-300 focus:border-purple-500 transition-all"
                  placeholder="Phone number"
                  value={reminderPhone}
                  onChange={e => setReminderPhone(e.target.value)}
                />
                <input
                  className="rounded-xl p-4 border-2 border-gray-300 focus:border-purple-500 transition-all"
                  placeholder="Patient name"
                  value={reminderName}
                  onChange={e => setReminderName(e.target.value)}
                />
                <input
                  className="rounded-xl p-4 border-2 border-gray-300 focus:border-purple-500 transition-all"
                  placeholder="Date (e.g., 12 Nov 2025)"
                  value={reminderDate}
                  onChange={e => setReminderDate(e.target.value)}
                />
                <input
                  className="rounded-xl p-4 border-2 border-gray-300 focus:border-purple-500 transition-all"
                  placeholder="Time (e.g., 11:30 AM)"
                  value={reminderTime}
                  onChange={e => setReminderTime(e.target.value)}
                />
                <input
                  className="rounded-xl p-4 border-2 border-gray-300 focus:border-purple-500 transition-all col-span-2"
                  placeholder="Doctor name (optional)"
                  value={reminderDoctor}
                  onChange={e => setReminderDoctor(e.target.value)}
                />
              </div>
              <div className="flex gap-4">
                <button
                  className="flex-1 py-3.5 rounded-xl font-bold text-lg transition-all duration-200 disabled:opacity-50 transform hover:scale-105 shadow-lg"
                  style={{
                    background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                    color: '#ffffff'
                  }}
                  onClick={onStartReminder}
                  disabled={busy}
                >
                  📅 Schedule Single Reminder
                </button>
                <button
                  className="flex-1 py-3.5 rounded-xl font-bold text-lg transition-all duration-200 disabled:opacity-50 transform hover:scale-105 shadow-lg"
                  style={{
                    background: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
                    color: '#ffffff'
                  }}
                  onClick={onRunBatchReminders}
                  disabled={busy}
                >
                  📢 Run Batch Reminders (Tomorrow)
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Call History Tab */}
        {activeTab === 'history' && (
          <section className="rounded-2xl p-8 mb-6 backdrop-blur-xl border border-white/20 shadow-2xl animate-slideUp" style={{
            background: 'rgba(255, 255, 255, 0.1)'
          }}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-3xl font-bold text-white flex items-center gap-3">
                <span>📊</span>
                Call History
              </h2>
              <button
                className="px-6 py-3 rounded-xl font-semibold transition-all duration-200 transform hover:scale-105"
                style={{
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: '#ffffff'
                }}
                onClick={loadCallHistory}
              >
                🔄 Refresh
              </button>
            </div>

            {callHistory.length === 0 ? (
              <div className="text-center py-12 rounded-xl backdrop-blur-xl" style={{
                background: 'rgba(255, 255, 255, 0.95)'
              }}>
                <p className="text-gray-500 text-lg">No call history yet</p>
              </div>
            ) : (
              <div className="space-y-4">
                {callHistory.map((call, idx) => (
                  <div
                    key={idx}
                    className="p-6 rounded-xl backdrop-blur-xl border border-white/30 hover:border-purple-400 transition-all duration-200 cursor-pointer transform hover:scale-[1.02]"
                    style={{ background: 'rgba(255, 255, 255, 0.95)' }}
                    onClick={() => viewCallDetails(call.sid || call.callSid || call._id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="text-2xl">
                            {call.direction === 'outbound' ? '📞' : '📲'}
                          </span>
                          <div>
                            <p className="font-bold text-gray-800 text-lg">
                              {call.callerName || 'Unknown Caller'}
                            </p>
                            <p className="text-gray-600 text-sm">
                              {call.direction === 'outbound' ? `To: ${call.to}` : `From: ${call.from}`}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-6 text-sm text-gray-600 mt-3">
                          <span className="flex items-center gap-1">
                            <strong>Status:</strong>
                            <span className={`px-2 py-1 rounded-full text-xs font-semibold ${call.status === 'completed' ? 'bg-green-100 text-green-700' :
                              call.status === 'in-progress' ? 'bg-blue-100 text-blue-700' :
                                'bg-gray-100 text-gray-700'
                              }`}>
                              {call.status}
                            </span>
                          </span>
                          {call.durationSec && (
                            <span><strong>Duration:</strong> {Math.floor(call.durationSec / 60)}m {call.durationSec % 60}s</span>
                          )}
                          {call.appointmentStatus && (
                            <span><strong>Appointment:</strong> {call.appointmentStatus}</span>
                          )}
                        </div>
                        {(call.appointmentDate || call.appointmentTime || call.doctorName) && (
                          <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                            <p className="text-sm text-blue-800">
                              <strong>Appointment Details:</strong> {call.appointmentDate} {call.appointmentTime}
                              {call.doctorName && ` with ${call.doctorName}`}
                            </p>
                          </div>
                        )}
                      </div>
                      <div className="text-right text-sm text-gray-500">
                        {new Date(call.startedAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Call Details Modal */}
        {selectedCall && (
          <div className="fixed inset-0  backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setSelectedCall(null)}>
            <div className="rounded-2xl w-full max-w-4xl shadow-2xl animate-scaleIn flex flex-col h-200" style={{
              background: 'white'
            }} onClick={(e) => e.stopPropagation()}>
              {/* Header - Fixed */}
              <div className="p-5 border-b border-gray-200 flex-shrink-0" style={{
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
              }}>
                <div className="flex items-center justify-between">
                  <h3 className="text-2xl font-bold text-white">📞 Call Details</h3>
                  <button
                    className="bg-white/20 hover:bg-white/30 text-white rounded-lg w-10 h-10 flex items-center justify-center transition-colors"
                    onClick={() => setSelectedCall(null)}
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Content - Scrollable */}
              <div className="p-6 overflow-y-auto flex-1" style={{ minHeight: 0 }}>
                <div className="space-y-4">
                  {/* Appointment Info - Prominent */}
                  {(selectedCall.appointmentStatus || selectedCall.appointmentDate || selectedCall.appointmentTime || selectedCall.doctorName) && (
                    <div className="p-4 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border-2 border-blue-300 shadow-sm">
                      <p className="font-bold text-blue-900 mb-3 text-base flex items-center gap-2">
                        <span>📅</span> Appointment Information
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        {selectedCall.appointmentStatus && (
                          <div className="p-2.5 bg-white rounded-lg border border-blue-200">
                            <p className="text-xs text-gray-600 mb-0.5 uppercase font-semibold">STATUS</p>
                            <p className={`font-bold text-sm ${selectedCall.appointmentStatus === 'booked' ? 'text-green-700' :
                              selectedCall.appointmentStatus === 'cancelled' ? 'text-red-700' :
                                'text-yellow-700'
                              }`}>
                              {selectedCall.appointmentStatus.toUpperCase()}
                            </p>
                          </div>
                        )}
                        {selectedCall.appointmentDate && (
                          <div className="p-2.5 bg-white rounded-lg border border-blue-200">
                            <p className="text-xs text-gray-600 mb-0.5 uppercase font-semibold">DATE</p>
                            <p className="font-semibold text-sm text-gray-900">{selectedCall.appointmentDate}</p>
                          </div>
                        )}
                        {selectedCall.appointmentTime && (
                          <div className="p-2.5 bg-white rounded-lg border border-blue-200">
                            <p className="text-xs text-gray-600 mb-0.5 uppercase font-semibold">TIME</p>
                            <p className="font-semibold text-sm text-gray-900">{selectedCall.appointmentTime}</p>
                          </div>
                        )}
                        {selectedCall.doctorName && (
                          <div className="p-2.5 bg-white rounded-lg border border-blue-200">
                            <p className="text-xs text-gray-600 mb-0.5 uppercase font-semibold">DOCTOR</p>
                            <p className="font-semibold text-sm text-gray-900">{selectedCall.doctorName}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Caller Name */}
                  {selectedCall.callerName && (
                    <div className="p-3 bg-purple-50 rounded-lg border border-purple-200">
                      <p className="text-xs text-purple-600 mb-0.5">👤 Caller Name</p>
                      <p className="font-semibold text-base text-purple-900">{selectedCall.callerName}</p>
                    </div>
                  )}

                  {/* Call Metadata - Compact Grid */}
                  <div className="grid grid-cols-2 gap-3">
                    {selectedCall.from && (
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <p className="text-xs text-gray-600 mb-0.5">From</p>
                        <p className="font-mono text-xs">{selectedCall.from}</p>
                      </div>
                    )}
                    {selectedCall.to && (
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <p className="text-xs text-gray-600 mb-0.5">To</p>
                        <p className="font-mono text-xs">{selectedCall.to}</p>
                      </div>
                    )}
                    {selectedCall.startedAt && (
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <p className="text-xs text-gray-600 mb-0.5">Started At</p>
                        <p className="text-xs">{new Date(selectedCall.startedAt).toLocaleString()}</p>
                      </div>
                    )}
                    {selectedCall.durationSec && (
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <p className="text-xs text-gray-600 mb-0.5">Duration</p>
                        <p className="font-semibold text-sm">{Math.floor(selectedCall.durationSec / 60)}m {selectedCall.durationSec % 60}s</p>
                      </div>
                    )}
                  </div>

                  {/* Transcript - Constrained Height */}
                  {selectedCall.transcripts && selectedCall.transcripts.length > 0 && (
                    <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                      <p className="font-bold text-blue-900 mb-3 text-sm">💬 Conversation Transcript</p>
                      <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                        {selectedCall.transcripts.map((t, idx) => (
                          <div key={idx} className={`p-2.5 rounded-lg ${t.from === 'caller' ? 'bg-white border border-gray-200' : 'bg-blue-100 border border-blue-200'
                            }`}>
                            <p className="text-xs text-gray-600 mb-1">
                              <strong>{t.from === 'caller' ? '👤 Caller' : '🤖 Assistant'}</strong>
                              {t.confidence && ` (${Math.round(t.confidence * 100)}% confidence)`}
                            </p>
                            <p className="text-sm">{t.text}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Footer - Fixed */}
              <div className="p-4 border-t border-gray-200 bg-gray-50 flex-shrink-0">
                <button
                  className="w-full py-2.5 rounded-xl font-semibold transition-all hover:opacity-90"
                  style={{
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    color: '#ffffff'
                  }}
                  onClick={() => setSelectedCall(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'rules' && (
          <section className="rounded-2xl p-8 mb-6 backdrop-blur-xl border border-white/20 shadow-2xl animate-slideUp"
            style={{ background: 'rgba(255, 255, 255, 0.1)' }}>
            <h2 className="text-3xl font-bold text-white mb-6 flex items-center gap-3">
              <span>🛡️</span>
              Assistant Rules (Free-text)
            </h2>

            <div className="p-6 rounded-xl border border-white/30"
              style={{ background: 'rgba(255,255,255,0.95)' }}>
              <p className="text-sm text-gray-600 mb-3">
                Write exactly how the assistant should behave. This text will be sent with every call/reminder.
              </p>
              <textarea
                className="w-full rounded-xl p-4 font-mono text-sm border-2 border-gray-300 focus:border-purple-500 transition-all duration-200"
                style={{ minHeight: 260 }}
                placeholder="Type your boundary conditions / instructions here…"
                value={rulesText}
                onChange={e => setRulesText(e.target.value)}
              />
              <div className="mt-3 flex gap-3">
                <button
                  className="px-5 py-2.5 rounded-xl font-semibold"
                  style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: '#fff' }}
                  onClick={() => {
                    localStorage.setItem("assistant.rulesText.v1", rulesText || "");
                    setEmailResp({ success: true, message: "Rules saved." });
                  }}
                >
                  💾 Save
                </button>
                <button
                  className="px-5 py-2.5 rounded-xl font-semibold border"
                  onClick={() => setRulesText(DEFAULT_RULES)}
                >
                  ♻️ Reset to dental defaults
                </button>
              </div>
            </div>
          </section>
        )}



        {/* Alarms Tab */}
        {activeTab === 'alarms' && (
          <section className="rounded-2xl p-8 mb-6 backdrop-blur-xl border border-white/20 shadow-2xl animate-slideUp" style={{
            background: 'rgba(255, 255, 255, 0.1)'
          }}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-3xl font-bold text-white flex items-center gap-3">
                <span>⏰</span>
                Scheduled Alarms
              </h2>
              <button
                className="px-6 py-3 rounded-xl font-semibold transition-all duration-200 transform hover:scale-105"
                style={{
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: '#ffffff'
                }}
                onClick={onListAlarms}
                disabled={busy}
              >
                🔄 Refresh
              </button>
            </div>

            {alarms.length === 0 ? (
              <div className="text-center py-12 rounded-xl backdrop-blur-xl" style={{
                background: 'rgba(255, 255, 255, 0.95)'
              }}>
                <p className="text-gray-500 text-lg">No alarms scheduled</p>
              </div>
            ) : (
              <div className="space-y-4">
                {alarms.map((alarm, idx) => (
                  <div
                    key={idx}
                    className="p-6 rounded-xl backdrop-blur-xl border border-white/30"
                    style={{ background: 'rgba(255, 255, 255, 0.95)' }}
                  >
                    <div className="flex items-start gap-4">
                      <span className="text-3xl">⏰</span>
                      <div className="flex-1">
                        <p className="font-bold text-gray-800 text-lg mb-2">{alarm.message}</p>
                        <div className="flex gap-6 text-sm text-gray-600">
                          <span><strong>When:</strong> {new Date(alarm.when_iso).toLocaleString()}</span>
                          <span><strong>Channel:</strong> {alarm.channel}</span>
                        </div>
                        {alarm.payload && (
                          <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                            <p className="text-xs text-blue-800 font-mono">
                              <strong>Payload:</strong> {JSON.stringify(alarm.payload, null, 2)}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Draft Approval Modal */}
        {draft && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fadeIn" onClick={() => setDraft(null)}>
            <div className="rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden shadow-2xl border border-gray-300 animate-scaleIn" style={{
              background: 'white'
            }} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between p-6 border-b border-gray-200" style={{
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
              }}>
                <h3 className="text-2xl font-bold text-white m-0">✉️ Email Draft Approval</h3>
                <button
                  className="bg-white/20 hover:bg-white/30 border-none text-white cursor-pointer rounded-lg w-10 h-10 flex items-center justify-center transition-all duration-200"
                  onClick={() => setDraft(null)}
                >
                  ✕
                </button>
              </div>

              <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)] space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">To:</label>
                  <input
                    className="w-full p-3 rounded-lg border-2 border-gray-300 focus:border-purple-500 transition-all"
                    value={draft.to.join(', ')}
                    onChange={e => setDraft({ ...draft, to: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Subject:</label>
                  <input
                    className="w-full p-3 rounded-lg border-2 border-gray-300 focus:border-purple-500 transition-all"
                    value={draft.subject}
                    onChange={e => setDraft({ ...draft, subject: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Message:</label>
                  <textarea
                    className="w-full p-3 rounded-lg border-2 border-gray-300 focus:border-purple-500 transition-all resize-none"
                    style={{ minHeight: '200px' }}
                    value={draft.text}
                    onChange={e => setDraft({ ...draft, text: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Schedule (optional):</label>
                  <input
                    type="datetime-local"
                    className="w-full p-3 rounded-lg border-2 border-gray-300 focus:border-purple-500 transition-all"
                    value={scheduleISO.slice(0, 16)}
                    onChange={e => setScheduleISO(e.target.value ? new Date(e.target.value).toISOString() : '')}
                  />
                  {draft.send_at_iso && !scheduleISO && (
                    <small className="text-gray-500 text-xs mt-2 block">Draft suggested: {draft.send_at_iso}</small>
                  )}
                </div>
              </div>

              <div className="p-6 flex gap-3 justify-end border-t border-gray-200 bg-gray-50">
                <button
                  className="px-5 py-2.5 rounded-xl font-semibold border border-gray-300 text-gray-700 hover:bg-gray-100 transition-all duration-200"
                  onClick={() => setDraft(null)}
                >
                  Cancel
                </button>
                <button
                  className="px-5 py-2.5 rounded-xl font-semibold border border-gray-300 text-gray-700 hover:bg-gray-100 transition-all duration-200 disabled:opacity-50"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      setBusy(true);
                      setError('');
                      const again = await runAgent({
                        goal: `Please regenerate an improved version of this email draft. Keep the same intent.\n\nCurrent draft:\nTo: ${draft.to.join(', ')}\nSubject: ${draft.subject}\nBody:\n${draft.text}`
                      });
                      setResult(again);
                      const m2 = extractJsonObject(again?.output || "");
                      if (m2 && (m2.type === "email_draft" || (m2.subject && (m2.text || m2.html)))) {
                        const toArr = Array.isArray(m2.to) ? m2.to : typeof m2.to === "string" ? m2.to.split(/[,;\n]/g).map(s => s.trim()).filter(Boolean) : draft.to;
                        setDraft({
                          to: toArr,
                          subject: m2.subject || "",
                          text: m2.text || "",
                          html: m2.html || "",
                          send_at_iso: m2.send_at_iso || ""
                        });
                        setScheduleISO(m2.send_at_iso || scheduleISO);
                      }
                    } catch (e) {
                      setError(String(e?.message || e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  🔄 Regenerate
                </button>
                <button
                  className="px-5 py-2.5 rounded-xl font-semibold transition-all duration-200 disabled:opacity-50 shadow-lg"
                  style={{
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    color: '#ffffff'
                  }}
                  disabled={busy || draft.to.length === 0 || !draft.subject || (!draft.text && !draft.html)}
                  onClick={async () => {
                    try {
                      setBusy(true);
                      setError('');
                      setEmailResp(null);
                      if (scheduleISO) {
                        const data = await window.api.scheduleEmail({
                          whenISO: scheduleISO,
                          to: draft.to.length === 1 ? draft.to[0] : draft.to,
                          subject: draft.subject,
                          text: draft.text,
                          html: draft.html
                        });
                        setEmailResp(data);
                      } else {
                        const data = await window.api.sendEmail({
                          to: draft.to.length === 1 ? draft.to[0] : draft.to,
                          subject: draft.subject,
                          text: draft.text,
                          html: draft.html
                        });
                        setEmailResp(data);
                      }
                      setDraft(null);
                    } catch (e) {
                      setError(String(e?.message || e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {scheduleISO ? "📅 Approve & Schedule" : "🚀 Approve & Send Now"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Error Section */}
        {error && activeTab !== 'voice' && (
          <section className="mb-6 rounded-2xl p-5 backdrop-blur-xl border border-red-300 shadow-xl animate-shake" style={{
            background: 'rgba(254, 226, 226, 0.9)'
          }}>
            <div className="flex items-center gap-3">
              <span className="text-2xl">⚠️</span>
              <div>
                <strong className="text-red-600 text-lg">Error</strong>
                <p className="text-red-700 mt-1">{error}</p>
              </div>
            </div>
          </section>
        )}

        <audio ref={audioRef} src="/beep.mp3" preload="auto" />
      </div>

      <style>{`
        @keyframes gradientShift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        @keyframes float {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(50px, 50px) scale(1.1); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-5px); }
          75% { transform: translateX(5px); }
        }
        .animate-fadeIn { animation: fadeIn 0.3s ease-out; }
        .animate-slideUp { animation: slideUp 0.4s ease-out; }
        .animate-scaleIn { animation: scaleIn 0.3s ease-out; }
        .animate-shake { animation: shake 0.4s ease-out; }
      `}</style>
    </div>
  )
}