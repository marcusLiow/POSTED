-- 3D chibi appearance for personas — see appearance.js for the allowed values.
-- Run once against the target database:
--   psql "$DATABASE_URL" -f migrations/003_persona_appearance.sql

ALTER TABLE personas ADD COLUMN IF NOT EXISTS appearance JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Back-fill the seeded default personas with the exact look John/Drake/Alex already
-- have in Posted-Demo v16.html, so nothing visually changes until a real player
-- customizes their own persona.
UPDATE personas SET appearance = '{"hair":"#3d2f20","top":"#8fa9cf","skirt":null,"hoodie":true,"clip":false,"expression":"frown"}'::jsonb WHERE name = 'John (default)' AND appearance = '{}'::jsonb;
UPDATE personas SET appearance = '{"hair":"#2b231b","top":"#bfd4dc","skirt":null,"hoodie":false,"clip":false,"expression":"frown"}'::jsonb WHERE name = 'Drake (default)' AND appearance = '{}'::jsonb;
UPDATE personas SET appearance = '{"hair":"#6e5335","top":"#c0a5d3","skirt":null,"hoodie":false,"clip":false,"expression":"frown"}'::jsonb WHERE name = 'Alex (default)' AND appearance = '{}'::jsonb;
