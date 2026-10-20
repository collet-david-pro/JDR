# Changelog

Toutes les évolutions notables de ce projet sont consignées ici.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet respecte le [versionnage sémantique](https://semver.org/lang/fr/).

## [0.1.0] - Unreleased

Fondations (phase 0).

### Added
- Contrôleur frontal unique `index.php`, routeur en deux modes (`rewrite` et `query`), réponses JSON normalisées, journalisation, en-têtes de sécurité.
- Point d'API `GET /api/v1/health` et `GET /api/v1/version`.
- Accès à la base (`Db`) et moteur de migrations (empreintes SHA-256, rejouables), migration `0001_initial`.
- Protection des dossiers privés (`app/`, `migrations/`, `storage/`, `i18n/`, `config.php`).
- Front-end Svelte 5 + TypeScript + Vite : shell de l'application, routeur, thèmes clair/sombre.
- Script de livraison `dev/release.mjs` : `manifest.json` (SHA-256 des fichiers livrés), archives complète et de mise à jour.
- Intégration continue GitHub Actions (lint PHP, PHPUnit sur PHP 8.1/8.3 × MariaDB 10.3/MySQL 8.0, front, migrations figées).
- Environnement de développement : serveur PHP local, Docker Compose (Apache + MariaDB + Mailpit), documentation Nginx.

[0.1.0]: https://github.com/collet-david-pro/JDR/releases/tag/v0.1.0
