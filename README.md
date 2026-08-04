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
| `/api/config/keyyo`              | GET, PUT, POST     | admin                        |

### Import de fichiers d'appels

`POST /api/calls/import` (multipart, champ `file`, `preview=true` pour un essai
à blanc) accepte `.xlsx`, `.xls` et `.csv` jusqu'à 10 Mo. Les en-têtes sont
reconnus sans tenir compte de la casse, des accents ni des séparateurs, les CSV
UTF-8 comme Latin-1 sont décodés correctement, et un numéro de conseiller ayant
perdu son zéro initial (conversion numérique du tableur) est rattrapé. Les
doublons sont détectés à ±60 s sur (conseiller, numéro, durée), aussi bien
vis-à-vis de la base que des lignes répétées à l'intérieur du fichier.
