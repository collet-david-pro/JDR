# Changelog

Toutes les évolutions notables de ce projet sont consignées ici.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet respecte le [versionnage sémantique](https://semver.org/lang/fr/).

## [Non publié]

## [0.3.4] - 2026-11-05

### Added
- **Pack de tokens de base** : 40 tokens générés (héros, monstres, PNJ, animaux), rangés dans les catégories générales Héros, Monstres, PNJ et Animaux, créées si besoin.
- **Installation automatique du pack de base** (tuiles et tokens) à la fin de l'installation et après une mise à jour qui le modifie ; les éléments en échec sont retentés environ toutes les heures.
- **Réparer le pack de base** (**Administration > Intégrité**) : bouton « Installer / réparer le pack de base ».

### Changed
- **Maps générées** : test de bout en bout ajouté pour la corbeille, la restauration et la suppression définitive.

## [0.3.3] - 2026-11-04

### Added
- **Installer la dernière version en un clic** (**Administration > Mise à jour**) : quand une version plus récente est publiée, le bouton « Installer la version X » la télécharge depuis GitHub, vérifie son empreinte et sa signature, puis enchaîne sur le parcours habituel (résumé, sauvegarde proposée, mise à jour). Il fonctionne même si la mise à jour automatique est désactivée ou qu'une séance a été lancée récemment.
- **État de la mise à jour automatique** dans le même onglet : activée ou non, dernière vérification et prochaine au plus tôt, rythme réel, et raison du blocage s'il y en a une.

### Fixed
- **Envoi d'une archive de mise à jour ou d'une sauvegarde** : un serveur qui limite la taille des envois (erreur 413, par exemple 1 Mo par défaut sur YunoHost) ne bloque plus l'envoi : les morceaux sont automatiquement réduits.

## [0.3.2] - 2026-11-04

### Fixed
- **Mode maintenance** : un administrateur qui activait ce mode restait bloqué sur la page de maintenance. Il se connecte maintenant depuis cette page et utilise le site normalement, avec un bandeau qui rappelle que la maintenance est active. Les autres utilisateurs voient toujours la page de maintenance.
- **Liste des maps d'une partie** : tous les boutons d'action (modifier, dupliquer, enregistrer comme modèle, corbeille) restent visibles, même sur un écran étroit ; les libellés longs passent à la ligne au lieu d'être coupés.

## [0.3.0] - 2026-11-04

Phase 10 « Durcissement » terminée : sauvegarde, intégrité, releases signées, revue de sécurité, accessibilité, performances.

### Added
- **Sauvegarde et restauration** (**Administration > Sauvegarde**) : sauvegarde de la base (`.sql.gz`) et des assets (`.zip`) à part, téléchargées puis supprimées du serveur (aucune copie gardée). Restauration uniquement depuis un fichier envoyé, avec double confirmation (case à cocher et mot à taper), site en maintenance pendant l'opération. Voir `docs/sauvegarde.md`.
- **Vérification d'intégrité** (**Administration > Intégrité**) : quotas, tailles, fichiers manquants ou orphelins, références de maps, blocs et brouillards illisibles, révisions. Une correction par type de problème ; toute suppression demande une confirmation. Voir `docs/diagnostic.md`.
- **Mise à jour plus sûre** : la sauvegarde de la base faite avant une mise à jour peut être téléchargée (supprimée ensuite ; 7 jours au plus après une mise à jour automatique). Un administrateur est redirigé vers `update.php` si la base est en retard. Les releases sont **signées** (Ed25519, fichier `SHA256SUMS.sig`) et la signature est vérifiée avant toute mise à jour automatique.
- **Limite de connexions en direct** : réglage `realtime_max_waiting` (4 par défaut). Au-delà, les appareils passent à l'interrogation toutes les 2 s. Affichée dans le diagnostic.
- Documentation d'exploitation : `docs/prerequis.md`, `docs/mise-a-jour.md`, `docs/sauvegarde.md`, `docs/diagnostic.md`, `docs/securite.md`, `docs/accessibilite.md`.

### Changed
- **L'extension PHP `sodium` est désormais nécessaire à la mise à jour automatique** (vérification de la signature). Elle reste facultative à l'installation : sans elle, le site fonctionne et la mise à jour manuelle reste possible.
- Pages, scripts et styles compressés par le serveur, fichiers à empreinte mis en cache : le site se charge plus vite, surtout sur téléphone.
- Lectures de la base mémorisées pendant une requête : moins de requêtes SQL par action.

### Fixed
- Accessibilité (WCAG 2.2 AA) : étiquettes manquantes et contrastes corrigés sur les pages d'installation et de cartes, parcours au clavier vérifié, toutes les pages hors éditeur auditées.

### Security
- **Revue OWASP Top 10** (voir `docs/securite.md`) : aucune faille critique.
- « Mot de passe oublié » : l'e-mail est envoyé après la réponse, pour qu'on ne puisse pas deviner si une adresse a un compte d'après le temps de réponse.
- Connexion avec un identifiant inconnu : le temps de réponse est aligné sur celui d'un compte existant.
- Les journaux applicatifs sont désormais supprimés après 14 jours.
- Chaque route de l'API est vérifiée par un test de couverture (droits d'accès).
- Restauration : le fichier SQL n'est jamais exécuté tel quel (liste blanche de commandes) ; les archives ZIP refusent chemins dangereux.

## [0.2.0] - 2026-11-03

La numérotation passe aux versions et sous-versions : plus de numéro d'alpha.

