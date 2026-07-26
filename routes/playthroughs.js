const express = require("express");
const { query } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { matchPersonasForPlaythrough } = require("../matching");
const { judge } = require("../judge");

const router = express.Router();
router.use(requireAuth);

async function loadAssignments(playthroughId) {
  const { rows } = await query(
    `SELECT r.slug AS role_slug, r.display_name, r.dramatic_function,
            p.personality, p.values_, p.interests,
            pa.relationship_score
     FROM persona_assignments pa
     JOIN roles r ON r.id = pa.role_id
     JOIN personas p ON p.id = pa.persona_id
     WHERE pa.playthrough_id = $1`,
    [playthroughId]
  );
  // Deliberately omit persona name/owner/free_text/id from what the player can see —
  // presented as an in-game character, not "someone else's persona" (§3, Visibility).
  return rows.map((r) => ({
    role_slug: r.role_slug,
    display_name: r.display_name,
    personality: r.personality,
    values: r.values_,
    interests: r.interests,
    relationship_score: Number(r.relationship_score)
  }));
}

router.post("/", async (req, res) => {
  try {
    const { rows } = await query(
      "INSERT INTO playthroughs (player_id) VALUES ($1) RETURNING *",
      [req.userId]
    );
    const playthrough = rows[0];
    await matchPersonasForPlaythrough(req.userId, playthrough.id);
    const assignments = await loadAssignments(playthrough.id);
    res.status(201).json({
      id: playthrough.id,
      current_day: playthrough.current_day,
      status: playthrough.status,
      assignments
    });
  } catch (err) {
    console.error("[posted] playthrough create failed:", err.message);
    res.status(500).json({ error: "playthrough create failed" });
  }
});

async function loadOwnedPlaythrough(req, res) {
  const { rows } = await query("SELECT * FROM playthroughs WHERE id = $1", [req.params.id]);
  if (!rows.length) { res.status(404).json({ error: "playthrough not found" }); return null; }
  if (rows[0].player_id !== req.userId) { res.status(403).json({ error: "not your playthrough" }); return null; }
  return rows[0];
}

router.get("/:id", async (req, res) => {
  try {
    const playthrough = await loadOwnedPlaythrough(req, res);
    if (!playthrough) return;
    const assignments = await loadAssignments(playthrough.id);
    res.json({
      id: playthrough.id,
      current_day: playthrough.current_day,
      status: playthrough.status,
      assignments
    });
  } catch (err) {
    console.error("[posted] playthrough get failed:", err.message);
    res.status(500).json({ error: "playthrough get failed" });
  }
});

function buildSystemPrompt({ role, persona, relationshipScore, recentEvents }) {
  const traits = `Personality: ${persona.personality.join(", ")}. Values: ${persona.values_.join(", ")}. Interests: ${persona.interests.join(", ")}.`;
  const freeText = persona.free_text ? `Additional context from the persona's owner: "${persona.free_text}"` : "";
  const history = recentEvents.length
    ? "RECENT HISTORY WITH THIS PLAYER:\n" + recentEvents
        .map((e) => `Day ${e.day}: player said "${e.player_input}" — judged "${e.outcome}" (${e.grade}), relationship moved ${e.relationship_delta > 0 ? "+" : ""}${e.relationship_delta}.`)
        .join("\n")
    : "RECENT HISTORY WITH THIS PLAYER: none yet — this is your first interaction.";

  return `You are voicing ${role.display_name} in a social-drama game called Posted — ${role.dramatic_function || "a classmate of the player"}.
${traits}
${freeText}
CURRENT RELATIONSHIP: your closeness to the player is ${relationshipScore}/5 (0 = you hate them, 5 = very close).
${history}
TASK: read the player's message below and judge it holistically — tone, sincerity, whether it actually addresses how you feel — not by matching fixed phrases. Let your personality and values above color both your judgment and how you reply, so different personas react differently to similar words.
Decide:
- outcome: "bad" | "weak" | "good" | "great"
- npc_reply: a short 1-2 sentence in-character reply, in your own voice
- relationship_delta: -2 to +2 — weigh that you're already at ${relationshipScore}/5 closeness; the same words land harder the closer you already are, and matter less the more distant/guarded you are by personality
- grade: "F" for bad, "C" for weak, "C+" or "B" for good, "A" for great
Respond with STRICT JSON only, no markdown fences, no commentary:
{"outcome":"bad|weak|good|great","npc_reply":"...","relationship_delta":0,"grade":"F|C|C+|B|A"}`;
}

router.post("/:id/decision", async (req, res) => {
  const { role_slug, day, player_input } = req.body || {};
  if (typeof role_slug !== "string" || !role_slug.trim()) {
    return res.status(400).json({ error: "role_slug is required" });
  }
  const dayNum = Number.isInteger(day) ? day : 1;

  try {
    const playthrough = await loadOwnedPlaythrough(req, res);
    if (!playthrough) return;

    const { rows: roleRows } = await query("SELECT * FROM roles WHERE slug = $1 AND is_active = true", [role_slug]);
    if (!roleRows.length) return res.status(404).json({ error: `unknown role "${role_slug}"` });
    const role = roleRows[0];

    const { rows: asgRows } = await query(
      `SELECT pa.*, p.name, p.personality, p.values_, p.interests, p.free_text
       FROM persona_assignments pa JOIN personas p ON p.id = pa.persona_id
       WHERE pa.playthrough_id = $1 AND pa.role_id = $2`,
      [playthrough.id, role.id]
    );
    if (!asgRows.length) return res.status(404).json({ error: "no persona assigned to this role in this playthrough" });
    const assignment = asgRows[0];
    const persona = { personality: assignment.personality, values_: assignment.values_, interests: assignment.interests, free_text: assignment.free_text };
    const relationshipScore = Number(assignment.relationship_score);

    const { rows: recentEvents } = await query(
      `SELECT day, player_input, outcome, grade, relationship_delta FROM events
       WHERE playthrough_id = $1 AND role_id = $2 ORDER BY created_at DESC LIMIT 5`,
      [playthrough.id, role.id]
    );

    const system = buildSystemPrompt({ role, persona, relationshipScore, recentEvents: recentEvents.reverse() });
    const result = await judge(system, player_input || "");

    const delta = typeof result.relationship_delta === "number" ? Math.round(result.relationship_delta) : 0;
    const newScore = Math.max(0, Math.min(5, relationshipScore + delta));

    await query(
      `INSERT INTO events (playthrough_id, role_id, day, player_input, outcome, npc_reply, relationship_delta, grade)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [playthrough.id, role.id, dayNum, player_input || "", result.outcome, result.npc_reply, delta, result.grade]
    );
    await query("UPDATE persona_assignments SET relationship_score = $1 WHERE id = $2", [newScore, assignment.id]);
    await query(
      "UPDATE playthroughs SET current_day = GREATEST(current_day, $1), updated_at = now() WHERE id = $2",
      [dayNum, playthrough.id]
    );

    res.json({
      outcome: result.outcome,
      npc_reply: result.npc_reply,
      relationship_delta: delta,
      grade: result.grade,
      relationship_score: newScore
    });
  } catch (err) {
    console.error("[posted] decision failed:", err.message);
    res.status(500).json({ error: "decision failed" });
  }
});

module.exports = router;
