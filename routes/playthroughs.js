const express = require("express");
const { query } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { matchPersonasForPlaythrough } = require("../matching");
const { judge, opener, endingSummary, ENDING_FALLBACK } = require("../judge");
const { runNpcReflection } = require("../reflection");
const { DEFAULT_APPEARANCE } = require("../appearance");

const router = express.Router();
router.use(requireAuth);

// Grounds Alex's very first check-in with the player in a real, specific reason instead
// of a generic "hey" — texting that opens with an actual concrete topic reads like a real
// conversation, a scripted one-liner repeated every playthrough doesn't. Anchored to "no
// prior judged history with Alex yet" rather than a specific day number — which day
// that first check-in actually lands on depends on the /today focus algorithm below
// (normally day 2, but not guaranteed), so keying off the day count would drift out
// of sync. Fed into both the opener and the decision judge so neither invents an
// unrelated reason for Alex reaching out.
const ALEX_FIRST_CONTACT_SCENARIO =
  `SCENARIO: you're reaching out to the player right now for a real, specific reason — not a generic check-in and not a scripted excuse. Pick one concrete, personal thing actually going on in your life that you'd genuinely text a friend about, e.g.: something real that happened today (a piece of news you saw, drama at school, a fight with a parent), a nagging feeling that you and the player (or you and another friend) have been drifting apart lately, a decision you're stuck on, something that reminded you of them. Stay in character for who you are and make it specific, not vague — this should read like an actual unplanned text, not a plot device.`;

// Fixed narrative beats from the single-player demo's scripted Day 1 (see
// Posted-Demo v16.html's johnSystemPrompt()/drakeSystemPrompt()) — this is the SAME
// /decision endpoint multiplayer.html uses for freeform testing, so these only apply
// when the client explicitly opts in via body.scenario (an unrecognized/absent key
// resolves to no scenario, per buildSystemPrompt() below), never assumed from day
// number alone. Without this, the AI judging John/Drake's Day 1 lines has no idea
// a mocking post about Drake happened and drifts into generic moralizing.
const SCENARIOS = {
  day1_john_confrontation: `SCENARIO: you just found out the player posted something publicly mocking Drake's singing — Drake saw it and was crying in the bathroom. That's exactly why you're confronting them right now, in the classroom. Every line you say should stay anchored to Drake specifically — his singing, him crying, the fact that they humiliated him — not a generic "that wasn't cool, be nicer online" lecture. If the player dodges or goes vague, push them back toward what they actually did to Drake.
FOR THIS CONVERSATION SPECIFICALLY, grade outcome as:
- "bad": defensive, dismissive, or blames Drake — you're done, you walk off
- "weak": a hollow or conditional non-apology ("sorry if he was upset") that doesn't actually own it — keep pushing for a real answer instead of accepting it
- "good": they own what they did to Drake and it reads sincere, but it's just words to you — accept it
- "great": they own it AND commit to actually making it right with Drake specifically — wanting to go apologize to him, taking the post down, fixing it for real. Making this about Drake and what they're going to do for HIM is the correct, intended resolution here, not a dodge — don't grade it down for "not addressing you" if it's a genuine, specific commitment to fix things with Drake.`,
  day1_drake_apology: `SCENARIO: the player just walked over to apologize to you face-to-face, after publicly posting something that mocked your singing and made you cry in front of the school. Stay anchored to that specific post and how it actually made you feel — don't let this read like a generic apology about nothing in particular.
FOR THIS CONVERSATION SPECIFICALLY, grade outcome as:
- "bad": dismissive or blames you — you shut down, done talking
- "weak": a conditional/hollow "sorry if…" non-apology — stay guarded, wait for something real
- "good": a sincere apology that owns the specific thing they did — you accept it
- "great": a sincere apology that owns it specifically AND commits to making it right (e.g. taking the post down, standing up for you if it comes up again)`
};

