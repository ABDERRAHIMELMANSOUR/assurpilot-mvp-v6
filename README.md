# AssurPilot — MVP v6

Plateforme de gestion des appels entrants pour assurances (marché français).

Next.js 14 (App Router) · Prisma 5 · PostgreSQL · NextAuth (JWT) · Tailwind CSS.

---

## Démarrage rapide

```bash
# 1. Configurer l'environnement
cp .env.example .env    # puis renseigner DATABASE_URL / DIRECT_URL / NEXTAUTH_SECRET

# 2. Installer les dépendances (déclenche `prisma generate` via postinstall)
npm install

# 3. Initialiser la base + données de test
npm run db:push && npm run db:seed

# 4. Lancer
npm run dev
```

Ouvrir **http://localhost:3000**

> La base est PostgreSQL. Pour du local rapide : `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16`.

---

## Déploiement sur Vercel

1. **Base de données** — provisionner un PostgreSQL managé (Vercel Postgres, Neon,
   Supabase…). Récupérer deux chaînes de connexion :
   - la chaîne **poolée** (PgBouncer / pooler) → `DATABASE_URL`
   - la chaîne **directe** → `DIRECT_URL`

   Les fonctions serverless ouvrent une connexion par cold start : sans pooler,
   la base sature. Ajouter `?pgbouncer=true&connection_limit=1` à `DATABASE_URL`
   si le pooler est en mode transaction.

2. **Variables d'environnement** (Project Settings → Environment Variables) :

   | Variable          | Obligatoire | Rôle                                            |
   |-------------------|-------------|-------------------------------------------------|
   | `DATABASE_URL`    | oui         | Connexion poolée utilisée à l'exécution         |
   | `DIRECT_URL`      | oui         | Connexion directe pour `prisma migrate`/`db push` |
   | `NEXTAUTH_SECRET` | oui         | Signature des JWT (`openssl rand -base64 32`)   |
   | `NEXTAUTH_URL`    | non         | Déduit par Vercel ; à fixer sur domaine custom  |

3. **Build** — aucune configuration spécifique n'est nécessaire : le script
   `postinstall` exécute `prisma generate` à chaque déploiement, ce qui garantit
   un client Prisma à jour (le cache de dépendances de Vercel ne le régénère pas
   tout seul).

4. **Schéma** — appliquer le schéma à la base avant le premier déploiement :
   `npm run db:push` (ou `npm run db:deploy` avec des migrations versionnées).

---

## Comptes de test

Créés par `npm run db:seed` :

| Rôle           | Email                            | Mot de passe |
|----------------|----------------------------------|--------------|
| Administrateur | admin@assurpilot.fr              | admin123     |
| Superviseur    | coach@assurpilot.fr              | coach123     |
| Conseiller 1   | marie.laurent@assurpilot.fr      | agent123     |
| Conseiller 2   | pierre.durand@assurpilot.fr      | agent123     |

---

## Pages disponibles

### Conseiller
| Route                     | Description                        |
|---------------------------|------------------------------------|
| `/conseiller`             | Mes appels + ajouter résultat      |
| `/conseiller/stats`       | Mes statistiques personnelles      |

### Superviseur
| Route                      | Description                        |
|----------------------------|------------------------------------|
| `/superviseur`             | Vue d'ensemble équipe              |
| `/superviseur/appels`      | Tous les appels de l'équipe        |
| `/superviseur/equipe`      | Gérer les conseillers (CRUD)       |
| `/superviseur/activite`    | Dernières connexions de l'équipe   |

### Admin
| Route                        | Description                           |
|------------------------------|---------------------------------------|
| `/admin`                     | Vue globale + KPIs                    |
| `/admin/appels`              | Tous les appels (filtres + manuels)   |
| `/admin/appels/nouveau`      | Créer un appel manuellement           |
| `/admin/classement`          | Classement conseillers                |
| `/admin/utilisateurs`        | Vue d'ensemble utilisateurs           |
| `/admin/conseillers`         | CRUD conseillers                      |
| `/admin/superviseurs`        | CRUD superviseurs                     |
| `/admin/activite`            | Activité et connexions de tous        |
| `/admin/resultats`           | Configurer les options de résultat    |
| `/admin/keyyo`               | Configuration VoIP Keyyo              |

