-- prisma/sql/009-azzur-routes.sql
--
-- The four AZZUR web-service links, one per team and product (AUTO_ALM, SANTE_ALM,
-- AUTO_CPA, SANTE_CPA), edited from /admin/azzur. A key with no row (or an empty url)
-- means "use the main AZZUR_MER_URL".
--
-- Own table: no existing table is touched. Convergent like 006/007 — it creates the table,
-- or adds whatever a half-made one lacks, and is safe to run any number of times.
-- The url holds a secret (cle_ws): row-level security is switched on with no policy, so
-- the REST API and the anon key cannot read it; the app connects as `postgres`, which
-- bypasses RLS.

CREATE TABLE IF NOT EXISTS azzur_routes (
  "key"         TEXT         NOT NULL,
  "url"         TEXT         NOT NULL DEFAULT '',
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "updatedById" TEXT,
  CONSTRAINT "azzur_routes_pkey" PRIMARY KEY ("key")
);

ALTER TABLE azzur_routes ADD COLUMN IF NOT EXISTS "url" TEXT NOT NULL DEFAULT '';
ALTER TABLE azzur_routes ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE azzur_routes ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE azzur_routes ADD COLUMN IF NOT EXISTS "updatedById" TEXT;

ALTER TABLE azzur_routes ENABLE ROW LEVEL SECURITY;

SELECT count(*) AS lignes_dans_azzur_routes FROM azzur_routes;
