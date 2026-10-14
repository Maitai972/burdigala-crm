# CRM Burdigala Diagnostics

Centre de gestion pour diagnostiqueur immobilier : tableau de bord, devis, planning, comptabilité, prospection, clients et apporteurs. Application web installable (PWA), utilisable hors connexion, synchronisée entre ordinateur et téléphone via Supabase.

## Contenu

| Fichier | Rôle |
|---|---|
| `index.html` | Application complète (les modules Devis, Compta et Calendrier sont intégrés) |
| `prospection.html` | Module Prospection (agences et mandataires) |
| `supabase.js` | Librairie Supabase 2.117.2 en local (connexion et synchro) |
| `sw.js` | Service worker : fonctionnement hors connexion |
| `manifest.json`, `icon-*.png` | Installation sur téléphone / ordinateur |
| `.nojekyll` | Nécessaire pour GitHub Pages |
| `supabase/functions/search-agences/index.ts` | Fonction serveur de recherche d'agences (à déployer avec la CLI Supabase, pas sur GitHub Pages) |

## Mise en ligne avec GitHub Pages

1. Créer un dépôt sur GitHub et y déposer **tout le contenu de ce dossier** à la racine (glisser-déposer via « Add file › Upload files »).
2. Dans le dépôt : **Settings › Pages › Source : Deploy from a branch**, branche `main`, dossier `/ (root)`.
3. L'application est disponible à l'adresse `https://<votre-compte>.github.io/<nom-du-depot>/`.
4. Dans Supabase (**Authentication › URL Configuration**), ajouter cette adresse dans *Site URL* / *Redirect URLs*.

## Sécurité

- La clé Supabase présente dans le code est la clé publique (« publishable ») : elle est faite pour être visible. La protection des données repose sur les règles RLS de la table `burdigala_sync` (chaque compte ne lit que ses propres données).
- Aucune donnée client n'est stockée dans ces fichiers : les données restent dans le navigateur et dans Supabase.
- La clé Google Places n'est jamais dans le code : elle est stockée côté serveur (`supabase secrets set GOOGLE_PLACES_API_KEY=...`).
- Inscription désactivée dans l'application (`ALLOW_SIGNUP=false` dans `index.html`) : penser à la désactiver aussi dans Supabase (Authentication › Sign In / Providers).

## Mise à jour

Remplacer les fichiers modifiés dans le dépôt. Le service worker (`sw.js`) récupère automatiquement la nouvelle version au prochain chargement en ligne.
