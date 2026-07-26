const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { query } = require("../db");
const { signToken } = require("../middleware/auth");

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Bootstraps a throwaway account so the solo 3D game can talk to the same
// persona/playthrough backend as the multiplayer system, without a login screen.
// The client stores the returned token in localStorage and reuses it across visits.
router.post("/guest", async (req, res) => {
  try {
    const email = `guest_${crypto.randomBytes(12).toString("hex")}@posted.local`;
    const hash = await bcrypt.hash(crypto.randomBytes(24).toString("hex"), 12);
    const { rows } = await query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id",
      [email, hash]
    );
    res.status(201).json({ token: signToken(rows[0].id) });
  } catch (err) {
    console.error("[posted] guest bootstrap failed:", err.message);
    res.status(500).json({ error: "guest bootstrap failed" });
  }
});

router.post("/signup", async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "valid email required" });
  }
  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "password must be at least 8 characters" });
  }
  try {
    const existing = await query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
    if (existing.rows.length) return res.status(409).json({ error: "email already registered" });

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id",
      [email.toLowerCase(), hash]
    );
    res.status(201).json({ token: signToken(rows[0].id) });
  } catch (err) {
    console.error("[posted] signup failed:", err.message);
    res.status(500).json({ error: "signup failed" });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "email and password required" });
  }
  try {
    const { rows } = await query("SELECT id, password_hash FROM users WHERE email = $1", [email.toLowerCase()]);
    if (!rows.length) return res.status(401).json({ error: "invalid email or password" });

    const ok = await bcrypt.compare(password, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: "invalid email or password" });

    res.json({ token: signToken(rows[0].id) });
  } catch (err) {
    console.error("[posted] login failed:", err.message);
    res.status(500).json({ error: "login failed" });
  }
});

module.exports = router;
