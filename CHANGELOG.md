# Changelog

Toutes les évolutions notables de ce projet sont consignées ici.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet respecte le [versionnage sémantique](https://semver.org/lang/fr/).

## [0.1.0] - Unreleased

Phases 0 à 4 de la feuille de route.

### Added
- **Éditeur de maps (phase 4)** : moteur de rendu PixiJS (WebGPU, repli WebGL2) avec tuiles par blocs, caméra, thèmes de grille et calques ; outils pinceau, gomme, remplissage, formes, sélection, pipette, règle ; annuler/rétablir ; raccourcis clavier et trackpad ; API des maps (opérations transactionnelles, blocs binaires, idempotence) ; enregistrement automatique avec file d'opérations hors ligne (IndexedDB) ; onglet Maps (dossiers, duplication, corbeille) ; historique de versions restaurable ; export/import JSON et ZIP ; miniatures ; export PNG en flux (haute résolution, mode impression, annulation).
- **Parties (phase 3)** : parties (archivage, corbeille), membres et co-MJ, définitions de tokens (vision, lumière), rencontres préparées, cloisonnement strict des données entre parties.
- **Bibliothèque d'images (phase 2)** : import sécurisé (type réel, dimensions, animations GIF/WebP, fichiers piégés refusés, ré-encodage, miniatures), quotas atomiques, déduplication, liens de fichiers signés, catégories, tags, favoris, bibliothèque générale, packs ZIP, tâches de fond par tranches.
- **Comptes et administration (phase 1)** : installeur web en 6 étapes avec reprise, inscription (ouverte, fermée, sur invitation), connexion et « se souvenir de moi », CSRF, limitation de débit, réinitialisation de mot de passe (SMTP optionnel), profil et données personnelles, console d'administration (comptes, invitations, réglages, diagnostic, audit, migrations), tâches de maintenance (cron réel ou pseudo-cron).
- Tests de bout en bout Playwright (Chromium, Firefox, WebKit).
- Contrôleur frontal unique `index.php`, routeur en deux modes (`rewrite` et `query`), réponses JSON normalisées, journalisation, en-têtes de sécurité.
- Point d'API `GET /api/v1/health` et `GET /api/v1/version`.
- Accès à la base (`Db`) et moteur de migrations (empreintes SHA-256, rejouables), migration `0001_initial`.
- Protection des dossiers privés (`app/`, `migrations/`, `storage/`, `i18n/`, `config.php`).
- Front-end Svelte 5 + TypeScript + Vite : shell de l'application, routeur, thèmes clair/sombre.
- Script de livraison `dev/release.mjs` : `manifest.json` (SHA-256 des fichiers livrés), archives complète et de mise à jour.
- Intégration continue GitHub Actions (lint PHP, PHPUnit sur PHP 8.1/8.3 × MariaDB 10.3/MySQL 8.0, front, migrations figées).
- Environnement de développement : serveur PHP local, Docker Compose (Apache + MariaDB + Mailpit), documentation Nginx.

[0.1.0]: https://github.com/collet-david-pro/JDR/releases/tag/v0.1.0
