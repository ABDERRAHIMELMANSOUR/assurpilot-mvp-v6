-- prisma/sql/004-contrat-signe.sql
--
-- Adds the "Contrat signé" call result, which the leaderboard now ranks on.
--
-- This is DATA, not schema: `call_results.resultat` already stores the `value`
-- of a `call_result_options` row, so nothing is altered, dropped or migrated.
-- Run it in the Supabase SQL editor on the existing database; it is safe to run
-- more than once.
--
-- After running it, "Contrat signé" appears in the result dropdown and every
-- conseiller ranks at 0 contracts until the option starts being used — existing
-- calls are NOT reclassified, on purpose. Nothing about the historical rows is
-- touched.

INSERT INTO call_result_options (id, label, value, color, "isActive", "order")
VALUES (
  -- A stable id so a second run collides on the primary key too, not only on
  -- the unique `value`.
  'clx_result_contrat_signe',
  'Contrat signé',
  'CONTRAT_SIGNE',
  'green',
  true,
  0
)
-- No conflict target: a second run collides on the primary key or on the
-- unique `value`, and either way the statement must be a no-op.
ON CONFLICT DO NOTHING;

-- Re-order the existing options so the new one leads the dropdown, and move
-- "Devis réalisé" off green so the two are told apart at a glance. Display
-- attributes only — no call row is reclassified.
UPDATE call_result_options SET "order" = 1, color = 'blue'   WHERE value = 'DEVIS_REALISE';
UPDATE call_result_options SET "order" = 2, color = 'purple' WHERE value = 'DEVIS_ENVOYE';
UPDATE call_result_options SET "order" = 3, color = 'yellow' WHERE value = 'RAPPEL_PREVU';
UPDATE call_result_options SET "order" = 4, color = 'gray'   WHERE value = 'INFORMATION';
UPDATE call_result_options SET "order" = 5, color = 'red'    WHERE value = 'NON_INTERESSE';
UPDATE call_result_options SET "order" = 6, color = 'gray'   WHERE value = 'FAUX_NUMERO';

-- Verify.
SELECT "order", value, label, "isActive" FROM call_result_options ORDER BY "order";