---

## Simuler un appel entrant (dev)

```bash
# Appel répondu aléatoire
curl -X POST http://localhost:3000/api/calls/mock \
  -H "Content-Type: application/json" -d '{}'

# Appel manqué
curl -X POST http://localhost:3000/api/calls/mock \
  -H "Content-Type: application/json" -d '{"isMissed": true}'
```

---

## Réinitialiser les données

```bash
npm run db:seed
```

## Explorer la base

```bash
npm run db:studio
# Ouvre Prisma Studio sur http://localhost:5555
```

---

## Commandes

```bash
npm run dev          # Serveur dev
npm run build        # Build production
npm run start        # Servir le build production
npm run lint         # ESLint (config next/core-web-vitals)
npm run typecheck    # tsc --noEmit
npm run db:push      # Appliquer le schéma (sans migration)
npm run db:migrate   # Créer/appliquer une migration (dev)
npm run db:deploy    # Appliquer les migrations (production)
npm run db:seed      # Insérer données de test
npm run db:studio    # Interface visuelle Prisma
```

---

## Modèles de données

| Modèle            | Description                                    |
|-------------------|------------------------------------------------|
| `User`            | Conseillers, superviseurs, admins              |
| `Team`            | Équipes avec lien superviseur                  |
| `PhoneLine`       | Lignes téléphoniques                           |
| `Call`            | Appels (importés ou manuels)                   |
| `CallResult`      | Résultats qualifiés des appels                 |
| `CallResultOption`| Options configurables de résultat              |
| `ImportBatch`     | Lots d'import de fichiers d'appels              |
| `LoginLog`        | Historique des connexions                      |
| `KeyyoConfig`     | Configuration VoIP Keyyo                       |

Les champs d'identité sont nommés `nom`, `prenom` et `phoneNumber` — à
l'identique dans le schéma Prisma, dans les réponses de l'API et dans les
composants (`UsersTable`, `UserFormModal`), sans couche de mapping.

---

## API

Toutes les routes suivent la convention App Router (`src/app/api/<route>/route.ts`)
et partagent les helpers de `src/lib/api.ts` :

- chaque handler est encapsulé dans un `try/catch` et renvoie un JSON
  `{ "error": "…" }` avec le bon statut — jamais une exception non gérée
  (qui se traduirait par un 502 côté Vercel) ;
