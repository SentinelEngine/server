/**
 * TEST FILE 4: Versioned Model Names (proves version resolution works)
 * All three use full versioned model strings — CloudGauge must resolve them
 * to canonical names and price them differently.
 *
 * Expected CloudGauge output:
 *   anthropic/claude-3-opus    (claude-3-opus-20240229)   → $825.00/mo
 *   anthropic/claude-3-sonnet  (claude-3-sonnet-20240229) → $165.00/mo
 *   anthropic/claude-3-haiku   (claude-3-haiku-20240307)  → $68.75/mo
 *   TOTAL: ~$1,058.75/mo
 *
 * Key check: Opus should cost 5× more than Sonnet, and Sonnet 2.4× more than Haiku
 */
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Most expensive — Opus (20240229)
export async function researchAnalysis(topic) {
  const res = await anthropic.messages.create({
    model: "claude-3-opus-20240229",
    max_tokens: 1000,
    messages: [{ role: "user", content: `Do deep research on: ${topic}` }],
  });
  return res.content[0].text;
}

// Mid-tier — Sonnet (20240229)
export async function codeReview(code) {
  const res = await anthropic.messages.create({
    model: "claude-3-sonnet-20240229",
    max_tokens: 1000,
    messages: [{ role: "user", content: `Review this code: ${code}` }],
  });
  return res.content[0].text;
}

// Cheapest — Haiku (20240307)
export async function quickClassify(text) {
  const res = await anthropic.messages.create({
    model: "claude-3-haiku-20240307",
    max_tokens: 1000,
    messages: [{ role: "user", content: `Classify: ${text}` }],
  });
  return res.content[0].text;
}
