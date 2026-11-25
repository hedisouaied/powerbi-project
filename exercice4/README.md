# MISSION CONTROL — application web (exercice4)

Le tableau de bord Power BI de l'exercice3, transformé en application web complète :
- une API **Laravel 13** avec **MySQL** ;
- une interface **React + TypeScript** ;
- des comptes utilisateurs, avec connexion obligatoire.

L'application est **entièrement en français** : l'interface, les messages de l'API et les données elles-mêmes.

Le tableau de bord a le même aspect et calcule les mêmes chiffres que la version Power BI : il exécute le même moteur TypeScript, les mêmes modules et le même design. Dans l'application web, les modifications sont **réellement enregistrées** dans MySQL.

**En ligne :** https://web-production-7ed674ac.up.railway.app — compte de démonstration `demo@missioncontrol.local` / `Demo12345` (prérempli sur la page de connexion).

| Power BI (exercice3) | Application web (exercice4) |
|---|---|
| CSV → Power Query → modèle sémantique | CSV (anglais) → `php artisan mc:import` (traduit en français) → MySQL (les mêmes 31 tables + `dim_date`) |
| 61 relations du modèle | Les mêmes 61 : 54 clés étrangères, plus 7 liens de dates indexés (inactifs dans Power BI aussi) |
| 31 mesures DAX `Feed <table>` | `GET /api/feeds` : mêmes colonnes et même format |
| Modifications : en session ou dans le rapport | Modifications écrites dans MySQL et journalisées dans `activity_log` avec le nom de l'utilisateur |
| Préférences dans le visuel | Préférences sur le compte de l'utilisateur (`users.preferences`) |
| Pas de connexion | Table `users` + authentification par jeton Sanctum (inscription, connexion, déconnexion) |

## Lancer l'application

Prérequis :
- **WSL Ubuntu** avec PHP 8.5, Composer et MySQL 8 (déjà installés sur ce PC) ;
- **Node 22** portable sous Windows (`C:\Users\DELL\tools\node-v22.23.5-win-x64`).

```powershell
powershell -ExecutionPolicy Bypass -File exercice4\tools\start.ps1        # vérifie MySQL, démarre Laravel, construit le front si besoin
```

Puis ouvrez **http://localhost:8000**.

**Rechargement à chaud** pendant le développement : `start.ps1 -Dev`, puis http://localhost:5173/app/. Vite redirige `/api` vers Laravel.

### Première installation (déjà faite sur ce PC)

```bash
# dans WSL
mysql -u root -e "CREATE DATABASE mission_control; CREATE USER 'mission_control'@'localhost' IDENTIFIED BY '<mot de passe>'; GRANT ALL ON mission_control.* TO 'mission_control'@'localhost';"
cd exercice4/backend && composer install && cp .env.example .env && php artisan key:generate   # renseignez DB_* dans .env
php artisan migrate && php artisan mc:import
```
```powershell
# sous Windows, dans exercice4\frontend (Node 22 ; l'AutoRun de cmd doit être suspendu pour npm sur ce PC)
npm install
node node_modules\vite\bin\vite.js build      # écrit backend/public/app
```

## Responsive (téléphone, tablette, ordinateur)

Le tableau de bord s'adapte à l'écran ; il n'est plus réduit comme une image.

