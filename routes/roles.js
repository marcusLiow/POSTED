const express = require("express");
const { query } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    const { rows } = await query(
      "SELECT id, slug, display_name, dramatic_function FROM roles WHERE is_active = true ORDER BY created_at"
    );
    res.json(rows);
  } catch (err) {
    console.error("[posted] roles list failed:", err.message);
    res.status(500).json({ error: "roles list failed" });
  }
});

module.exports = router;
