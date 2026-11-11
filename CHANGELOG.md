# Changelog

Toutes les évolutions notables de ce projet sont consignées ici.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet respecte le [versionnage sémantique](https://semver.org/lang/fr/).

## [Non publié]

### Added
- **Très grandes battlemaps** : une image de fond de plus de 4096 px est découpée en morceaux par le navigateur, envoyée morceau par morceau et assemblée sur la map ; le serveur ne traite jamais plus d'un morceau à la fois (mémoire d'un hébergement mutualisé). Le dialogue « Image de fond » recale et redimensionne l'ensemble comme une seule image.
- **Textures de murs et images de porte** : choix dans la bibliothèque (propriétés d'un mur ou d'une porte, options de l'outil Mur) ; la texture est répétée le long du mur, l'image posée sur la porte (ouverte ou fermée). Affichées dans l'éditeur, en séance et à l'export PNG ; prises en charge par l'export et l'import ZIP, l'annulation et l'historique des versions.
- **Visites guidées** : la première fois qu'on ouvre le tableau de bord, une partie, l'éditeur, la console du MJ, la vue du joueur ou l'administration, une courte visite présente l'écran pas à pas, en mettant en lumière chaque zone. Une visite passée ou terminée ne revient plus (le choix suit le compte sur tous ses appareils) ; le profil permet de les revoir. Nouvelle page d'aide « Visites guidées ».

### Changed
- **Nouvelle disposition de l'éditeur** : la barre du haut tient sur une ligne. Les réglages de vue (vue MJ ou joueur, éclairage, brouillard, ombres, exploration, étage du dessous, grille et son thème, mode performance, réinitialisation du brouillard) sont regroupés dans un menu **Affichage**. Les outils sont rangés par usage (Naviguer, Terrain, Structure, Placer, Notes et secrets, Table), ce qui laisse voir les options de l'outil. Les panneaux de droite passent en onglets (Propriétés, Palette, Calques, Tokens, Notes, Ambiance, plus Historique et Générer quand ils sont ouverts), qui suivent l'outil choisi et la sélection. Le zoom est dans la barre d'état. Aide et captures mises à jour.
- **Salle d'attente** : le préchargement télécharge aussi les images posées sur la map, les textures de murs et les images de porte, limitées à ce que le joueur ou l'écran de table a le droit de voir.

### Fixed
- **Import d'une map en ZIP** : les images de la palette gardent leur type (tuile ou texture) et leur catégorie ; les textures n'étaient plus rangées comme tuiles.
- **Palette** : le serveur refuse désormais d'ajouter à la palette une image qui n'est ni une tuile ni une texture.

## [0.7.1] - 2026-11-11

### Fixed
- **Générer dans la map actuelle** : sur une map trop petite (ou trop grande) pour le générateur, par exemple un village sur une map de 30 × 20 cases, « Appliquer » échouait avec une erreur inattendue alors que l'aperçu semblait correct. L'aperçu l'indique désormais et « Appliquer » reste désactivé.
- **Villages** (nouvelle version du générateur) : les côtés verticaux des clôtures rurales sont tournés (ils ressemblaient à des barreaux) ; les bougies murales sont posées dans la pièce, à l'écart des portes et des fenêtres, au lieu d'éclairer la rue à travers le mur. À graine égale, un nouveau village diffère de l'ancien ; les maps déjà générées ne changent pas.

## [0.7.0] - 2026-11-09

### Added
- **Tokens des joueurs** : chaque joueur crée ses tokens dans son profil (forme, fond, anneau, emblème parmi 33 ou portrait cadré à la souris, au doigt ou au clavier), en garde jusqu'à 100 et choisit lequel il utilise dans chaque partie (en rejoignant une séance, ou depuis la page de la partie hors séance). Son token remplace l'image du MJ sur son pion ; « Imposer mon image » sur la fiche du token rend la main au MJ.
- **Changer la taille d'une map** : « Taille de la map… » (outil Image ou Ctrl+K), de 1 à 400 cases, avec un point d'ancrage parmi neuf ; tout le contenu des étages suit (tuiles, murs, objets, images, tokens, lumières, brouillard, notes, arrivées des liens). Si la map rétrécit, la fenêtre compte ce qui sera perdu et demande confirmation ; une version « Avant redimensionnement » est enregistrée juste avant, et Ctrl+Z (⌘Z) annule le redimensionnement juste après (Ctrl+Y le refait).
- **Pas d'aimantation par map** pour les murs, portes et fenêtres : 1, 1/2, 1/4 ou 1/8 de case, avec des repères de grille fine pendant le tracé.
- **Météo animée** : pluie, orage, neige et brume s'animent à l'identique chez le MJ, les joueurs et les écrans ; simple voile fixe en mouvement réduit ou en mode performance.
- **Rechargement automatique après une mise à jour du site** : un écran de projection ou une vue de séance ouverts avant la mise à jour se rechargent d'eux-mêmes dès qu'elle est terminée (pas pendant une saisie) ; ailleurs, un bandeau propose de recharger.

### Changed
- **Accueil** : les séances à reprendre se chargent en une seule requête.

### Fixed
- **Token d'une séance en cours** : « Imposer mon image » et toute modification d'un token posé sur la map jouée s'affichent aussitôt chez le MJ, les joueurs et les écrans (plus besoin de recharger).
- **Mise à jour automatique** : un échec n'est plus affiché une fois le site passé à cette version par une autre voie.

## [0.6.0] - 2026-11-08

### Added
- **Fond à la taille de map voulue** : mode « Taille de la map » dans « Image de fond… » et « Nouvelle map depuis une image » ; on donne la largeur ou la hauteur en cases, l'autre suit les proportions de l'image, et la map est redimensionnée d'un coup (même plus du double), avec un avertissement si elle rétrécit.
- **Images animées sur la map** : les GIF et WebP animés posés avec l'outil Image s'animent dans l'éditeur, la vue joueur et les écrans (fixes si le navigateur réduit les animations ou en mode performance ; première image à l'export PNG).
- **Colonnes de l'éditeur réglables** : poignée entre les colonnes latérales et la map, à la souris ou au clavier, double-clic pour revenir au défaut ; largeur retenue par le navigateur.

