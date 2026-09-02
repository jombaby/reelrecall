CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL DEFAULT 'owner',
  name text NOT NULL,
  parent_id uuid REFERENCES categories(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name, parent_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS categories_owner_root_name_uidx
  ON categories (owner_id, lower(name)) WHERE parent_id IS NULL;

CREATE TABLE IF NOT EXISTS reels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL DEFAULT 'owner',
  title text NOT NULL,
  url text NOT NULL,
  normalized_url text NOT NULL,
  source text NOT NULL DEFAULT 'Other',
  category text NOT NULL DEFAULT 'Uncategorized',
  subcategory text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  notes text NOT NULL DEFAULT '',
  favorite boolean NOT NULL DEFAULT false,
  unavailable boolean NOT NULL DEFAULT false,
  category_manual boolean NOT NULL DEFAULT false,
  tags_manual boolean NOT NULL DEFAULT false,
  message_at timestamptz,
  added_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, normalized_url)
);

CREATE INDEX IF NOT EXISTS reels_owner_date_idx
  ON reels (owner_id, COALESCE(message_at, added_at) DESC);

INSERT INTO categories (owner_id, name)
VALUES ('owner','Recipes'),('owner','Travel'),('owner','Gardening'),('owner','Life Lessons'),('owner','Other')
ON CONFLICT DO NOTHING;

INSERT INTO categories (owner_id, name, parent_id)
SELECT 'owner', child.name, parent.id
FROM (VALUES ('Recipes','Breakfast'),('Recipes','Entree'),('Recipes','Snacks'),('Recipes','Drinks'),('Recipes','Dessert')) child(parent_name,name)
JOIN categories parent ON parent.owner_id='owner' AND parent.name=child.parent_name AND parent.parent_id IS NULL
ON CONFLICT DO NOTHING;
