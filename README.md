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
appels des **3 derniers jours**, un coach de **tout le mois en cours** (au moins les
5 derniers jours : le 3 du mois, la fenêtre remonte au 28 du mois précédent), un
administrateur tout l'historique.

**Période par défaut du coach** : « Ce mois » partout (tableau de bord, « Tous les appels »,
« Mes appels », fiche d'un conseiller), sans bouton « Tout ». Côté API, `/api/analytics`,
`/api/calls` et l'export appliquent le mois en cours à un coach qui ne précise ni
`period` ni dates (`defaultPeriodFor` dans `src/lib/dates.ts`) ; une période ou des dates
explicites l'emportent toujours. La borne est le début du jour J−N, pas
« maintenant moins N×24 h », pour que la fenêtre ne glisse pas en cours de
journée. Un `?dateFrom=` plus ancien réduit la fenêtre, il ne l'élargit jamais.

**Numéro appelant** : affiché **en entier** pour tous les rôles (administrateur,
coach, conseiller), dans les tableaux, les modales et l'export Excel, pour pouvoir
rappeler le client directement. Il n'y a plus aucun masquage (`src/lib/mask.ts`
supprimé). La visibilité reste bornée par le **périmètre** et la **profondeur
d'historique** ci-dessus : un conseiller ne voit que ses propres appels.

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

### Barre de périmètre : entité, ligne, coach

`ScopeFilter` porte les trois menus — entité, ligne/pôle et « Tous les
coaches » — et `withScope` est le seul endroit qui les traduit en paramètres
d'URL. Un seul composant pour `/admin`, `/admin/appels` et
`/admin/classement` : les menus ne peuvent pas diverger d'une page à l'autre,
et le tableau, les statistiques et l'export Excel lisent les mêmes paramètres.

La liste des coachs vient de `/api/users?role=SUPERVISEUR`. `useCoaches` et
`coachName` sont exportés pour qu'une page puisse nommer le coach choisi —
dans le sous-titre des statistiques, par exemple — sans redéfinir ce qu'est la
liste.

`coachId` ne se comporte pas tout à fait de la même façon des deux côtés, et
c'est voulu :

- `/api/analytics` sélectionne les **conseillers rattachés** au coach
  (`superviseurId`). Comme pour l'entité, le filtre porte sur les personnes,
  donc les cartes restent égales à la somme des lignes en dessous ;
- `/api/calls` et l'export retiennent tout l'espace de travail du coach — ses
  propres appels, ceux qu'il a transférés et ceux de ses conseillers — car
  c'est ce qu'on attend d'une liste d'appels filtrée sur un coach.

Un coach qui consulte son propre tableau de bord est déjà limité à ses
rattachés ; le paramètre ne lui sert donc que sur lui-même, un administrateur
pouvant pivoter sur n'importe qui. Un identifiant inconnu est ignoré plutôt que
refusé — une URL mise en favori avec un coach supprimé ne doit pas casser la
page — et `applied.coachId` indique ce qui a réellement été appliqué.

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
peuvent pas se contredire. Un appelant sans numéro compte pour un prospect à lui seul,
des deux côtés : deux appelants anonymes ne sont pas une même personne.

### Envoi des appels vers AZZUR (CRM)

Chaque appel **nouvellement enregistré** (saisie manuelle `POST /api/calls/manual`,
import de fichier) est transmis au web service « mise en relation » (MER) d'AZZUR,
pour apparaître dans le dispatch board ou directement chez le conseiller. Code :
`src/lib/azzur.ts`. **Désactivé par défaut.**

