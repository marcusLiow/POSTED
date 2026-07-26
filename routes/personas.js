const express = require("express");
const { query } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { validateTraits, CURRENT_TRAITS_VERSION } = require("../traits");

const router = express.Router();
router.use(requireAuth);

function toPublic(row) {
  return {
    id: row.id,
    name: row.name,
    personality: row.personality,
    values: row.values_,
    interests: row.interests,
    free_text: row.free_text,
    traits_version: row.traits_version,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

router.post("/", async (req, res) => {
  const { name, personality, values, interests, free_text } = req.body || {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  const errors = validateTraits({ personality, values, interests, free_text });
  if (errors.length) return res.status(400).json({ error: errors.join("; ") });

  try {
    const { rows } = await query(
      `INSERT INTO personas (owner_id, name, personality, values_, interests, free_text, traits_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.userId, name.trim(), personality, values, interests, free_text || null, CURRENT_TRAITS_VERSION]
    );
    res.status(201).json(toPublic(rows[0]));
  } catch (err) {
    console.error("[posted] persona create failed:", err.message);
    res.status(500).json({ error: "persona create failed" });
  }
});

router.get("/", async (req, res) => {
  try {
    const { rows } = await query(
      "SELECT * FROM personas WHERE owner_id = $1 ORDER BY created_at DESC",
      [req.userId]
    );
    res.json(rows.map(toPublic));
  } catch (err) {
    console.error("[posted] persona list failed:", err.message);
    res.status(500).json({ error: "persona list failed" });
  }
});

async function loadOwnedPersona(req, res) {
  const { rows } = await query("SELECT * FROM personas WHERE id = $1", [req.params.id]);
  if (!rows.length) { res.status(404).json({ error: "persona not found" }); return null; }
  if (rows[0].owner_id !== req.userId) { res.status(403).json({ error: "not your persona" }); return null; }
  return rows[0];
}

router.patch("/:id", async (req, res) => {
  try {
    const existing = await loadOwnedPersona(req, res);
    if (!existing) return;

    const name = typeof req.body?.name === "string" && req.body.name.trim() ? req.body.name.trim() : existing.name;
    const personality = req.body?.personality ?? existing.personality;
    const values = req.body?.values ?? existing.values_;
    const interests = req.body?.interests ?? existing.interests;
    const free_text = req.body?.free_text !== undefined ? req.body.free_text : existing.free_text;

    const errors = validateTraits({ personality, values, interests, free_text });
    if (errors.length) return res.status(400).json({ error: errors.join("; ") });

    const { rows } = await query(
      `UPDATE personas SET name=$1, personality=$2, values_=$3, interests=$4, free_text=$5, updated_at=now()
       WHERE id=$6 RETURNING *`,
      [name, personality, values, interests, free_text || null, req.params.id]
    );
    res.json(toPublic(rows[0]));
  } catch (err) {
    console.error("[posted] persona update failed:", err.message);
    res.status(500).json({ error: "persona update failed" });
  }
});

router.patch("/:id/active", async (req, res) => {
  if (typeof req.body?.is_active !== "boolean") {
    return res.status(400).json({ error: "is_active (boolean) required" });
  }
  try {
    const existing = await loadOwnedPersona(req, res);
    if (!existing) return;
    const { rows } = await query(
      "UPDATE personas SET is_active=$1, updated_at=now() WHERE id=$2 RETURNING *",
      [req.body.is_active, req.params.id]
    );
    res.json(toPublic(rows[0]));
  } catch (err) {
    console.error("[posted] persona active toggle failed:", err.message);
    res.status(500).json({ error: "persona active toggle failed" });
  }
});

// Privacy boundary (§4): aggregate placement count only — no transcripts, no per-game
// outcomes, no relationship scores, and only the owner can see even that much.
router.get("/:id/stats", async (req, res) => {
  try {
    const existing = await loadOwnedPersona(req, res);
    if (!existing) return;
    const { rows } = await query(
      `SELECT count(*)::int AS times_matched
       FROM persona_assignments pa
       JOIN playthroughs p ON p.id = pa.playthrough_id
       WHERE pa.persona_id = $1 AND p.status = 'active'`,
      [req.params.id]
    );
    res.json({ times_matched: rows[0].times_matched });
  } catch (err) {
    console.error("[posted] persona stats failed:", err.message);
    res.status(500).json({ error: "persona stats failed" });
  }
});

module.exports = router;