async function loadAssignments(playthroughId) {
  const { rows } = await query(
    `SELECT r.slug AS role_slug, r.display_name, r.dramatic_function,
            p.personality, p.values_, p.interests, p.appearance,
            pa.relationship_score
     FROM persona_assignments pa
     JOIN roles r ON r.id = pa.role_id
     JOIN personas p ON p.id = pa.persona_id
     WHERE pa.playthrough_id = $1`,
    [playthroughId]
  );
  // Deliberately omit persona name/owner/free_text/id from what the player can see —
  // presented as an in-game character, not "someone else's persona" (§3, Visibility).
  // appearance (hair/top colors, hoodie, etc.) is included — it's a cosmetic, not an
  // identity leak — so the 3D game can render this specific matched look.
  return rows.map((r) => ({
    role_slug: r.role_slug,
    display_name: r.display_name,
    personality: r.personality,
    values: r.values_,
    interests: r.interests,
    appearance: { ...DEFAULT_APPEARANCE, ...r.appearance },
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

// Shared across every AI-voiced route so John/Drake/Alex don't read like a customer-
// service bot regardless of medium — see posted-ai-input-plan.md complaint that
// npc_reply lines were coming back stiff/formal.
const VOICE_GUARDRAILS = `VOICE: write like an actual teenager talking to someone they know, not a therapist, narrator, or assistant.
- Don't restate or summarize what the player just said back to them ("I hear that you...", "it sounds like...").
- Don't over-explain your own feelings in full sentences unless your personality is genuinely that expressive — most teenagers imply, deflect, or say less than they mean.
- Short and natural beats grammatically complete. Trail off, interrupt yourself, or leave a thought unfinished if that's how the moment would actually land.
- Follow your personality/values above for how blunt, warm, sarcastic, or guarded the delivery is — don't default to a generic "nice" tone.`;

function mediumLine(medium) {
  return medium === "in_person"
    ? "MEDIUM: this is happening face-to-face (hallway, classroom, etc.) — a spoken line, not a text. No texting abbreviations, but still casual spoken teen dialogue, not a monologue."
    : "MEDIUM: this is a DM (texting app) — write it like a real text: lowercase is fine, contractions, fragments, no need for perfect grammar or punctuation.";
}

function buildSystemPrompt({ role, persona, relationshipScore, recentEvents, agentState, medium = "dm", scenario: scenarioKey, includeThought = false }) {
  const traits = `Personality: ${persona.personality.join(", ")}. Values: ${persona.values_.join(", ")}. Interests: ${persona.interests.join(", ")}.`;
  const freeText = persona.free_text ? `Additional context from the persona's owner: "${persona.free_text}"` : "";
  const history = recentEvents.length
    ? "RECENT HISTORY WITH THIS PLAYER:\n" + recentEvents
        .map((e) => e.outcome
          ? `Day ${e.day}: player said "${e.player_input}" — judged "${e.outcome}" (${e.grade}), relationship moved ${e.relationship_delta > 0 ? "+" : ""}${e.relationship_delta}.`
          : `Day ${e.day}: you messaged the player first: "${e.npc_reply}" — no reply from them judged yet (the message below may be their reply to this).`)
        .join("\n")
    : "RECENT HISTORY WITH THIS PLAYER: none yet — this is your first interaction.";

  // Fed by the reflective layer (reflection.js), not this call itself — see
  // npc-swarm-agents-design.md. Lets an NPC's between-day private reasoning
  // actually shift how the same NPC judges the player's next message.
  const standing = agentState
    ? `YOUR CURRENT STANDING (from your own private reflection, since you last spoke to the player): arc_status is "${agentState.arc_status}"${agentState.tolerance_note ? `; you privately noted: "${agentState.tolerance_note}"` : ""}. Let this genuinely color your tone and grading below — e.g. if arc_status is "strained" or "broken", or your note describes a shorter fuse, don't judge this message as generously as you would coming in neutral; if "resolved", you can be warmer than the raw relationship number alone suggests.`
    : "";
  const scenario = (scenarioKey && SCENARIOS[scenarioKey])
    || (role.slug === "alex" && recentEvents.length === 0 ? ALEX_FIRST_CONTACT_SCENARIO : "");

  // Requested only for the specific conversation that feeds a private-reaction cutscene
  // (see Posted-Demo v16.html's playCut()) — the thought is generated by this SAME
  // judgment pass, not bolted on afterward, so it's guaranteed to actually reflect what
  // was said and to agree with the outcome/grade rather than drifting from it.
  const thoughtField = includeThought
    ? `\n- private_thought: one short sentence of your own honest, unfiltered private reaction to how this whole conversation actually went — something you'd think alone afterward, never say to the player's face. Ground it in something specific from what was actually said, not a generic mood. It must follow from — not contradict — the outcome/grade you just decided; this is you explaining to yourself why you feel that way.`
    : "";
  const thoughtJsonField = includeThought ? `,"private_thought":"..."` : "";

  return `You are voicing ${role.display_name} in a social-drama game called Posted — ${role.dramatic_function || "a classmate of the player"}.
${traits}
${freeText}
CURRENT RELATIONSHIP: your closeness to the player is ${relationshipScore}/5 (0 = you hate them, 5 = very close).
${mediumLine(medium)}
${VOICE_GUARDRAILS}
${history}
${standing}
${scenario}
TASK: read the player's message below and judge it holistically — tone, sincerity, whether it actually addresses how you feel — not by matching fixed phrases. Let your personality and values above color both your judgment and how you reply, so different personas react differently to similar words.
Decide:
- outcome: "bad" | "weak" | "good" | "great"
- npc_reply: a short 1-2 sentence in-character reply, in your own voice
- relationship_delta: -2 to +2 — weigh that you're already at ${relationshipScore}/5 closeness; the same words land harder the closer you already are, and matter less the more distant/guarded you are by personality
- grade: "F" for bad, "C" for weak, "C+" or "B" for good, "A" for great${thoughtField}
Respond with STRICT JSON only, no markdown fences, no commentary:
{"outcome":"bad|weak|good|great","npc_reply":"...","relationship_delta":0,"grade":"F|C|C+|B|A"${thoughtJsonField}}`;
}

router.post("/:id/decision", async (req, res) => {
  const { role_slug, day, player_input, medium, scenario, include_thought } = req.body || {};
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
      `SELECT day, player_input, outcome, grade, relationship_delta, npc_reply FROM events
       WHERE playthrough_id = $1 AND role_id = $2 ORDER BY created_at DESC LIMIT 5`,
      [playthrough.id, role.id]
    );
    const { rows: agentStateRows } = await query(
      "SELECT arc_status, tolerance_note FROM npc_agent_state WHERE playthrough_id = $1 AND role_id = $2",
      [playthrough.id, role.id]
    );
    const agentState = agentStateRows[0] || null;

    const system = buildSystemPrompt({ role, persona, relationshipScore, recentEvents: recentEvents.reverse(), agentState, medium, scenario, includeThought: !!include_thought });
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
      relationship_score: newScore,
      private_thought: result.private_thought || null
    });
  } catch (err) {
    console.error("[posted] decision failed:", err.message);
    res.status(500).json({ error: "decision failed" });
  }
});

