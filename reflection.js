// Per-NPC swarm agents — reflective pass, per npc-swarm-agents-design.md.
// Runs once per active role per day-advance (not per message). Reads a persona's
// private history with the player plus shared public events, and decides whether
// this role's standing has shifted — writing to npc_agent_state, not recomputing
// relationship_score (that stays the reactive judgment's job).
const { query } = require("./db");
const { reflect } = require("./judge");

function buildReflectionPrompt({ role, persona, privateEvents, publicEvents, state }) {
  const traits = `Personality: ${persona.personality.join(", ")}. Values: ${persona.values_.join(", ")}. Interests: ${persona.interests.join(", ")}.`;
  const freeText = persona.free_text ? `Additional context: "${persona.free_text}"` : "";

  const privateHist = privateEvents.length
    ? privateEvents
        .filter((e) => e.player_input || e.npc_reply)
        .map((e) => e.outcome
          ? `Day ${e.day}: player said "${e.player_input}" — you judged it "${e.outcome}" (${e.grade}), relationship moved ${e.relationship_delta > 0 ? "+" : ""}${e.relationship_delta}.`
          : `Day ${e.day}: (reflection note) ${e.npc_reply}`)
        .join("\n")
    : "No direct history with the player yet.";

  const publicHist = publicEvents.length
    ? publicEvents.map((e) => `Day ${e.day}: ${e.player_input}`).join("\n")
    : "Nothing publicly notable yet.";

  const current = state
    ? `arc_status=${state.arc_status}, tolerance_note=${state.tolerance_note || "(none)"}, internal_notes=${state.internal_notes || "(none)"}`
    : "No prior reflection — this is your first one.";

  return `You are reflecting as ${persona.name || role.display_name}, playing the role of ${role.display_name} (${role.dramatic_function || "a classmate of the player"}).
${traits}
${freeText}

YOUR PRIVATE HISTORY WITH THE PLAYER:
${privateHist}

THINGS YOU'D PLAUSIBLY KNOW ABOUT GENERALLY (public, not necessarily about you):
${publicHist}

YOUR CURRENT STANDING: ${current}

TASK: reasoning over all of this — not a formula, your own judgment as this character — decide
whether your standing with the player has shifted since your current standing above, and whether
today is a day you'd actually post something publicly (venting, subtweeting, oversharing, whatever
fits your personality) — independent of anything the player did just now, purely your own call.
- arc_status: "active" | "strained" | "broken" | "resolved"
- tolerance_note: a short freeform note if your patience/tolerance has shifted, referencing
  specific days (e.g. "shorter fuse now after being hurt twice on days 2, 4"), or null if unchanged
- internal_notes: one or two sentences of your own private reasoning, not shown to the player
- changed: true only if arc_status or tolerance_note actually changed from your current standing above
- autonomous_post: a short in-character public post (1 sentence, your own voice, fitting your
  personality/values) IF your current standing genuinely moves you to post today, else null — most
  days should be null; only post when your private history actually gives you something to say
Respond with STRICT JSON only, no markdown fences, no commentary:
{"arc_status":"active|strained|broken|resolved","tolerance_note":null,"internal_notes":"...","changed":false,"autonomous_post":null}`;
}

async function runNpcReflection(playthroughId, roleId) {
  const { rows: roleRows } = await query("SELECT * FROM roles WHERE id = $1", [roleId]);
  if (!roleRows.length) throw new Error(`unknown role_id "${roleId}"`);
  const role = roleRows[0];

  const { rows: asgRows } = await query(
    `SELECT p.name, p.personality, p.values_, p.interests, p.free_text
     FROM persona_assignments pa JOIN personas p ON p.id = pa.persona_id
     WHERE pa.playthrough_id = $1 AND pa.role_id = $2`,
    [playthroughId, roleId]
  );
  if (!asgRows.length) throw new Error("no persona assigned to this role in this playthrough");
  const persona = asgRows[0];

  const { rows: privateEvents } = await query(
    `SELECT day, player_input, outcome, npc_reply, grade, relationship_delta FROM events
     WHERE playthrough_id = $1 AND role_id = $2 AND scope = 'private_interaction' ORDER BY day, created_at`,
    [playthroughId, roleId]
  );
  const { rows: publicEvents } = await query(
    `SELECT day, player_input FROM events WHERE playthrough_id = $1 AND scope = 'public_post' ORDER BY day, created_at`,
    [playthroughId]
  );
  const { rows: stateRows } = await query(
    "SELECT * FROM npc_agent_state WHERE playthrough_id = $1 AND role_id = $2",
    [playthroughId, roleId]
  );
  const priorState = stateRows[0] || null;

  const system = buildReflectionPrompt({ role, persona, privateEvents, publicEvents, state: priorState });
  const result = await reflect(system);

  const { rows: upserted } = await query(
    `INSERT INTO npc_agent_state (playthrough_id, role_id, arc_status, tolerance_note, internal_notes, last_reflection_day, updated_at)
     VALUES ($1, $2, $3, $4, $5, (SELECT current_day FROM playthroughs WHERE id = $1), now())
     ON CONFLICT (playthrough_id, role_id) DO UPDATE SET
       arc_status = $3, tolerance_note = $4, internal_notes = $5,
       last_reflection_day = (SELECT current_day FROM playthroughs WHERE id = $1), updated_at = now()
     RETURNING *`,
    [playthroughId, roleId, result.arc_status, result.tolerance_note, result.internal_notes]
  );
  const stateRow = upserted[0];

  if (result.changed) {
    await query(
      `INSERT INTO events (playthrough_id, role_id, day, player_input, outcome, npc_reply, relationship_delta, grade, scope)
       VALUES ($1, $2, (SELECT current_day FROM playthroughs WHERE id = $1), NULL, NULL, $3, NULL, NULL, 'private_interaction')`,
      [playthroughId, roleId, result.tolerance_note || `${role.display_name}'s standing shifted to ${result.arc_status}.`]
    );
  }

  // "Posting autonomously" per npc-swarm-agents-design.md: this NPC's own reflection
  // decided, unprompted, to put something on the public feed. Stored as a public_post
  // event — the same scope buildReflectionPrompt() above already reads back in as
  // "things you'd plausibly know about generally" for every OTHER role's next
  // reflection, so one NPC posting can genuinely ripple into another's private read
  // of the world, not just the player's.
  if (result.autonomous_post) {
    await query(
      `INSERT INTO events (playthrough_id, role_id, day, player_input, outcome, npc_reply, relationship_delta, grade, scope)
       VALUES ($1, $2, (SELECT current_day FROM playthroughs WHERE id = $1), $3, NULL, NULL, NULL, NULL, 'public_post')`,
      [playthroughId, roleId, result.autonomous_post]
    );
  }

  // Smallest slice per the design doc's mapping (§ "genuinely agentic" item 3): whether
  // to offer a reconciliation opening today is read straight off arc_status, not its
  // own separate judgment call.
  const opening_today = stateRow.arc_status !== "broken";

  return {
    role_slug: role.slug,
    display_name: role.display_name,
    arc_status: stateRow.arc_status,
    tolerance_note: stateRow.tolerance_note,
    changed: result.changed,
    opening_today,
    autonomous_post: result.autonomous_post || null
  };
}

module.exports = { runNpcReflection };
