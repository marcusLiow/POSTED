require("dotenv").config();
const path = require("path");
const express = require("express");
const Anthropic = require("@anthropic-ai/sdk").default;

const PORT = process.env.PORT || 3000;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("[posted] Warning: ANTHROPIC_API_KEY is not set — /api/judge will return neutral fallbacks. Copy .env.example to .env and add your key.");
}

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const app = express();
app.use(express.json({ limit: "16kb" }));

function stripFences(s) {
  return s.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
}

app.post("/api/judge", async (req, res) => {
  const { system, userText } = req.body || {};
  const fallback = { outcome: "weak", npc_reply: "…okay.", relationship_delta: 0, grade: "C" };

  if (typeof system !== "string" || !system.trim()) {
    return res.status(400).json({ error: "missing system prompt" });
  }
  if (!anthropic) {
    return res.json(fallback);
  }

  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      system,
      messages: [{ role: "user", content: (userText && String(userText).trim()) || "(said nothing)" }]
    });
    const raw = (msg.content || []).map((b) => b.text || "").join("");
    const parsed = JSON.parse(stripFences(raw));
    res.json({ ...fallback, ...parsed });
  } catch (err) {
    console.error("[posted] /api/judge failed:", err.message);
    res.json(fallback);
  }
});

app.use(express.static(__dirname));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "Posted-Demo v16.html"));
});

app.listen(PORT, () => {
  console.log(`[posted] listening on http://localhost:${PORT}`);
});