// Per npc-swarm-agents-design.md: fires one reflective pass per active role, once
// per day-advance — the reflective layer, distinct from the reactive /decision judgment
// above which runs per player message. Nothing in the game currently calls this
// automatically; it's an explicit "the day is over" action the client/UI triggers.
router.post("/:id/advance-day", async (req, res) => {
  try {
    const playthrough = await loadOwnedPlaythrough(req, res);
    if (!playthrough) return;

    const nextDay = playthrough.current_day + 1;
    await query("UPDATE playthroughs SET current_day = $1, updated_at = now() WHERE id = $2", [nextDay, playthrough.id]);

    const { rows: assignments } = await query(
      "SELECT role_id FROM persona_assignments WHERE playthrough_id = $1",
      [playthrough.id]
    );

    const reflections = [];
    for (const a of assignments) {
      reflections.push(await runNpcReflection(playthrough.id, a.role_id));
    }

    res.json({ current_day: nextDay, reflections });
  } catch (err) {
    console.error("[posted] advance-day failed:", err.message);
    res.status(500).json({ error: "advance-day failed" });
  }
});

// Undoes a same-playthrough retry properly server-side: deletes this day's (and any
// later day's) events, then recomputes every role's relationship_score from what's
// left — 2.5 (the fixed insert baseline, see schema.sql) plus the sum of whatever
// deltas still remain. No separate "day snapshot" needed; the events log is the
// source of truth either way. Reflections from earlier, non-retried days are left
// alone — retrying today doesn't erase what an NPC already privately concluded
// about yesterday.
router.post("/:id/retry-day", async (req, res) => {
  const day = Number.isInteger(req.body?.day) ? req.body.day : 1;
  try {
    const playthrough = await loadOwnedPlaythrough(req, res);
    if (!playthrough) return;

    await query("DELETE FROM events WHERE playthrough_id = $1 AND day >= $2", [playthrough.id, day]);
    await query(
      `UPDATE persona_assignments pa
       SET relationship_score = GREATEST(0, LEAST(5, 2.5 + COALESCE((
         SELECT SUM(e.relationship_delta) FROM events e
         WHERE e.playthrough_id = pa.playthrough_id AND e.role_id = pa.role_id
       ), 0)))
       WHERE pa.playthrough_id = $1`,
      [playthrough.id]
    );
    await query("UPDATE playthroughs SET current_day = $1, updated_at = now() WHERE id = $2", [day, playthrough.id]);

    const assignments = await loadAssignments(playthrough.id);
    res.json({ current_day: day, assignments });
  } catch (err) {
    console.error("[posted] retry-day failed:", err.message);
    res.status(500).json({ error: "retry-day failed" });
  }
});

