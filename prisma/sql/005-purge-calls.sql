-- prisma/sql/005-purge-calls.sql
--
-- Vide l'historique d'appels, et rien d'autre.
-- À coller dans l'éditeur SQL Supabase quand le script Node n'est pas
-- utilisable (scripts/purge-calls.ts fait exactement la même chose).
--
-- SUPPRIME :  call_results, calls
-- NE TOUCHE PAS : users, teams, phone_lines, call_result_options,
--                 keyyo_config, login_logs, import_batches
--
-- `call_results` doit partir en premier : c'est une clé étrangère vers
-- `calls`, Postgres refuse sinon. Le tout est dans une transaction, donc soit
-- les deux tables sont vidées, soit rien ne l'est.
--
-- IRRÉVERSIBLE. Faites une sauvegarde avant si les données comptent.

BEGIN;

-- Ce qui va disparaître, pour trace dans la sortie de l'éditeur.
SELECT 'avant' AS phase,
       (SELECT count(*) FROM calls)        AS calls,
       (SELECT count(*) FROM call_results) AS call_results,
       (SELECT count(*) FROM users)        AS users,
       (SELECT count(*) FROM teams)        AS teams,
       (SELECT count(*) FROM phone_lines)  AS phone_lines;

DELETE FROM call_results;
DELETE FROM calls;

SELECT 'apres' AS phase,
       (SELECT count(*) FROM calls)        AS calls,
       (SELECT count(*) FROM call_results) AS call_results,
       (SELECT count(*) FROM users)        AS users,
       (SELECT count(*) FROM teams)        AS teams,
       (SELECT count(*) FROM phone_lines)  AS phone_lines;

COMMIT;

-- OPTIONNEL — vide aussi le journal des imports (les lots passés, désormais
-- vides). Laissé commenté : ce n'est pas la table des appels, et un lot
-- conservé ne crée ni doublon ni appel fantôme.
-- DELETE FROM import_batches;