### Added
- **Mise à jour automatique** : une fois installé, le site se met à jour seul depuis les releases GitHub, en arrière-plan. L'archive n'est installée que si son empreinte correspond au `SHA256SUMS` de la release ; sauvegarde et retour arrière restent ceux de la mise à jour manuelle. Rien ne démarre pendant une séance lancée depuis moins de 12 h. Une migration en échec est restaurée et n'est pas retentée pour cette version ; les autres échecs sont retentés 3 fois, à 1 h d'intervalle. Activée par défaut, désactivable dans **Administration > Mise à jour**.
- Des fichiers envoyés par FTP se terminent aussi tout seuls : les migrations s'appliquent à la visite suivante, sans ouvrir `update.php`.

## [0.1.0-alpha.2] - 2026-11-02

Phase 9 « MJ en séance » terminée.

### Added
- **Étages et liens entre maps (phase 9)** : jusqu'à 10 étages par map, créés, renommés, réordonnés et supprimés depuis l'éditeur (actions annulables, enregistrées hors ligne), étage du dessous affiché en transparence ; escaliers, portails et portes menant à un autre étage ou à une autre map ; en séance, panneau « Passages » et action « Emprunter » du MJ, avec déplacement des tokens choisis. Joueurs et écrans ne reçoivent que l'étage courant, jamais la destination d'un lien. Migration `0005`.
- **Notes, épingles, zones, secrets et pièges (phase 9)** : notes réservées au MJ et partageables à un, plusieurs ou tous les joueurs, en direct, avec éditeur Markdown sûr (aucun HTML interprété) ; épingles, zones à lire, pièges et secrets dans l'éditeur ; en séance, lecture à voix haute, suggestion au MJ quand un token entre dans une zone, révélation des pièges et des secrets. Un passage secret bloque comme un mur tant qu'il n'est pas révélé ; il ne perce pas un mur existant : laissez une ouverture à cet endroit. Migration `0006`.
- **Modèles de map (phase 9)** : enregistrer une map comme modèle (personnel, ou pour tout le site par un administrateur) et créer une map depuis un modèle, sans tokens, sans brouillard, notes remises au MJ seul, pièges et secrets remis à non révélés. Quatre modèles livrés : taverne, crypte, forêt, grotte.
- **Palette de commandes (phase 9)** : Cmd/Ctrl+K dans l'éditeur et la console du MJ, avec recherche floue et raccourcis affichés ; les actions destructives passent par une confirmation.

### Changed
- Le statut d'enregistrement de l'éditeur a une largeur fixe : un statut plus long ne décale plus la carte sous le pointeur. À 1280 px de large, la barre du haut occupe une rangée de plus.

### Fixed
- Écran de projection : un réglage reçu pendant une relecture de `/display/me` n'est plus écrasé par l'ancienne valeur.

### Security
- Un membre retiré d'une partie est exclu de ses séances ouvertes (instantané et flux temps réel). S'il est réinscrit, il reste exclu de ces séances jusqu'à leur fin.

## [0.1.0-alpha.1] - 2026-10-28

Première version publiée (alpha) : phases 0 à 8 de la feuille de route et module de mise à jour.

### Added
- **Mise à jour depuis l'administration** : onglet « Mise à jour » qui vérifie les releases GitHub (canal stable ou pré-versions, empreintes `SHA256SUMS`), envoi par morceaux du zip de mise à jour téléchargé par l'administrateur, contrôle complet de l'archive (chemins, manifeste, empreintes, version, authenticité), puis `update.php` étape par étape : maintenance, sauvegarde SQL de la base, sauvegarde des fichiers remplacés, copie atomique, contrôle d'intégrité, migrations une par requête ; retour arrière automatique si la copie échoue, « Réessayer » ou « Restaurer » si une migration échoue ; reprise d'une mise à jour par FTP. Voir `docs/installation.md`.
- **Génération procédurale (phase 8)** : générateurs déterministes de donjons (partition binaire, couloirs, boucles, portes et portes secrètes, salles typées), grottes (automate cellulaire, parois lissées), extérieurs (biomes, rivières, routes, ponts et gués) et villages (bâtiments rectangulaires ou en L, pièces, portes, fenêtres, mobilier, éléments urbains) ; décor posé par règles déclaratives sans jamais bloquer une porte ; génération dans une nouvelle map, la map actuelle (instantané `pre_generate`) ou une sélection (donjon, grotte) ; panneau Générer (`Maj+G`) avec préréglages, graine, aperçu, progression et annulation dans un worker, application en une seule commande ; réglages mémorisés avec la map ; textures raccordables enregistrables dans la bibliothèque (`source = generated`) ; pack de base de 39 images installé automatiquement (`GET /api/v1/procgen/pack`) ; empreintes de référence identiques dans Chromium, Firefox et WebKit, voir `docs/procgen.md`.
- **Mode présentiel (phase 7)** : écrans de projection appairés par code ou QR sans compte (cookie dédié `jdr_display`), vue de table filtrée côté serveur, calibrage à la diagonale ou à la règle pour 25 mm par case, rotation et miroir, pilotage de la caméra et verrou de vue, pause et textes à lire, plusieurs écrans, révoqués automatiquement en fin de séance, Wake Lock avec repli vidéo, menu discret, révocation immédiate ; 8 critères vérifiés en E2E sur Chromium, Firefox et WebKit, voir `docs/irl.md`.
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

[0.3.3]: https://github.com/collet-david-pro/JDR/releases/tag/v0.3.3
[0.3.2]: https://github.com/collet-david-pro/JDR/releases/tag/v0.3.2
[0.3.0]: https://github.com/collet-david-pro/JDR/releases/tag/v0.3.0
[0.2.0]: https://github.com/collet-david-pro/JDR/releases/tag/v0.2.0
[0.1.0-alpha.2]: https://github.com/collet-david-pro/JDR/releases/tag/v0.1.0-alpha.2
[0.1.0-alpha.1]: https://github.com/collet-david-pro/JDR/releases/tag/v0.1.0-alpha.1
