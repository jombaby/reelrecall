CREATE TABLE IF NOT EXISTS reelrecall_library (
  owner_id text PRIMARY KEY,
  data jsonb NOT NULL DEFAULT '{"videos":[],"categories":[]}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