// Repeating day-loop driver: computes, purely from existing events/npc_agent_state
// (no new schema), which assigned role has gone longest without a real judged
// interaction — that's today's focus — and whether today should be a full check-in
// or a quiet pacing day. On Day 2 this reproduces the old hardcoded "Day 2 = Alex"
// behavior for free, since John/Drake already have a Day-1 event and Alex doesn't.
router.get("/:id/today", async (req, res) => {
  try {
    const playthrough = await loadOwnedPlaythrough(req, res);
    if (!playthrough) return;

    const { rows: candidates } = await query(
      `SELECT r.slug AS role_slug, r.display_name, pa.role_id,
              COALESCE(MAX(e.day), 0) AS last_day
       FROM persona_assignments pa
       JOIN roles r ON r.id = pa.role_id
       LEFT JOIN events e ON e.playthrough_id = pa.playthrough_id
         AND e.role_id = pa.role_id AND e.scope = 'private_interaction' AND e.outcome IS NOT NULL
       WHERE pa.playthrough_id = $1
       GROUP BY r.slug, r.display_name, pa.role_id
       ORDER BY last_day ASC, r.slug ASC
       LIMIT 1`,
      [playthrough.id]
    );
    const focus = candidates[0];
    if (!focus) return res.status(404).json({ error: "no persona assignments for this playthrough" });

    const { rows: stateRows } = await query(
      "SELECT arc_status FROM npc_agent_state WHERE playthrough_id = $1 AND role_id = $2",
      [playthrough.id, focus.role_id]
    );
    const arcStatus = stateRows[0]?.arc_status || "active";
    // Paced quiet days start no earlier than day 4 — Day 2 is the first real DM
    // check-in, so a quiet day landing on day 3 read as the game stalling right
    // after it started. A "broken" arc can still go quiet at any point; that's
    // narratively earned, not pacing filler.
    const dayType = (arcStatus === "broken" || (playthrough.current_day >= 4 && playthrough.current_day % 3 === 0))
      ? "quiet" : "checkin";

    res.json({
      day: playthrough.current_day,
      day_type: dayType,
      focus_role_slug: focus.role_slug,
      focus_display_name: focus.display_name,
      focus_arc_status: arcStatus
    });
  } catch (err) {
    console.error("[posted] today failed:", err.message);
    res.status(500).json({ error: "today failed" });
  }
});

