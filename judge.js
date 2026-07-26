const Anthropic = require("@anthropic-ai/sdk").default;

const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
const FALLBACK = { outcome: "weak", npc_reply: "…okay.", relationship_delta: 0, grade: "C" };

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("[posted] Warning: ANTHROPIC_API_KEY is not set — AI-judged routes will return neutral fallbacks. Copy .env.example to .env and add your key.");
}

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

function stripFences(s) {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
}

async function judge(system, userText) {
  if (!anthropic) return { ...FALLBACK };
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      system,
      messages: [{ role: "user", content: (userText && String(userText).trim()) || "(said nothing)" }]
    });
    const raw = (msg.content || []).map((b) => b.text || "").join("");
    const parsed = JSON.parse(stripFences(raw));
    return { ...FALLBACK, ...parsed };
  } catch (err) {
    console.error("[posted] judge() failed:", err.message);
    return { ...FALLBACK };
  }
}

module.exports = { judge, FALLBACK };
