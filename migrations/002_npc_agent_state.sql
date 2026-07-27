-- Per-NPC swarm agents — schema per npc-swarm-agents-design.md
-- Run once against the target database:
--   psql "$DATABASE_URL" -f migrations/002_npc_agent_state.sql

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
