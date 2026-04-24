/**
 * TEST FILE 3: Loop Anti-Pattern (MAJOR Criticality trigger)
 * Expected CloudGauge output:
 *   openai/gpt-4o-mini  (in loop) → $33.75/mo  (50k calls × $0.00015 in + $0.0006 out)
 *   anthropic/claude-3-haiku (in loop) → $68.75/mo (50k calls × $0.00025 in + $0.00125 out)
 *   TOTAL: ~$102.50/mo | Criticality: 🔴 MAJOR (API calls inside loop)
 */
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

const openai    = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function processUserFeedback(feedbackList) {
  const results = [];

  for (let i = 0; i < feedbackList.length; i++) {
    // ⚠️ Anti-pattern: OpenAI call inside loop
    const sentiment = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: `Classify sentiment: ${feedbackList[i]}` }],
      max_tokens: 1000,
    });

    // ⚠️ Anti-pattern: Anthropic call inside loop  
    const summary = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 1000,
      messages: [{ role: "user", content: `Summarize: ${feedbackList[i]}` }],
    });

    results.push({
      sentiment: sentiment.choices[0].message.content,
      summary:   summary.content[0].text,
    });
  }

  return results;
}