| Largeur | Mise en page |
|---|---|
| **> 1024 px** (ordinateur) | Identique à Power BI : barre latérale fixe, grille sur 12 colonnes. |
| **≤ 1024 px** (tablette) | Bouton ☰ et barre latérale en tiroir (fermée après le choix d'un module), bandeau d'indicateurs défilant, grilles sur 2 colonnes, Kanban et Gantt défilant horizontalement. |
| **≤ 640 px** (téléphone) | Une colonne, en-tête compact (logo, recherche, thème, notifications, profil), cartes KPI par 2, calendrier ouvert sur l'Agenda, formulaires en feuille depuis le bas, panneaux en plein écran, boutons d'au moins 38 px. |

Les styles sont dans `frontend/src/mc/visual.less` (section « responsive web layout »). Le menu est géré dans `app.ts` (`.mc-menu-btn`, `mc-nav-open`). Le tableau de bord se redessine quand la largeur change, pour que les graphiques s'adaptent.

**Test :** `node tools/e2e-mobile.js` (18 contrôles) émule un téléphone (390 × 844) et une tablette (820 × 1180) avec de vrais touchers. Il vérifie le menu, le tiroir et le formulaire, et contrôle qu'aucun des 33 modules ne déborde en largeur. Lancez les tests quelques secondes après une reconstruction du front : juste après, le serveur peut encore servir l'ancienne version.

## Traduction française

| Élément | Comment il est traduit |
|---|---|
| **Données** | `backend/database/data/translations_fr.json`. Un seul dictionnaire pour toutes les valeurs (statuts, priorités, types, catégories…), plus des motifs pour les textes numérotés (« Work item 001 » → « Tâche 001 »). Les CSV restent en anglais (la source), `mc:import` écrit le français dans MySQL. |
| **Interface** | `tools/i18n/ui.fr.*.json` : 1 141 textes. `tools/i18n/apply-ui.js` les applique, et les scripts `fix-*.js` traitent les cas particuliers (texte JSX, formats). |
| **Code du tableau de bord** | `tools/i18n/apply-values.js` remplace les comparaisons avec les valeurs anglaises par les valeurs françaises. |
| **Formats** | Nombres `30,90 M TND`, `43,9 %` ; dates `22 nov. 2026`. |
| **API** | `APP_LOCALE=fr`, messages de validation dans `backend/lang/fr/validation.php`. |

**Vérifications :**
- `node tools/i18n/check-values.js` : toutes les valeurs sont traduites, sans collision dans une même colonne.
- `node tools/i18n/equivalence.js` : le moteur en français sur les données françaises donne **exactement** les mêmes résultats que le moteur Power BI en anglais. 43 groupes de résultats comparés, 0 différence.

## API

| Méthode | Chemin | |
|---|---|---|
| POST | `/api/auth/register` | name, email, password, password_confirmation → `{user, token}` |
| POST | `/api/auth/login` | email, password → `{user, token}`. Limité à 10 par minute. |
| GET | `/api/auth/me` · POST `/api/auth/logout` | Jeton Bearer |
| GET | `/api/feeds` | Les 31 tables au format `{c: colonnes, r: lignes}`. Mis en cache jusqu'à la prochaine écriture. Les salaires ne sont jamais inclus. |
| GET / PUT | `/api/me/preferences` | `{preferences, workspace}` de l'utilisateur connecté |
| POST | `/api/tables/{table}` | Crée une ligne dans une table modifiable. La clé primaire est obligatoire. |
| PATCH / DELETE | `/api/tables/{table}/{id}` | Modifie ou supprime une ligne |

**Tables modifiables :** tasks, calendar_events, approval_requests, decisions, collaboration_comments, notifications, investigation_cases, alerts, incidents, products, activity_log.

**Les tables en lecture seule** répondent 404 aux écritures.

**Les clés étrangères sont appliquées.** Un lien cassé renvoie 422 ; le tableau de bord annule la modification à l'écran et explique pourquoi.

## Tests

```bash
# WSL, exercice4/backend — 15 tests sur une base séparée (mission_control_test)
php artisan test
php artisan mc:import --check      # 61 relations, et CA / incidents / alertes = valeurs Power BI
```
```powershell
# Windows : de bout en bout dans un Chrome invisible (connexion, KPI = Power BI, 33 modules, tâche créée → MySQL → rechargement, thème conservé, déconnexion)
node exercice4\tools\e2e.js
```

| Test | Résultat |
|---|---|
| Tests backend | 15 / 15 |
| De bout en bout (ordinateur) | 17 / 17 |
| Téléphone et tablette | 18 / 18 |
| Moteur français vs Power BI | 0 différence sur 43 groupes de résultats |

## Mise en ligne (Railway)

Le projet Railway s'appelle `mission-control` et contient deux services :

| Service | Ce qu'il exécute |
|---|---|
| `MySQL` | Le MySQL de Railway, avec un volume |
| `web` | Construit depuis `exercice4/Dockerfile` |

Construction et démarrage du service `web` :
- **Construction :** Node 22 construit l'application React, puis Laravel tourne sous PHP 8.5.
- **Démarrage** (`backend/docker/start.sh`) :
  1. met en cache la configuration et les routes ;
  2. exécute `migrate --force` ;
  3. exécute `mc:import --if-empty`, qui importe les CSV uniquement si la base est vide ou encore en anglais ; les modifications des utilisateurs sont conservées sinon ;
  4. exécute `mc:demo-user` ;
  5. démarre `php artisan serve` sur `$PORT`.
- **Variables**, définies sur le service et jamais dans le dépôt : `APP_KEY` (générée pour la production), `APP_ENV=production`, `APP_DEBUG=false`, `APP_LOCALE=fr`, `APP_URL`, `LOG_CHANNEL=stderr`, `CACHE_STORE=file`, et `DB_*` en références vers le service MySQL.

Redéployer depuis `exercice4/` (CLI Railway connectée) :
```powershell
railway up --service web --ci
```

## Organisation

| Chemin | Contenu |
|---|---|
| `backend/` | Laravel : `app/Support/MissionData.php` (métadonnées, flux, typage), `app/Http/Controllers/Api/*`, `app/Console/Commands/*` (import, compte de démo), migrations, `database/data/*.csv` et `translations_fr.json`, `lang/fr` |
| `backend/config/mission_control.php` | Tables, colonnes, types, clés et relations. **Généré** par `tools/gen-schema.js` depuis l'exercice3. |
| `frontend/src/mc/` | Le tableau de bord : le code du visuel de l'exercice3, adapté au web (`tools/webify.js`) et traduit (`tools/i18n/`) |
| `frontend/src/*.tsx` | Coquille React : page de connexion / inscription, hôte du tableau de bord, client API |
| `tools/` | `start.ps1`, `e2e.js`, `gen-schema.js`, `webify.js`, `i18n/` |

## Remarques

- **L'assistant IA fonctionne par règles.** Il comprend les questions en français et en anglais. Le champ de clé API n'affiche qu'une clé factice ; une vraie clé resterait dans `backend/.env`, jamais dans le navigateur.
- **Le jeton est stocké dans `localStorage`.** C'est suffisant pour cette application ; pour un déploiement public sérieux, passez à l'authentification SPA de Sanctum par cookie.
- **`backend/.env` contient le mot de passe MySQL et la clé de l'application.** Il est ignoré par git.
