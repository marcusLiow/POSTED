const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.warn("[posted] Warning: DATABASE_URL is not set — multiplayer routes (/api/signup, /api/personas, /api/playthroughs, ...) will fail until it's configured in .env.");
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

function query(text, params) {
  if (!pool) return Promise.reject(new Error("DATABASE_URL is not configured"));
  return pool.query(text, params);
}

module.exports = { pool, query };