| Variable                    | Rôle                                                                      |
|-----------------------------|---------------------------------------------------------------------------|
| `AZZUR_WEBHOOK_ENABLED`     | `true` pour activer                                                       |
| `AZZUR_MER_URL`             | URL complète du MER (Administration › Provenances › « Voir l'URL »)       |
| `AZZUR_MER_ID_PROV`         | optionnel : remplace `id_prov` (51 dans l'URL fournie)                    |
| `AZZUR_MER_PROVENANCE`      | valeur du champ `provenance` : le code AZZUR (défaut `AE`)                |
| `AZZUR_MER_METHOD` / `_FORMAT` | `GET` (défaut, c'est le REST GET documenté par AZZUR) ou `POST` ; `form`/`json` (POST seulement) |
| `AZZUR_MER_RETOUR_WS`       | `json` ou `text` : format de réponse d'AZZUR (`retour_ws`). Vide = non envoyé (texte par défaut, que l'on interprète) |
| `AZZUR_MER_FIELDS`          | JSON : renomme un champ, ou `""` pour ne plus l'envoyer                   |
| `AZZUR_MER_TIMEOUT_MS`      | délai par tentative (5000)                                                |
| `AZZUR_MER_MAX_AGE_HOURS`   | les appels plus anciens ne sont pas poussés (48) : pas d'afflux d'historique |
| `AZZUR_MER_ONLY_ANSWERED`   | `true` = ignorer les appels manqués                                       |

**L'URL contient la clé secrète `cle_ws`** : à saisir uniquement dans Vercel / `.env`,
jamais dans le dépôt (public), et à régénérer côté AZZUR si elle a fuité. Elle est
masquée dans tous les logs.

Requête **GET** conforme à la documentation du MER d'AZZUR (v1.9.6.64, « Liste des
variables GET »), paramètres encodés par `URLSearchParams` :

| Paramètre AZZUR | Valeur envoyée |
|---|---|
| `ws`, `id_prov`, `cle_ws` | `mer`, `51`, la clé (toujours dans l'URL ; `id_prov=51` **est** la provenance « AE ») |
| `tel` **et** `port` | le même numéro complet, forme `06…` (un appel ne dit pas fixe ou mobile) |
| `nom`, `prenom` (obligatoire / non) | `Appel Assurpilot`, `reçu par <conseiller qui a reçu l'appel>` (modèles `{conseiller}`, `{ligne}`, `{date}`) |
| `date_naissance` (obligatoire, aaaa-mm-jj) | `1900-01-01` |
| `cp` (obligatoire, 5 chiffres) | `00000` |
| `commentaire` (255 car.) | « Appel entrant - Ligne santé CPA du … (Assurpilot) : coordonnées à compléter » |
| `date_cotation` (aaaa-mm-jj hh:mm:ss) | date et heure de l'appel, heure de Paris |
| `num_devis_initial` (24 car.) | identifiant de l'appel côté Assurpilot |
| `id_user` | identifiant **AZZUR** du conseiller, voir ci-dessous (sinon absent) |

**Conseiller** : AZZUR attend *son* identifiant d'utilisateur, que nous n'avons pas.
`AZZUR_MER_USER_MAP` (JSON e-mail du conseiller → `id_user` AZZUR) range la fiche dans son
espace ; `AZZUR_MER_ID_USER` (`0` = personne, dispatch board) sert aux conseillers absents de la
table ; sans rien, AZZUR applique son utilisateur par défaut. `provenance`, `conseiller` et
`conseiller_nom` ne sont **pas** des variables AZZUR : désactivés par défaut.

**Données imposées par AZZUR** : `nom`, `date_naissance` et `cp` sont obligatoires (et
`mail`, `tel` ou `port`), alors qu'un appel n'en contient aucune ; des **valeurs de
remplacement** volontairement évidentes sont donc envoyées (`AZZUR_MER_DEFAULTS`). Ces fiches
sont à **compléter par le conseiller** dans AZZUR (le commentaire le dit) : aucun devis ne
doit être fait sur 1900 / 00000. Une valeur vide dans `AZZUR_MER_DEFAULTS` n'envoie pas le
champ. Les fiches AZZUR de ce service sont de type Santé (seul type documenté).

**Vérification avant envoi (import Excel → AZZUR)** : l'import **n'envoie plus rien** à AZZUR.
Son résultat propose « Vérifier la répartition et envoyer vers AZZUR », qui ouvre
`/admin/azzur?source=batch:<id>`. Sur cette page, on choisit les appels (un import récent ou
les appels du jour) puis **Analyser** (`src/lib/azzurReview.ts`, rien n'est envoyé) :

- **Un numéro = une fiche**, attribuée au **premier conseiller** qui l'a reçu (premier appel ;
  à égalité exacte de minute, l'appel le plus long) — dans le fichier **ou** dans l'historique des
  `AZZUR_MER_DEDUPE_DAYS` jours (7) avant. `+33 6…` et `06…` sont le même numéro. Ses autres appels
  sont des **doublons ignorés**, comptés à part. L'import en base, lui, ne change pas.
- Si le premier appel est **antérieur au fichier** (déjà reçu), les appels du fichier sont
  « déjà reçus » et ne sont pas envoyés ; la case « Inclure les numéros déjà reçus avant » les
  envoie une seule fois, au conseiller de ce premier appel.
- Tableau par lien — AUTO ALM, SANTÉ ALM, AUTO CPA, SANTÉ CPA (+ une ligne « équipe non
  identifiée » si besoin) : destination, **appels**, **fiches à envoyer**, **doublons ignorés**,
  **déjà reçus**, conseillers ; « Détails » donne le détail par conseiller, un exemple de fiche et la
  liste des numéros.
- **Envoi manuel** : « Envoyer vers AZZUR » par lien, ou « Confirmer et envoyer tout » (avec
  confirmation). Le serveur **recalcule** la liste à chaque envoi (le navigateur n'envoie jamais de
  liste), par lots de 50 avec barre de progression ; « tout » saute les liens déjà envoyés.
  Chaque fiche porte l'id de son premier appel (`num_devis_initial`) : renvoyée, AZZUR répond
  doublon. Un envoi confirmé ignore la limite d'âge de l'envoi automatique.
- La saisie manuelle d'un appel unique (`/admin/appels/nouveau`) reste, elle, envoyée
  automatiquement à sa création.

**Un lien par équipe et produit** (`/admin/azzur`, `src/lib/azzurRouting.ts`) : chaque appel part
vers le lien de l'**équipe et du produit de son conseiller** — `AUTO ALM`, `SANTÉ ALM`,
`AUTO CPA`, `SANTÉ CPA` — lus dans le nom de son équipe (« Équipe auto CPA »), à défaut dans le
libellé de la ligne d'arrivée. Chaque lien se saisit sur la page : URL MER complète (avec
`id_prov` et `cle_ws`) **ou** un simple `id_prov` (lien principal avec cette provenance). Un lien non
défini — ou un conseiller sans équipe identifiable — utilise le **lien principal** `AZZUR_MER_URL`.
Les paramètres standard (`ws=mer`, `id_prov`, `cle_ws`, `nom`, `prenom`, `cp`, `date_naissance`,
`tel`, `port`, `commentaire`…) sont identiques sur les quatre. Les liens sont dans la table
`azzur_routes` (`prisma/sql/009-azzur-routes.sql`, à exécuter une fois ; sans elle tout part vers le
lien principal et la page l'indique) ; la clé n'est jamais renvoyée au navigateur, et une URL doit
être sur le **même serveur** que le lien principal. Variables de secours :
`AZZUR_MER_URL_AUTO_ALM`, `_SANTE_ALM`, `_AUTO_CPA`, `_SANTE_CPA`. Le tableau de vérification
et les résultats indiquent le lien utilisé.

**Configuration et diagnostic** : page admin `/admin/azzur` (menu Configuration › Intégration
AZZUR) — état de la configuration, liens par équipe, « Lire la documentation » du MER, puis la
vérification avant envoi décrite plus haut. Aucun envoi n'est fait sans clic (hors saisie manuelle
d'un appel). Commencer par un lien avec peu de fiches pour contrôler le résultat dans AZZUR. Rien
ne garde la trace des envois passés : renvoyer une sélection déjà envoyée repasse par AZZUR, qui
répond « doublon » grâce à `num_devis_initial`.

Limite connue : pas de file persistante, un appel dont les 3 tentatives échouent
n'est pas renvoyé automatiquement (il est dans les logs).

### Statistiques des lignes (`/admin/statistiques-lignes`)

Réconciliation des lignes standard **CPA / ALM** avec les conseillers qui ont
décroché, pour une période choisie (Aujourd'hui, 7 jours, Ce mois, Personnalisé).
Administrateur uniquement ; règles de calcul dans `src/lib/lineStats.ts`, données
par `GET /api/admin/stats-lignes`.

| Carte                          | Appels répondus qui sont arrivés sur… | …et décrochés par un conseiller |
|--------------------------------|---------------------------------------|---------------------------------|
| Standard CPA → Conseiller ALM  | la ligne CPA                          | équipe ALM                      |
| Standard ALM → Conseiller ALM  | la ligne ALM                          | équipe ALM                      |
| Standard CPA → Conseiller CPA  | la ligne CPA                          | équipe CPA                      |
| Standard ALM → Conseiller CPA  | la ligne ALM                          | équipe CPA                      |

- **Ligne source** : entité de la ligne d'arrivée (équipe de la ligne, à défaut son
  libellé, à défaut l'équipe de l'appel). **Conseiller** : entité de l'équipe du
  conseiller qui a décroché, pas de la ligne (cf. `src/lib/entity.ts`).
- Seuls les appels **répondus** par un conseiller dont l'équipe est ALM ou CPA
  comptent. Le reste (manqués, sans conseiller, équipe ni ALM ni CPA, ligne
  inconnue) est listé sous les totaux, pour que les chiffres se réconcilient.
- **Doublons** = appels bruts − appelants uniques, **par catégorie** : un même
  numéro (`+33 6…` et `06…` sont identiques) qui rappelle dans la même catégorie
  sur la période. Un numéro vide n'est jamais fusionné avec un autre.
- **Branche / Produit** (`?produit=tous|sante|auto`, alias `branche`) : Santé ou Auto,
  lu sur la **ligne** d'arrivée (son équipe, à défaut son libellé « Ligne santé CPA »,
  à défaut l'équipe de l'appel) et, seulement si la ligne n'en nomme aucun, sur
  l'équipe du conseiller. La ligne prime : un conseiller de l'équipe santé qui
  décroche sur la ligne auto compte en Auto. Les accents et la casse sont ignorés.
  Un appel dont le produit est indéterminé est exclu dès qu'un produit est choisi.
- **Brut / Net** : brut liste chaque appel ; net une ligne par appelant et par
  catégorie (le plus long appel, avec le nombre de tentatives). Cliquer une carte
  restreint le tableau à cette catégorie. Les filtres Ligne source et Équipe
  conseiller s'appliquent avant le calcul, donc cartes et tableau décrivent les
  mêmes appels.
- Numéros affichés **en entier**. Au plus 50 000 appels analysés et 500 lignes de
  tableau par requête (un bandeau le signale) ; les cartes utilisent tous les
  appels analysés. Vérifié contre un calcul SQL indépendant (mêmes totaux).

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

### Tableau de bord coach : réglages de réception

`/superviseur` est l'espace du coach (`SUPERVISEUR`) : appels reçus par son
équipe, puis un tableau « Par conseiller » (appels, prospects, manqués, devis,
contrats, taux) avec deux commandes par ligne :

- **Appels entrants** — interrupteur : le conseiller est-il éligible à recevoir
  des appels ?
- **Booster** — le conseiller est prioritaire dans la distribution.

**Accès.** Réservé au coach, côté serveur : `superviseur/layout.tsx` redirige
tout autre rôle (administrateur compris) vers son propre accueil, et les routes
`/api/coach/advisors*` répondent 403. Avant ce garde-fou, le layout parent ne
vérifiait que l'existence d'une session : un conseiller pouvait ouvrir
`/superviseur` en tapant l'URL. Un coach n'agit que sur **ses** conseillers
(rattachement direct `superviseurId`), jamais sur ceux d'un autre coach, ni sur
un coach ou un administrateur.

**Persistance.** Table `advisor_call_settings`, une ligne optionnelle par
conseiller (`isActiveForCalls`, `isBoosted`, `updatedById`). **Pas de ligne =
valeurs par défaut** (appels actifs, pas de boost) : aucun rattrapage à faire et
aucune ligne existante n'est touchée.

Ces deux réglages sont dans une table à part plutôt qu'en colonnes de `users`
volontairement : `auth.ts` et une dizaine de routes lisent `users` sans `select`
explicite, donc une colonne de plus y serait lue immédiatement — et le login
casserait pour tout le monde tant que le SQL n'aurait pas tourné sur Supabase.
Avec une table séparée, seul ce tableau de bord dépend de la migration.

**À faire sur Supabase : exécuter `prisma/sql/006-advisor-call-settings.sql`**
(additif, idempotent, aucune table existante modifiée). Tant que ce n'est pas
fait, le tableau affiche un bandeau et grise les commandes ; le reste de
l'application n'est pas affecté.

**Règles** (appliquées par l'API, pas seulement par l'interface) :

- couper les appels entrants retire aussi le boost, en une seule opération ;
- on ne peut pas booster un conseiller dont les appels sont coupés (409) ;
- un compte désactivé n'a pas de commandes modifiables (409) ;
- seuls des booléens stricts sont acceptés — `"false"` est vrai en JavaScript.

L'interface répond immédiatement puis se cale sur ce que le serveur a réellement
enregistré ; un refus restaure l'état précédent et l'explique dans une
notification.

**Ce que ces réglages commandent aujourd'hui.** L'application ne distribue pas
elle-même les appels entrants : l'affectation se fait dans le standard
(Keyyo) et arrive ici par import. Les réglages sont donc **enregistrés et
exposés**, mais **rien en production ne les lit encore** — couper les appels
d'un conseiller ici ne l'empêche pas d'en recevoir tant que le standard ne
consulte pas cette table. Le seul consommateur dans ce dépôt est le simulateur
d'appels de développement (`/api/calls/mock`), qui écarte les conseillers coupés
et favorise les boostés (poids ×3) ; c'est ce qui a permis de vérifier la
sémantique de bout en bout.

### Page admin « Demandes de routage »

`/admin/demandes-routage` (menu Gestion) rassemble ce que les coachs demandent
pour chaque conseiller et ce qui reste à faire **sur le standard (Keyyo / PBX)**.

**Deux états, pas un.** Les interrupteurs du coach sont une *demande*
(`advisor_call_settings`). « Il faut activer / couper / booster ce conseiller sur
le standard » n'est pas une propriété de cette demande : c'est l'**écart** entre
elle et ce qui est réellement appliqué. L'application ne pilote pas Keyyo, elle ne
peut donc pas le deviner ; l'administrateur l'enregistre en cliquant
« Marquer appliqué » (table `advisor_call_applied`). Pas de ligne = valeurs par
défaut des deux côtés, donc un conseiller que personne n'a touché n'a rien à
faire. `lib/routingState.ts` est la seule définition de « à appliquer » —
cartes, filtres, badges et export ne peuvent pas diverger.

Filtres : À appliquer · Appels à activer · Appels à couper · À booster · Boost à
retirer · Routage actif, plus recherche et coach.

**Actions de l'admin.**

- *Forcer* un réglage (interrupteur / bouton dans le tableau), avec les mêmes
  règles que pour le coach — appliquées par la **même fonction**, donc
  l'administrateur ne peut pas créer un état qu'un coach ne pourrait pas créer.
  Cela modifie la *demande* seulement : le changement apparaît ensuite comme du
  travail restant à faire.
- *Marquer appliqué*, un conseiller ou tous ceux affichés. **Compare-and-set** :
  chaque élément porte l'état que l'admin avait sous les yeux ; il n'est appliqué
  que s'il est toujours celui en base, sinon il est renvoyé en `stale` et rien
  n'est écrit. Approuver revient à affirmer que le standard correspond à un état
  précis ; si le coach vient de changer un interrupteur, l'admin n'a pas fait ce
  travail-là, et l'enregistrer comme fait laisserait standard et application en
  désaccord sans que rien ne le signale.
- *Copier la liste* (TSV, prêt à coller dans un tableur) et *Exporter Excel*. Les
  deux portent sur les lignes **affichées**. L'export reçoit les identifiants
  visibles et relit les valeurs en base, sans second jeu de filtres à maintenir
  côté serveur ; toutes les cellules sont typées texte, de sorte que le zéro
  initial d'un `0988…` et un libellé commençant par `=` restent tels quels.

**Mise à jour en direct.** Pas de canal poussé : l'application tourne sur des
fonctions serverless, qui ne peuvent pas garder une connexion ouverte. Les deux
pages interrogent donc l'API (admin : 5 s, coach : 8 s), seulement quand l'onglet
est visible, et immédiatement au retour sur l'onglet. Mesuré avec deux navigateurs :
~5 s dans les deux sens, sans rechargement. Côté admin, une ligne modifiée par
quelqu'un d'autre est surlignée ; côté coach, un rafraîchissement ne s'applique
jamais par-dessus un interrupteur en cours d'écriture, et une réponse plus
ancienne qu'une écriture qui vient d'aboutir est écartée.

**Accès.** `/admin/*` est désormais gardé côté serveur (`admin/layout.tsx`), comme
`/superviseur` : le layout parent ne vérifiait que l'existence d'une session, un
coach ou un conseiller pouvait donc ouvrir n'importe quelle page admin en tapant
l'URL (l'API refusait les données, mais les écrans et leurs commandes
s'affichaient). Les routes `/api/admin/call-settings*` répondent 403 à tout autre
rôle.

**Diagnostic des erreurs de base.** Les routes de réglages (coach et admin)
traduisent les erreurs Prisma en messages exploitables au lieu du « Erreur de
base de données » générique : table absente (`P2021`) → le fichier SQL à exécuter ;
colonne absente (`P2022`) → la table et la colonne concernées ; pool de connexions
saturé ou coupé (`P2024` / `P2037` / `P1017`) → la piste `connection_limit` ; tout
autre code Prisma → affiché avec son code. Seuls des codes et des noms d'objets,
jamais la requête ni ses valeurs. Pour vérifier d'un coup où en est la base :

```sql
select table_name, column_name, data_type
from information_schema.columns
where table_name in ('advisor_call_settings', 'advisor_call_applied')
order by table_name, ordinal_position;
```

Attendu : `advisor_call_settings` — `userId, isActiveForCalls, isBoosted, updatedAt,
updatedById` ; `advisor_call_applied` — `userId, isActiveForCalls, isBoosted,
appliedAt, appliedById`.

**Migrations, dans l'ordre : `006` puis `007`** (`prisma/sql/`). Chacun est
**convergent**, pas seulement idempotent.

Un `CREATE TABLE IF NOT EXISTS` seul saute une table déjà présente *quelle que soit
sa forme* : une table laissée à moitié construite — un simple `("userId")`, par
exemple — était acceptée sans rien dire, et l'application échouait ensuite sur les
colonnes absentes (Prisma `P2022`). C'est exactement ce qui s'est produit en
production. Les deux fichiers amènent désormais la table à la forme exacte du
modèle Prisma **depuis n'importe quel point de départ** : création si absente,
ajout de chaque colonne manquante, valeurs par défaut pour les lignes existantes,
types / `NOT NULL` / défauts conformes, clé primaire et clé étrangère remplacées
par celles que Prisma attend (quel que soit le nom des anciennes), RLS activé, puis
**vérification** de la forme finale — le script échoue, et tout est annulé (une
seule transaction), si elle n'est pas conforme. Une colonne `userId` d'un mauvais
type est refusée d'entrée avec un message explicite.

Cas d'une table réparée à la main sous d'autres noms : si `advisor_call_applied`
contient `appliedActive` / `appliedActiveForCalls` / `appliedBoosted` (noms qui
n'ont **jamais** existé dans ce dépôt, ni dans le schéma Prisma, ni dans le code),
`007` les **renomme** en `isActiveForCalls` / `isBoosted` quand la colonne
correcte est absente, ce qui conserve les valeurs. Si les deux existent, la bonne
colonne fait foi et l'autre est laissée en place (signalée par un `WARNING`). Les
types sont convertis explicitement (`varchar` → `text`, `timestamp` →
`timestamp(3)`), et toute colonne inconnue `NOT NULL` sans défaut est rendue
nullable pour ne jamais bloquer une écriture de l'application.

Ils ne touchent qu'à leur table (une table de fonctionnalité que personne n'avait pu
utiliser). Les seules lignes supprimées sont celles qui ne pourraient jamais servir :
sans conseiller, doublon pour un même conseiller, ou conseiller disparu. Les
réglages réels d'un conseiller sont conservés tels quels. Si le SQL editor de
Supabase demande confirmation à cause des `DELETE` / `DROP CONSTRAINT`, c'est
attendu.

**Si vous voyez `Colonne manquante en base` ou une erreur Prisma `P2022` : relancez
`006` puis `007`, même s'ils ont déjà été exécutés.** Pour vérifier l'ensemble de la
base (toutes les tables, pas seulement celles-ci) contre le schéma Prisma :

```bash
npm run db:drift    # "-- This is an empty migration." = base conforme
```

Vérifié sur une base de test par `prisma migrate diff` (écart nul) et par un appel
réel de l'application (lecture de la page admin, écriture coach, approbation admin),
depuis 9 états de départ : base neuve ; table réduite à `userId` (le cas réel) ;
deux tables réduites avec une ligne ; sans clé, avec doublons, id `NULL` et ligne
orpheline ; colonnes présentes mais nullables et remplies de `NULL` ; clé étrangère
faite à la main sous un autre nom ; sortie de l'ancien `006` ; réglages réels déjà
présents (conservés) ; et `userId` de type `uuid` (refusé proprement).

L'état « appliqué » est dans une table **à part**, pas en colonnes de
`advisor_call_settings`, parce que Prisma écrit toutes les colonnes d'un modèle à
l'`INSERT`, valeurs par défaut comprises : des colonnes en plus auraient rendu les
interrupteurs du coach dépendants de cette migration. Testé : avec le code déployé
et `advisor_call_applied` absente, login, tableau de bord coach (lecture **et**
écritures), analytics, utilisateurs et appels répondent normalement ; seule cette
page renvoie un 503 qui nomme le fichier SQL à exécuter.

### Conseillers et lignes directes (`prisma/sql/008-conseillers-lignes.sql`)

La liste des conseillers et de leur ligne directe est dans `prisma/data/conseillers-lignes.json`
(44 conseillers, noms **exactement** comme fournis). `npm run db:gen-conseillers` génère le SQL ;
à exécuter dans le SQL editor de Supabase (ré-exécutable, la 2ᵉ fois ne change rien).

- La ligne est écrite au format que l'import compare (`0XXXXXXXXX` : `+33374470362`,
  `33374470362` et `374470362` donnent `0374470362`), donc le « Numéro appelé » d'un export
  Keyyo retrouve le conseiller.
- Un conseiller est reconnu par son nom (casse, accents et ordre prénom/nom ignorés) : s'il
  existe (un seul, rôle CONSEILLER), sa ligne et l'orthographe de son nom sont mis à jour, rien
  d'autre (équipe, coach, mot de passe). Sinon il est **créé** (actif, sans équipe ni coach,
  e-mail `prenom.nom@assurpilot.fr`, mot de passe inutilisable) : un administrateur doit lui
  donner une équipe, un coach et un mot de passe dans *Utilisateurs* — sans équipe ses appels
  n'entrent dans aucune entité. `v_creer_manquants := false` en tête du fichier = mise à jour
  seulement. Les utilisateurs absents de la liste ne sont pas touchés.
