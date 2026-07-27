require("dotenv").config();
const crypto = require("crypto");
const path = require("path");
const express = require("express");
const { judge } = require("./judge");

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
  console.warn("[posted] Warning: JWT_SECRET is not set — generated a random one for this process only. Existing tokens will stop working on restart; set JWT_SECRET in .env for persistent sessions.");
}
if (!process.env.DATABASE_URL) {
  console.warn("[posted] Warning: DATABASE_URL is not set — multiplayer routes will fail until it's configured in .env (see .env.example).");
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

app.listen(PORT, () => {
  console.log(`[posted] listening on http://localhost:${PORT}`);
});
