// backend/src/utils/emailTemplates.js
export const emailTemplates = {
  Template1: {
    subject: "Hi there! 👋",
    html: `
      <h2 style="margin:0 0 8px">This is the Hello 1 template. Thank you very much!</h2>
      
      
    `,
    text: "Hi there! This is the Hello 1 template. Thank you very much!",
  },
  Template2: {
    subject: "Quick check-in 💬",
    html: `
      <h2 style="margin:0 0 8px">Hi again!</h2>
      <p>This is the <b>Hello 2</b> template — just checking in.</p>
      <p>Everything running smoothly?</p>
    `,
    text: "Hi again! This is Hello 2 — just checking in. Everything running smoothly?",
  },
  Template3: {
    subject: "Special greetings ✨",
    html: `
      <h2 style="margin:0 0 8px">Greetings from AI Agent</h2>
      <p>This is <b>Hello 3</b> — a slightly fancier message.</p>
      <p>Stay awesome!</p>
    `,
    text: "Greetings from AI Agent — this is Hello 3. Stay awesome!",
  },
};
