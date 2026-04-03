# AssurPilot — MVP v3

Plateforme de gestion des appels entrants pour assurances (marché français).

---

## Démarrage rapide

```bash
# 1. Installer les dépendances
npm install

# 2. Initialiser la base + données de test
npm run db:push && npm run db:seed

# 3. Lancer
npm run dev
```

Ouvrir **http://localhost:3000**

---

## Comptes de test

| Rôle          | Email                            | Mot de passe |
|---------------|----------------------------------|--------------|
| Administrateur | admin@assurpilot.fr             | admin123     |
| Superviseur    | superviseur@assurpilot.fr       | super123     |
| Conseiller 1   | marie.laurent@assurpilot.fr     | agent123     |
| Conseiller 2   | pierre.durand@assurpilot.fr     | agent123     |

Sur la page de login, cliquez sur un compte pour le remplir automatiquement.

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
npm run db:push      # Appliquer le schéma
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
| `LoginLog`        | Historique des connexions                      |
| `KeyyoConfig`     | Configuration VoIP Keyyo                       |