- `requireUser()` / `requireRole()` produisent des 401/403 cohérents ;
- les erreurs Prisma connues sont traduites (`P2002` → 409, `P2025` → 404,
  échec d'initialisation → 503), les autres sont journalisées côté serveur et
  renvoyées en 500 générique.

| Route                            | Méthodes           | Accès                        |
|----------------------------------|--------------------|------------------------------|
| `/api/auth/[...nextauth]`        | GET, POST          | public                       |
| `/api/users`                     | GET, POST          | admin, superviseur           |
| `/api/users/[id]`                | GET, PUT, DELETE   | admin, superviseur           |
| `/api/profile`                   | GET, PUT           | authentifié (soi-même)       |
| `/api/teams`                     | GET                | admin, superviseur           |
| `/api/activity`                  | GET                | admin, superviseur           |
| `/api/analytics`                 | GET                | authentifié (selon rôle)     |
| `/api/calls`                     | GET                | authentifié (selon rôle)     |
| `/api/calls/[id]`                | GET, PUT, DELETE   | admin                        |
| `/api/calls/[id]/result`         | POST               | authentifié (selon rôle)     |
| `/api/calls/manual`              | POST               | admin                        |
| `/api/calls/import`              | POST               | admin                        |
| `/api/calls/mock`                | POST               | admin, hors production       |
| `/api/phone-lines`               | GET                | authentifié                  |
| `/api/call-result-options`       | GET, POST          | GET authentifié · POST admin |
| `/api/call-result-options/[id]`  | PUT, DELETE        | admin                        |
| `/api/calls/export`              | GET                | authentifié (selon rôle)     |
| `/api/config/keyyo`              | GET, PUT, POST     | admin                        |

### Visibilité des appels par rôle

Trois règles s'appliquent **côté serveur**, dans le `where` de chaque requête —
elles ne peuvent pas être contournées par un paramètre d'URL forgé.

**Profondeur d'historique** (`src/lib/retention.ts`) : un conseiller voit les
appels des **3 derniers jours**, un coach des **5 derniers jours**, un
administrateur tout l'historique. La borne est le début du jour J−N, pas
« maintenant moins N×24 h », pour que la fenêtre ne glisse pas en cours de
journée. Un `?dateFrom=` plus ancien réduit la fenêtre, il ne l'élargit jamais.

**Masquage du numéro appelant** (`src/lib/mask.ts`) : appliqué dans la réponse
JSON, pas dans le JSX — masquer à l'affichage laisserait le numéro complet dans
le payload. Couvre donc aussi l'export Excel.

| Rôle             | Affichage      |
|------------------|----------------|
| `ADMINISTRATEUR` | `33602020009`  |
| `SUPERVISEUR`    | `336****0009`  |
| `CONSEILLER`     | `********009`  |

**Périmètre** (`src/lib/scope.ts`) : un conseiller ne voit que ses appels, un
coach ceux de ses rattachés directs (`superviseurId`) plus les siens.

### Regroupement des doublons

`GET /api/calls?group=1` renvoie une ligne par numéro appelant (normalisé, donc
`+33687814485`, `0687814485` et `33687814485` sont le même prospect) au lieu
d'une ligne par appel. Champs ajoutés : `attemptCount`, `groupedCallIds`,
`firstAttemptAt`, `lastAttemptAt`, `firstContactBy` et `alreadyContacted`.

La ligne affichée est l'appel **le plus long** du groupe, le plus récent
départageant une égalité exacte. Une conversation de 2:47 est celle qui a
réellement eu lieu ; un appel de 0:15 sur le même numéro est une sonnerie ou un
raccroché, et le laisser porter la ligne attribuerait le lead au conseiller que
le standard a joint en dernier. C'est donc aussi ce choix qui détermine dans
quel espace de travail le lead apparaît.

Le badge « Déjà contacté par » répond à une autre question — qui travaille déjà
ce lead — et nomme le **premier** conseiller à avoir reçu le numéro. Il est
masqué quand ce premier conseiller est celui de la ligne : se voir signaler
soi-même n'apprend rien. À horodatage identique (un standard qui fait sonner
plusieurs postes à la même minute), c'est là encore l'appel le plus long qui
compte comme premier contact, sinon le conseiller qui a laissé sonner quinze
secondes s'entendrait dire qu'il était le premier.

### Badge « Déjà contacté par »

Présent dans **les deux modes**, groupé ou non : `firstContactBy`,
`firstContactAt` et `alreadyContacted` accompagnent chaque ligne de
`/api/calls`. Il n'était auparavant calculé qu'en mode groupé, donc décocher
« Regrouper les doublons » — et toutes les fiches individuelles, qui ne
groupent jamais — perdaient l'alerte sur les écrans mêmes où un conseiller
traite un lead isolé.

La recherche ignore délibérément deux limites :

- **le périmètre du lecteur.** Un conseiller ne voit que ses propres appels ;
  l'appel antérieur d'un collègue lui est donc invisible, et c'est exactement
  la collision que le badge doit éviter ;
- **sa fenêtre d'historique.** Le badge nomme un collègue en face d'un numéro
  déjà affiché, il ne révèle aucun appel que le rôle n'a pas le droit de lire —
  et un lead décroché il y a cinq semaines est précisément le cas où il faut
  prévenir.

Elle est bornée non par une fenêtre de dates mais par **les numéros affichés** :
une requête sur les neuf derniers chiffres (le tronc commun de `0612345678`,
`+33612345678`, `33612345678`, `0033612345678`). Borner par date aurait fait
disparaître les numéros dont l'historique sort de la fenêtre ; interroger les
numéros en main est à la fois plus étroit et complet. Un numéro étranger
finissant pareil peut être ramené : `buildPriorContactMap` renormalise, la
ligne surnuméraire se range donc sous une autre clé et reste sans effet.

`alreadyContacted` signifie « quelqu'un d'autre que le titulaire de cette ligne
a eu ce numéro en premier ». Les tableaux affichent le badge sur ce seul
drapeau, sans le recalculer — sinon l'un d'eux finirait par en diverger.

