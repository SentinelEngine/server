/**
 * TEST FILE 2: Expensive Models (no loop)
 * Expected CloudGauge output:
 *   openai/gpt-4        → $750.00/mo  (10k calls × $0.03 in + $0.06 out)
 *   anthropic/claude-3-opus → $825.00/mo (10k calls × $0.015 in + $0.075 out)
 *   TOTAL: ~$1,575.00/mo | Criticality: 🟡 Minor (high absolute cost)
 */
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

const openai    = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// GPT-4 — expensive, high quality
export async function analyzeContract(contractText) {
  const res = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [{ role: "user", content: `Analyze this contract for risks: ${contractText}` }],
    max_tokens: 1000,
  });
  return res.choices[0].message.content;
}

// Claude 3 Opus — most expensive Anthropic model
export async function generateLegalDraft(requirements) {
  const res = await anthropic.messages.create({
    model: "claude-3-opus-20240229",
    max_tokens: 1000,
    messages: [{ role: "user", content: `Draft legal document for: ${requirements}` }],
  });
  return res.content[0].text;
}