function buildOpenerPrompt({ role, persona, events, agentState, medium = "dm" }) {
  const traits = `Personality: ${persona.personality.join(", ")}. Values: ${persona.values_.join(", ")}. Interests: ${persona.interests.join(", ")}.`;
  const history = events.length
    ? events.map((e) => `Day ${e.day}: player said "${e.player_input}" — you judged it "${e.outcome}" (${e.grade}), relationship moved ${e.relationship_delta > 0 ? "+" : ""}${e.relationship_delta}.`).join("\n")
    : "No direct history with the player yet — this is your first time reaching out.";
  const standing = agentState
    ? `Your current standing: arc_status is "${agentState.arc_status}"${agentState.tolerance_note ? `, and you privately noted: "${agentState.tolerance_note}"` : ""}.`
    : "";
  const scenario = role.slug === "alex" && events.length === 0 ? ALEX_FIRST_CONTACT_SCENARIO : "";
  const approach = medium === "in_person"
    ? "approaching the player first today, unprompted, face-to-face at school (hallway, classroom, etc.) and saying something short out loud"
    : "messaging the player first today, unprompted, over DM";

  return `You are ${role.display_name} in a social-drama game called Posted, ${approach}.
${traits}
${standing}
${scenario}
YOUR HISTORY WITH THE PLAYER:
${history}
${mediumLine(medium)}
${VOICE_GUARDRAILS}
TASK: write ONE short opener line (a single line, in your own voice, under 20 words) that genuinely references something SPECIFIC from your history above — not a generic "hey, how's it going". If you have no real history yet, a plausible, personality-fitting opener is fine.
Respond with STRICT JSON only, no markdown fences, no commentary:
{"opener":"..."}`;
}

// Narrative-callback mechanism: generated fresh right before a check-in day opens, so
// the DM opener line can reference something specific this NPC actually remembers,
// instead of the same static greeting every time.
router.post("/:id/opener", async (req, res) => {
  const { role_slug, medium } = req.body || {};
  if (typeof role_slug !== "string" || !role_slug.trim()) {
    return res.status(400).json({ error: "role_slug is required" });
  }
  try {
    const playthrough = await loadOwnedPlaythrough(req, res);
    if (!playthrough) return;

    const { rows: roleRows } = await query("SELECT * FROM roles WHERE slug = $1 AND is_active = true", [role_slug]);
    if (!roleRows.length) return res.status(404).json({ error: `unknown role "${role_slug}"` });
    const role = roleRows[0];

    const { rows: asgRows } = await query(
      `SELECT p.personality, p.values_, p.interests
       FROM persona_assignments pa JOIN personas p ON p.id = pa.persona_id
       WHERE pa.playthrough_id = $1 AND pa.role_id = $2`,
      [playthrough.id, role.id]
    );
    if (!asgRows.length) return res.status(404).json({ error: "no persona assigned to this role in this playthrough" });
    const persona = asgRows[0];

    const { rows: events } = await query(
      `SELECT day, player_input, outcome, grade, relationship_delta FROM events
       WHERE playthrough_id = $1 AND role_id = $2 AND scope = 'private_interaction' AND outcome IS NOT NULL
       ORDER BY day DESC, created_at DESC LIMIT 5`,
      [playthrough.id, role.id]
    );
    const { rows: stateRows } = await query(
      "SELECT arc_status, tolerance_note FROM npc_agent_state WHERE playthrough_id = $1 AND role_id = $2",
      [playthrough.id, role.id]
    );

    const system = buildOpenerPrompt({ role, persona, events: events.reverse(), agentState: stateRows[0] || null, medium });
    const result = await opener(system);
    const openerText = result.opener || "hey…";

    // Recorded as history (outcome/grade left null — nothing's been judged yet) so
    // /decision knows this NPC messaged first today, instead of judging the player's
    // reply with no idea an opener was ever sent.
    await query(
      `INSERT INTO events (playthrough_id, role_id, day, npc_reply, scope)
       VALUES ($1, $2, $3, $4, 'private_interaction')`,
      [playthrough.id, role.id, playthrough.current_day, openerText]
    );

    res.json({ opener: openerText });
  } catch (err) {
    console.error("[posted] opener failed:", err.message);
    res.status(500).json({ error: "opener failed" });
  }
});