`firstContactBy` est cherché **hors périmètre** du lecteur : c'est tout l'intérêt
du badge « Déjà contacté par », puisqu'un conseiller ne voit que ses propres
appels et ignorerait donc qu'un collègue travaille déjà ce numéro. La recherche
reste bornée à la fenêtre d'historique du rôle.

Sans `group=1` la réponse est inchangée (une ligne par appel) — l'export Excel
l'utilise, pour conserver chaque tentative.

### Filtres partagés

`/api/calls` et `/api/calls/export` construisent leur `where` avec les mêmes
helpers, dans le même ordre : le classeur ne peut pas diverger de l'écran.
Paramètres communs : `entity` (CPA/ALM), `lineType` (alias `pole`, `subTeam`),
`teamId`, `lineId`, `statut`, `coachId`, `userId` (alias `conseillerId`), et
`period` ou `dateFrom`/`dateTo` (alias `startDate`/`endDate`).

### Entité d'un appel : l'équipe du conseiller

L'entité (CPA / ALM) et le pôle (Auto / Santé) d'un appel sont ceux du
**conseiller qui l'a pris**, jamais du numéro standard sur lequel il est
arrivé. Les deux entités répondent sur des numéros standard partagés : filtrer
sur la ligne classait le travail d'un conseiller CPA sous ALM dès que l'appel
entrait par une ligne ALM.

Concrètement, `callEntityWhere` interroge `assignedUser.team`, pas
`calls.teamId` ni `phone_lines.teamId`. Trois conséquences utiles :

- `/admin/entites/CPA` montre tout le travail des conseillers CPA, quelle que
  soit la ligne utilisée — et rien d'autre ;
- corriger l'équipe d'un conseiller reclasse tout son historique d'un coup,
  sans toucher une seule ligne d'appel ;
- un appel sans conseiller assigné n'appartient à aucune entité, ce qui est la
  réponse honnête : personne ne l'a traité.

À l'import, l'appel hérite de l'équipe du conseiller identifié par son numéro
(`Numéro appelé`). `Numéro appelant` ne sert plus qu'à retrouver la ligne
affichée dans la colonne « Ligne ». Un conseiller sans équipe est signalé dans
l'aperçu d'import : ses appels s'importent mais n'apparaîtront dans aucun
espace d'entité.

### Prospects et doublons

La première carte des tableaux de bord compte les **numéros appelants
distincts**, pas les lignes d'appel : un prospect qui rappelle trois fois est
un lead, pas trois. Les tentatives répétées ont leur propre carte
« Doublons », et le volume brut reste en sous-titre, donc les trois chiffres se
recoupent à l'écran (300 prospects + 71 doublons = 371 appels).