- Le tableau final liste chaque conseiller avec un `statut` (`OK` = nom et ligne exacts).
- **Lignes en double dans la liste fournie** (appliquées telles quelles, mais un import ne peut
  attribuer l'appel qu'à l'un des deux) : `0755540595` = ANTOINE ROSSI / RAPHAEL ARNAULT ;
  `0374474976` = Sarah FALION / Karine Gomez.

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

Une ligne n'est écartée comme **doublon** que si le numéro client,
l'horodatage **exact** et la durée **exacte** correspondent tous les trois à un
appel déjà en base — ou à une ligne précédente du même fichier. Deux appels du
même numéro à des heures différentes, ou à la même heure avec des durées
différentes, sont deux appels et s'importent tous les deux.

Le regroupement des rappels appartient à la **lecture** (`?group=1`, la case
« Regrouper les doublons »), pas à l'entrée. Bloquer sur le numéro seul a été
essayé puis annulé : sur un export réel, 85 lignes sur 104 étaient refusées,
parce qu'un prospect qui rappelle est le cas normal — le même numéro figurait à
18:14:37 pour 18:25 et à 18:14:13 pour 7 secondes, deux appels manifestement
distincts, et seul le premier survivait. Un appel écarté à l'import est perdu ;
un doublon affiché se replie d'un clic.

La tolérance de ±60 s qui a existé faisait porter toute la décision par le
numéro et la durée : un prospect rappelant dans la minute, ou deux fois pour la
même durée — et tout appel manqué dure 0 seconde — voyait sa deuxième ligne
disparaître sans trace.

Deux précisions sur la clé :

- le conseiller en fait partie, en quatrième champ. Les exports de l'opérateur
  contiennent plusieurs lignes pour un même numéro au même horodatage, une par
  poste sonné ; sans ce champ elles fusionneraient. Il ne peut qu'écarter
  **moins** de lignes, jamais plus ;
- le numéro est normalisé (`normalizePhone`), donc un ré-export écrit
  `+33611223344` reconnaît ses propres lignes stockées `0611223344`. L'horodatage
  et la durée étant exacts, cela ne peut pas confondre deux appels distincts.

La comparaison se fait à la seconde : `parseDate` produit des horodatages à la
seconde entière quel que soit le format lu, donc un écart inférieur à la seconde
ne peut venir que d'un aller-retour de format, jamais de deux appels réels.
L'aperçu affiche les secondes, puisque ce sont elles qui décident.

Un fichier dont toutes les lignes sont déjà connues renvoie un succès avec
`importedRows: 0` plutôt qu'une erreur : re-déposer un export est le cas normal,
pas un échec.
