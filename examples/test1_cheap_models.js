/**
 * TEST FILE 1: Cheap Models (no loop)
 * Expected CloudGauge output:
 *   openai/gpt-4o-mini  → $6.75/mo   (10k calls × $0.00015 in + $0.0006 out)
 *   openai/gpt-3.5-turbo → $17.50/mo (10k calls × $0.0005 in  + $0.0015 out)
 *   TOTAL: ~$24.25/mo | Criticality: 🟢 Low
 */
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// GPT-4o-mini — cheapest OpenAI model
export async function summarizeDocument(text) {
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: `Summarize: ${text}` }],
    max_tokens: 1000,
  });
  return res.choices[0].message.content;
}

// GPT-3.5-Turbo — legacy cheap model
export async function classifyIntent(userMessage) {
  const res = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [{ role: "user", content: `Classify intent: ${userMessage}` }],
    max_tokens: 1000,
  });
  return res.choices[0].message.content;
}
