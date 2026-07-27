const Anthropic = require("@anthropic-ai/sdk").default;

const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
const JUDGE_FALLBACK = { outcome: "weak", npc_reply: "…okay.", relationship_delta: 0, grade: "C" };
const REFLECT_FALLBACK = { arc_status: "active", tolerance_note: null, internal_notes: null, changed: false, autonomous_post: null };
const OPENER_FALLBACK = { opener: "hey…" };
const ENDING_FALLBACK = { overall_line: "You made it through.", per_npc: [] };

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("[posted] Warning: ANTHROPIC_API_KEY is not set — AI-judged routes will return neutral fallbacks. Copy .env.example to .env and add your key.");
}

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

function stripFences(s) {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
}

async function callModel(system, userText, fallback) {
  if (!anthropic) return { ...fallback };
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      system,
      messages: [{ role: "user", content: userText }]
    });
    const raw = (msg.content || []).map((b) => b.text || "").join("");
    const parsed = JSON.parse(stripFences(raw));
    return { ...fallback, ...parsed };
  } catch (err) {
    console.error("[posted] callModel() failed:", err.message);
    return { ...fallback };
  }
}

// Reactive judgment: the player typed something, the model scores/grades it in response.
async function judge(system, userText) {
  return callModel(system, (userText && String(userText).trim()) || "(said nothing)", JUDGE_FALLBACK);
}

// Reflective agency: no player message to react to — the model looks at accumulated
// state and decides something nobody explicitly triggered. All context lives in the
// system prompt; the "user" turn is just a nudge to act.
async function reflect(system) {
  return callModel(system, "Reflect now.", REFLECT_FALLBACK);
}

// Narrative-callback generation: a short in-character DM opener referencing real history,
// generated fresh right before a check-in day opens (not part of the once-per-day reflection
// pass, since it's only ever needed for whichever NPC ends up being today's focus).
async function opener(system) {
  return callModel(system, "Write the opener now.", OPENER_FALLBACK);
}

// Holistic ending pass: reads the whole playthrough at once, across every NPC, instead of
// concatenating per-day summaries.
async function endingSummary(system) {
  return callModel(system, "Summarize the playthrough now.", ENDING_FALLBACK);
}

module.exports = { judge, reflect, opener, endingSummary, JUDGE_FALLBACK, REFLECT_FALLBACK, OPENER_FALLBACK, ENDING_FALLBACK };