function buildEndingPrompt({ assignments, events }) {
  const roster = assignments
    .map((a) => `${a.display_name} (${a.role_slug}): relationship ${a.relationship_score}/5, arc_status ${a.arc_status || "active"}${a.tolerance_note ? `, noted: "${a.tolerance_note}"` : ""}`)
    .join("\n");
  const log = events.length
    ? events.map((e) => e.outcome
        ? `Day ${e.day} · ${e.role_slug}: player said "${e.player_input}" — judged "${e.outcome}" (${e.grade}).`
        : `Day ${e.day} · ${e.role_slug} (${e.scope}): ${e.npc_reply || e.player_input}`)
      .join("\n")
    : "Nothing happened.";

  return `You are narrating the ending of a social-drama game called Posted, over the whole playthrough, for these characters:
${roster}
FULL EVENT LOG:
${log}
TASK: write a holistic ending — not a day-by-day recap, a real overall read of how things landed with each character, plus one combined closing line for the whole playthrough.
Respond with STRICT JSON only, no markdown fences, no commentary:
{"overall_line":"...","per_npc":[{"role_slug":"...","line":"...","grade":"F|C|C+|B|A"}]}`;
}

// Holistic ending pass: reads the entire event log across every NPC at once, rather
// than the old hardcoded per-day lookup tables the client used to render.
router.post("/:id/ending", async (req, res) => {
  try {
    const playthrough = await loadOwnedPlaythrough(req, res);
    if (!playthrough) return;

    const { rows: assignments } = await query(
      `SELECT r.slug AS role_slug, r.display_name, pa.relationship_score, s.arc_status, s.tolerance_note
       FROM persona_assignments pa
       JOIN roles r ON r.id = pa.role_id
       LEFT JOIN npc_agent_state s ON s.playthrough_id = pa.playthrough_id AND s.role_id = pa.role_id
       WHERE pa.playthrough_id = $1`,
      [playthrough.id]
    );
    const { rows: events } = await query(
      `SELECT r.slug AS role_slug, e.day, e.player_input, e.outcome, e.npc_reply, e.grade, e.scope
       FROM events e JOIN roles r ON r.id = e.role_id
       WHERE e.playthrough_id = $1 ORDER BY e.day, e.created_at`,
      [playthrough.id]
    );

    const system = buildEndingPrompt({ assignments, events });
    const result = await endingSummary(system);

    const perNpc = assignments.map((a) => {
      const found = (result.per_npc || []).find((p) => p.role_slug === a.role_slug);
      return found || { role_slug: a.role_slug, line: `Things ended up where they ended up with ${a.display_name}.`, grade: null };
    });

    await query("UPDATE playthroughs SET status = 'completed', updated_at = now() WHERE id = $1", [playthrough.id]);

    res.json({ overall_line: result.overall_line || ENDING_FALLBACK.overall_line, per_npc: perNpc });
  } catch (err) {
    console.error("[posted] ending failed:", err.message);
    res.status(500).json({ error: "ending failed" });
  }
});

module.exports = router;
