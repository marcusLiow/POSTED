require("dotenv").config();
const crypto = require("crypto");
const path = require("path");
const express = require("express");
const { judge } = require("./judge");

if (process.env.JWT_SECRET) {
  console.log("[posted] JWT_SECRET: configured");
} else {
  process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
  console.warn("[posted] JWT_SECRET: NOT SET — generated a random one for this process only. On serverless (Vercel) this regenerates on every cold start, silently invalidating existing guest tokens (they'll 401). Set JWT_SECRET in your environment and redeploy for persistent sessions.");
}

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.json({ limit: "16kb" }));

// ---- existing single-player demo: unchanged, still hardcoded John/Drake/Alex ----
app.post("/api/judge", async (req, res) => {
  const { system, userText } = req.body || {};
  if (typeof system !== "string" || !system.trim()) {
    return res.status(400).json({ error: "missing system prompt" });
  }
  res.json(await judge(system, userText || ""));
});

// ---- multiplayer persona system, per multiplayer-persona-design.md ----
app.use("/api", require("./routes/auth"));
app.use("/api/personas", require("./routes/personas"));
app.use("/api/roles", require("./routes/roles"));
app.use("/api/playthroughs", require("./routes/playthroughs"));

app.use(express.static(__dirname));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "Posted-Demo v16.html"));
});
app.get("/multiplayer", (req, res) => {
  res.sendFile(path.join(__dirname, "multiplayer.html"));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[posted] listening on http://localhost:${PORT}`);
  });
}

module.exports = app;
