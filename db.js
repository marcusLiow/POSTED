const { Pool } = require("pg");

if (process.env.DATABASE_URL) {
  console.log("[posted] DATABASE_URL: configured — checking connection...");
} else {
  console.warn("[posted] DATABASE_URL: NOT SET — every multiplayer/persona route (/api/signup, /api/personas, /api/playthroughs, ...) will fail until it's configured in your environment (or Vercel project env vars) and redeployed.");
}

// Supabase (and most hosted Postgres) require SSL but present a cert chain that
// Node's default CA bundle won't validate — this is the standard escape hatch for
// that case, not relevant for a plain local Postgres install (DATABASE_URL there
// typically has no sslmode, so ssl stays off).
const useSsl = /sslmode=require|supabase\.co/.test(process.env.DATABASE_URL || "");

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined
    })
  : null;

if (pool) {
  pool.query("SELECT 1")
    .then(() => console.log("[posted] DATABASE_URL: connection OK"))
    .catch((err) => console.error("[posted] DATABASE_URL: connection FAILED —", err.message));
}

function query(text, params) {
  if (!pool) return Promise.reject(new Error("DATABASE_URL is not configured"));
  return pool.query(text, params);
}

module.exports = { pool, query };