### Changed
- **Le site s'appelle Clairvoie** partout (installeur, mise à jour, pages, e-mails, documentation). Un site qui avait gardé le nom par défaut « JDR » est renommé à la mise à jour ; un nom choisi par l'administrateur est conservé.

## [0.5.0] - 2026-11-07

### Added
- **Fond de map** : une battlemap toute faite s'importe en fond (« Image de fond… » dans l'éditeur), recalée sur la grille (taille d'une case dans l'image, décalage, ajuster à la map, redimensionner la map à l'image) ; un fond par étage. Il ne reste qu'à poser murs, portes et lumières.
- **Nouvelle map depuis une image** (onglet Maps) : la taille de la map se calcule à partir de l'image et de la taille d'une case ; l'image est posée en fond.
- **Outil Image** (J) : pose librement les images de la bibliothèque (objets, fonds, tokens, textures) ; déplacer, redimensionner, tourner, miroir, opacité, sous ou sur les tuiles. Une image posée sur le calque MJ n'est jamais envoyée aux joueurs ni aux écrans.
- **Textures dans la palette** : les textures de la bibliothèque peignent un sol continu, alignées sur la map (« Cases couvertes » réglable), au lieu de répéter le même motif à chaque case.

### Fixed
- **Import d'une map par l'interface** : les fichiers contenant des escaliers, portails, épingles, zones, pièges, secrets, notes ou images ne sont plus refusés (le serveur les valide).

## [0.4.0] - 2026-11-07

### Added
- **Signaler un bug ou proposer une idée** : liens dans le pied de page et l'aide vers des formulaires GitHub préremplis (version, navigateur, page). Le dépôt cible se règle dans **Administration > Réglages** ; laissé vide, les liens disparaissent.
- **Tutoriel pas à pas** (`docs/TUTORIEL.md`) : de l'installation à la première séance.
- **Documentation du code** : `AGENTS.md`, guides contributeurs (`docs/dev/`), README par module et commentaires sur les déclarations publiques PHP et TypeScript.
- **Intégration continue GitHub** : PHPUnit (PHP 8.1 et 8.3, MySQL 8.0 et MariaDB 10.3), front, migrations figées et tests de bout en bout sur Chromium, Firefox et WebKit.

### Changed
- **README** : présentation complète de l'application, fonctionnalités par usage, captures d'écran et FAQ ; le contenu technique est déplacé dans `docs/` (fonctionnalités, sécurité, installation, architecture).

## [0.3.6] - 2026-11-05

### Added
- **Aide intégrée** (`/aide`, accessible sans compte, lien « Aide » dans l'en-tête et le pied de page) : toutes les fonctionnalités expliquées par public (joueur, MJ, écran IRL, administrateur), recherche, raccourcis clavier, captures d'écran. Un lien « ? » dans chaque écran principal ouvre la section qui le concerne.

### Fixed
- **Réglages d'un écran IRL** (console du MJ) : une modification pas encore enregistrée (par exemple masquer les tokens) n'est plus annulée quand la liste des écrans se recharge.

## [0.3.5] - 2026-11-05

### Changed
- **Tests de bout en bout sur les trois navigateurs** (Chromium, Firefox, WebKit) : toute la suite passe. Aucun défaut du site trouvé ; le parcours au clavier utilise Option+Tab sous WebKit, comme Safari.

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
