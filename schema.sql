-- Posted multiplayer persona system — schema per multiplayer-persona-design.md §2
-- Run once against the target Postgres/Supabase database, e.g.:
--   psql "$DATABASE_URL" -f schema.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- NPC roles are data, not a fixed enum — supports adding/rotating cast without schema changes
CREATE TABLE IF NOT EXISTS roles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              TEXT UNIQUE NOT NULL,   -- e.g. 'john', 'drake', 'alex', future: 'maya', etc.
  display_name      TEXT NOT NULL,
  dramatic_function TEXT,                  -- e.g. 'the protective one', 'the slow-to-forgive one'
                                            -- used later for narrative-fit matching (§3)
  is_active         BOOLEAN NOT NULL DEFAULT true,  -- retire a role without deleting its history
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS personas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       UUID REFERENCES users(id) ON DELETE CASCADE, -- NULL = system-owned default persona
  name           TEXT NOT NULL,
  personality    TEXT[] NOT NULL,   -- e.g. {guarded,slow-to-trust,protective}
  values_        TEXT[] NOT NULL,
  interests      TEXT[] NOT NULL,
  free_text      TEXT,
  traits_version INT NOT NULL DEFAULT 1,
  is_active      BOOLEAN NOT NULL DEFAULT true,  -- owner can pull persona from matching pool
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS playthroughs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_day     INT NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'active',  -- active | completed | abandoned
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- one row per NPC role per playthrough
CREATE TABLE IF NOT EXISTS persona_assignments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playthrough_id UUID NOT NULL REFERENCES playthroughs(id) ON DELETE CASCADE,
  role_id        UUID NOT NULL REFERENCES roles(id),
  persona_id     UUID NOT NULL REFERENCES personas(id),
  relationship_score NUMERIC NOT NULL DEFAULT 2.5,  -- 0-5 scale
  assigned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (playthrough_id, role_id)
);

-- append-only log: persistent memory pillar + input for future ML (incidental, not a planned pipeline)
CREATE TABLE IF NOT EXISTS events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playthrough_id UUID NOT NULL REFERENCES playthroughs(id) ON DELETE CASCADE,
  role_id        UUID NOT NULL REFERENCES roles(id),
  day            INT NOT NULL,
  player_input   TEXT,                 -- what the player typed
  outcome        TEXT,                 -- bad | weak | good | great
  npc_reply      TEXT,
  relationship_delta NUMERIC,
  grade          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_playthrough ON events(playthrough_id);
CREATE INDEX IF NOT EXISTS idx_personas_owner ON personas(owner_id);
CREATE INDEX IF NOT EXISTS idx_assignments_persona ON persona_assignments(persona_id);
CREATE INDEX IF NOT EXISTS idx_assignments_role ON persona_assignments(role_id);

-- Per-NPC swarm agents (npc-swarm-agents-design.md) — see migrations/002_npc_agent_state.sql
-- for the same DDL applied as a standalone migration against an already-running DB.
ALTER TABLE events ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'private_interaction';
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_scope_check;
ALTER TABLE events ADD CONSTRAINT events_scope_check CHECK (scope IN ('public_post', 'private_interaction'));

CREATE TABLE IF NOT EXISTS npc_agent_state (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playthrough_id      UUID NOT NULL REFERENCES playthroughs(id) ON DELETE CASCADE,
  role_id             UUID NOT NULL REFERENCES roles(id),
  arc_status          TEXT NOT NULL DEFAULT 'active' CHECK (arc_status IN ('active','strained','broken','resolved')),
  tolerance_note      TEXT,
  last_reflection_day INT NOT NULL DEFAULT 0,
  internal_notes      TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (playthrough_id, role_id)
);

-- seed the 3 existing characters as rows, not code — also doubles as the fallback
-- pool (§3) when a role's candidate pool of real player personas is empty
INSERT INTO roles (slug, display_name, dramatic_function) VALUES
  ('john',  'John',  'the protective one, reacts fast publicly, forgives quickly once addressed'),
  ('drake', 'Drake', 'the quiet one, slow to trust, holds things longer, does not confront directly'),
  ('alex',  'Alex',  'the anxious one, wants closeness, notices being ignored quickly, easily reassured')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO personas (owner_id, name, personality, values_, interests, free_text, traits_version)
VALUES
  (NULL, 'John (default)',  ARRAY['protective','blunt','quick-to-forgive'],   ARRAY['loyalty','fairness'],   ARRAY['sports','gaming','music'],
   'Reacts fast and publicly, but forgives quickly once someone genuinely owns what they did.', 1),
  (NULL, 'Drake (default)', ARRAY['guarded','slow-to-trust','reserved'],      ARRAY['honesty','stability'],  ARRAY['music','art','reading'],
   'Doesn''t confront people directly and holds hurt for a while — a real apology has to be specific.', 1),
  (NULL, 'Alex (default)',  ARRAY['anxious','affectionate','easily-hurt'],    ARRAY['loyalty','creativity'], ARRAY['food','gaming','movies/tv'],
   'Wants closeness, notices being ignored quickly, easily reassured by a little genuine attention.', 1)
ON CONFLICT DO NOTHING;
