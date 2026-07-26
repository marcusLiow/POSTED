// Matching logic per multiplayer-persona-design.md §3.
const { query } = require("./db");

function weightedPick(candidates) {
  // candidates: [{ persona, weight }]
  const total = candidates.reduce((s, c) => s + c.weight, 0);
  let r = Math.random() * total;
  for (const c of candidates) {
    r -= c.weight;
    if (r <= 0) return c.persona;
  }
  return candidates[candidates.length - 1].persona;
}

async function candidatesForRole({ playerId, excludeIds }) {
  // Candidate pool = personas where owner_id != playerId AND is_active = true.
  // `owner_id != $1` naturally excludes owner_id IS NULL rows (system defaults) —
  // those are reserved for the explicit fallback path below, not the normal pool.
  const { rows } = await query(
    `SELECT p.*,
            (SELECT count(*)::int FROM persona_assignments pa
             JOIN playthroughs pt ON pt.id = pa.playthrough_id
             WHERE pa.persona_id = p.id AND pt.status = 'active') AS active_count
     FROM personas p
     WHERE p.owner_id != $1 AND p.is_active = true
       AND p.id != ALL($2::uuid[])`,
    [playerId, excludeIds]
  );
  return rows.map((persona) => ({ persona, weight: 1 / (persona.active_count + 1) }));
}

async function fallbackPersonaForRole({ role, excludeIds }) {
  const { rows } = await query(
    `SELECT * FROM personas
     WHERE owner_id IS NULL AND is_active = true AND id != ALL($1::uuid[])
       AND name ILIKE $2
     LIMIT 1`,
    [excludeIds, `${role.display_name} (default)%`]
  );
  if (rows.length) return rows[0];
  const { rows: any } = await query(
    `SELECT * FROM personas WHERE owner_id IS NULL AND is_active = true AND id != ALL($1::uuid[]) LIMIT 1`,
    [excludeIds]
  );
  return any[0] || null;
}

async function drawForRole({ role, playerId, excludeIds }) {
  const candidates = await candidatesForRole({ playerId, excludeIds });
  if (candidates.length) return weightedPick(candidates);
  const fallback = await fallbackPersonaForRole({ role, excludeIds });
  if (!fallback) throw new Error(`no candidate or fallback persona available for role "${role.slug}"`);
  return fallback;
}

function overlapCount(a, b) {
  const setB = new Set(b);
  return a.filter((t) => setB.has(t)).length;
}

async function matchPersonasForPlaythrough(playerId, playthroughId) {
  const { rows: roles } = await query("SELECT * FROM roles WHERE is_active = true ORDER BY created_at");
  const usedIds = [];
  const assignments = []; // { role, persona }

  for (const role of roles) {
    const persona = await drawForRole({ role, playerId, excludeIds: usedIds });
    usedIds.push(persona.id);
    assignments.push({ role, persona });
  }

  // Diversity pass (best-effort, single redraw attempt per overlapping pair, not a
  // full optimization search): redraw the second persona in any pair that shares
  // >= 2 of 3 personality traits.
  for (let i = 0; i < assignments.length; i++) {
    for (let j = i + 1; j < assignments.length; j++) {
      const a = assignments[i], b = assignments[j];
      if (overlapCount(a.persona.personality, b.persona.personality) >= 2) {
        const excludeIds = usedIds.slice();
        const redraw = await drawForRole({ role: b.role, playerId, excludeIds });
        usedIds[usedIds.indexOf(b.persona.id)] = redraw.id;
        assignments[j] = { role: b.role, persona: redraw };
      }
    }
  }

  for (const { role, persona } of assignments) {
    await query(
      `INSERT INTO persona_assignments (playthrough_id, role_id, persona_id, relationship_score)
       VALUES ($1,$2,$3,2.5)`,
      [playthroughId, role.id, persona.id]
    );
  }

  return assignments;
}

module.exports = { matchPersonasForPlaythrough };
