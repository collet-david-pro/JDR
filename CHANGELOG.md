# Changelog

Toutes les évolutions notables de ce projet sont consignées ici.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet respecte le [versionnage sémantique](https://semver.org/lang/fr/).

## [0.1.0] - Unreleased

Phases 0 à 7 de la feuille de route.

### Added
- **Mode présentiel (phase 7)** : écrans de projection appairés par code ou QR sans compte (cookie dédié `jdr_display`), vue de table filtrée côté serveur, calibrage à la diagonale ou à la règle pour 25 mm par case, rotation et miroir, pilotage de la caméra et verrou de vue, pause et textes à lire, plusieurs écrans et réutilisation, Wake Lock avec repli vidéo, menu discret, révocation immédiate ; 8 critères vérifiés en E2E sur Chromium, Firefox et WebKit, voir `docs/irl.md`.
- **Séances de jeu en temps réel (phase 6)** : code de séance à saisir sur `/join`, lobby (joueurs, token affecté, barre de préchargement, « prêt ») et préchargement, console MJ (joueurs, affectations, tokens, révéler, ambiance, notes, maps), vue joueur (vision, déplacement bloqué par les murs, exploration du brouillard), pause, textes à lire à voix haute et expulsion ; temps réel SSE puis long polling puis polling avec bascule automatique, un seul flux par navigateur (Web Locks), rattrapage sans doublon après une coupure ; `fog_strict` et filtrage anti-fuite côté serveur (tokens cachés, objets MJ, portes secrètes, `fog.reveal` limité à la vision) ; 9 critères de phase vérifiés par des tests E2E sur Chromium, Firefox et WebKit (voir `docs/realtime.md`).
- **Murs, lumière, vision et brouillard (phase 5)** : murs, portes (ouvrables, verrouillées, secrètes) et fenêtres, lumières (rayons, couleur, vacillement, cônes) et tokens posés sur la map ; vision et éclairage arrêtés par les murs (calcul dans un worker, jointures étanches) ; ambiance (obscurité, teinte, cycle jour/nuit), ombres portées ; brouillard explorable enregistré sur le serveur, outil Révéler/masquer (pinceau, rectangle, pièce) ; vue « comme le joueur » ; panneaux Propriétés, Tokens et Ambiance ; conflits d'édition résolus objet par objet ; export PNG avec objets, tokens, éclairage et brouillard optionnels ; export/import JSON et versions incluant objets, tokens et brouillard.
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