`/api/analytics` renvoie `totalProspects` et `totalDoublons` à côté de
`totalAppels` (inchangé, toujours le nombre d'appels), et chaque ligne du
classement porte `prospects` / `doublons`. La carte s'appelle « Total
prospects » plutôt que « Total appels » parce qu'elle ne compte plus des
appels ; `totalAppels` reste donc exact pour le taux de conversion.

Deux points de méthode :

- l'unicité porte sur le numéro **normalisé** (`normalizePhone`), comme le
  regroupement : `+33687814485`, `0687814485` et `33687814485` sont un seul
  prospect, là où un `COUNT(DISTINCT caller_number)` SQL en compterait trois ;
- `totalProspects` est calculé sur l'**ensemble** du périmètre filtré, pas en
  additionnant les prospects de chaque conseiller : un prospect ayant joint
  deux conseillers serait sinon compté deux fois. Les autres totaux restent la
  somme des lignes du classement.

Invariant vérifié : `totalProspects` est exactement le nombre de lignes que
`/api/calls?group=1` renvoie pour les mêmes filtres — la carte et le tableau ne
peuvent pas se contredire. Un numéro masqué compte pour un prospect à lui seul,
des deux côtés : deux appelants anonymes ne sont pas une même personne.

### Section « Statistiques détaillées »

Le tableau de bord `/admin` porte un bloc d'analyse distinct des tableaux
d'appels : d'un côté « comment allons-nous », de l'autre « que dois-je traiter
ensuite » — les mélanger est ce qui rend un tableau de bord illisible.

Deux tableaux : par équipe (entité, pôle, effectif, appels, prospects, manqués,
devis, contrats, avec une ligne de total) et par conseiller (équipe, appels,
prospects, manqués, devis, contrats, taux de contrat, le nom renvoyant vers sa
fiche).

Il est alimenté par la **même** réponse `/api/analytics` que les cartes du
haut — champ `teams` — donc il suit les filtres de date, d'entité et de pôle
sans seconde requête à maintenir en phase, et ne peut pas les contredire. Un
sous-titre rappelle le périmètre couvert, pour qu'une vue filtrée ne soit pas
prise pour la plateforme entière.

`tally` y est appliqué aux appels de l'équipe **mis en commun**, et non à la
somme des chiffres de ses membres : les prospects sont des numéros distincts, et
un prospect ayant joint deux conseillers d'une même équipe est un prospect pour
cette équipe.

### Vider l'historique d'appels

```bash
npm run db:purge-calls              # aperçu, ne modifie rien
npm run db:purge-calls -- --yes     # supprime call_results puis calls
npm run db:purge-calls -- --yes --batches   # vide aussi le journal d'imports
```

Le script (`scripts/purge-calls.ts`) supprime **uniquement** l'historique
d'appels, dans une transaction, et compte les tables hors périmètre (users,
teams, phone_lines, call_result_options, keyyo_config, login_logs) avant et
après : si l'une d'elles bouge, il échoue au lieu de se taire.
`call_results` part en premier — c'est une clé étrangère vers `calls`.

Sans accès CLI à la base (Supabase), `prisma/sql/005-purge-calls.sql` fait
exactement la même chose depuis l'éditeur SQL. L'opération est irréversible :
sauvegardez avant si les données comptent.

### Contrats signés

Le classement (`/admin/classement`, `/api/analytics`) est ordonné par
**contrats signés**, avec les devis puis le taux de conversion en départage ;
`?sort=conversion` rétablit l'ordre précédent.

« Contrat signé » est une **donnée**, pas un changement de schéma : c'est une
ligne de `call_result_options` (`CONTRAT_SIGNE`). Sur une base déjà en service,
appliquer `prisma/sql/004-contrat-signe.sql` — idempotent, sans migration ni
reclassement des appels existants, qui resteront donc à 0 contrat tant que
l'option n'est pas utilisée.

### Import de fichiers d'appels

`POST /api/calls/import` (multipart, champ `file`, `preview=true` pour un essai
à blanc) accepte `.xlsx`, `.xls` et `.csv` jusqu'à 10 Mo. Les en-têtes sont
reconnus sans tenir compte de la casse, des accents ni des séparateurs, les CSV
UTF-8 comme Latin-1 sont décodés correctement, et un numéro de conseiller ayant
perdu son zéro initial (conversion numérique du tableur) est rattrapé.

**Un numéro client = un seul enregistrement.** Une ligne est refusée dès que
son numéro est déjà en base, ou qu'une ligne antérieure du même fichier l'a déjà
pris. Rien d'autre que le numéro n'entre dans la décision : ni l'horodatage, ni
la durée, ni le conseiller.

Seul le **premier** appel de chaque numéro est conservé, au sens chronologique
et non au sens de l'ordre du fichier : ces exports sont souvent écrits du plus
récent au plus ancien, et garder la ligne du haut classerait le dernier appel
d'un prospect comme son premier contact. L'ordre du fichier ne sert qu'à
départager une égalité.

Le numéro est normalisé (`normalizePhone`), donc `+33687814485`, `33687814485`
et `0687814485` sont un seul prospect.

**Cette règle est volontairement destructrice.** Les rappels d'un prospect sont
écartés à l'entrée et n'atteignent jamais la base : pour les données arrivant
par cet import, les compteurs de tentatives `(2)`, la carte « Doublons » du
tableau de bord et le badge « Déjà contacté par » n'ont plus rien à compter.
Elle remplace la règle précédente (numéro + horodatage exact + durée exacte),
qui laissait entrer les rappels réels.

Un fichier dont toutes les lignes sont déjà connues renvoie un succès avec
`importedRows: 0` plutôt qu'une erreur : re-déposer un export est le cas normal,
pas un échec.
