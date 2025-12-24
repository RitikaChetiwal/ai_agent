import axios from 'axios';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Uses the Responses API (or Chat Completions if you prefer)
export async function askOpenAI(system, user) {
  const r = await axios.post(
    'https://api.openai.com/v1/responses',
    {
      model: 'gpt-4.1-mini',
      input: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  const text = r.data?.output?.[0]?.content?.[0]?.text || r.data?.output_text;
  return (text || 'Sorry, I did not understand.').trim();
}