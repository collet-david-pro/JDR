# Fonctionnalités en détail

Le détail complet, phase par phase, est dans le [CHANGELOG](../CHANGELOG.md). Les écrans sont présentés dans l'aide intégrée (`/aide`) et dans le [tutoriel](TUTORIEL.md).

### Éditeur de maps

- Grille carrée, calques, tuiles par blocs, pinceau, gomme, remplissage, formes, sélection, pipette, règle, annuler et rétablir.
- Jusqu'à 10 étages par map, avec l'étage du dessous affiché en transparence ; escaliers, portails et portes menant à un autre étage ou à une autre map.
- Enregistrement automatique avec file d'attente hors ligne (IndexedDB) : une coupure réseau ou un onglet fermé brutalement ne fait pas perdre les modifications.
- Notes en Markdown sûr, épingles, zones à lire, pièges et secrets ; modèles de map, dont 4 livrés (taverne, crypte, forêt, grotte).
- Palette de commandes (Cmd/Ctrl+K), aussi dans la console du MJ.
- Historique de versions restaurable, export et import JSON ou ZIP (images incluses), onglet Maps avec dossiers, duplication et corbeille.
- Images sur la map : battlemap en fond (recalage sur la grille, nouvelle map depuis une image) et images libres de la bibliothèque (déplacement, redimension, rotation, opacité, miroir), calque MJ jamais montré aux joueurs.
- Export PNG en flux : haute résolution, fond transparent, mode impression (A4, A3, Letter).
- Rendu WebGPU, avec repli WebGL2.

### Murs, lumière, vision et brouillard

- Murs en polyligne ou par pièce, avec aimantation. Portes (ouvrables, verrouillées, secrètes) et fenêtres.
- Lumières préréglées (torche, lanterne, bougie, feu de camp, lumière magique) : couleur, vacillement, cônes.
- Lumière et vision arrêtées par les murs, calculées dans un Web Worker. Ambiance (obscurité, teinte, cycle jour et nuit) et ombres portées.
- Brouillard de guerre explorable, enregistré sur le serveur. Outil Révéler/masquer. Vue « comme le joueur ».

### Génération procédurale

- Quatre générateurs déterministes : donjons, grottes, extérieurs (biomes, rivières, routes, ponts et gués) et villages.
- Une graine reproductible : la même graine redonne la même map. Préréglages, aperçu, progression et annulation.
- Génération dans une nouvelle map, dans la map actuelle ou dans une sélection (donjon, grotte). Une seule commande « annuler » défait tout.
- Textures raccordables, à enregistrer dans la bibliothèque. Pack de base d'images installé dans la bibliothèque générale à la fin de l'installation (par tranches) et après une mise à jour qui le change ; réparable depuis Administration > Intégrité.
- Détails : [procgen.md](procgen.md).

### Séances en ligne

- Le MJ lance une séance. Les joueurs la rejoignent avec un code sur `/join`.
- Lobby avec préchargement, console du MJ (joueurs, affectations, tokens, révélations, ambiance, notes, maps), vue joueur.
- Pause, textes à lire à voix haute, expulsion d'un joueur.
- Le MJ fait voyager la table d'un clic : il emprunte un escalier ou un portail, et joueurs et écrans suivent sur le bon étage ou la bonne map, avec les tokens qu'il choisit de déplacer. Les joueurs ne voient jamais la destination d'un lien.
- Temps réel sans WebSocket : flux SSE, puis long polling, puis polling court, avec bascule automatique selon l'hébergement.
- Brouillard strict (`fog_strict`, actif par défaut) : le serveur filtre ce que chaque joueur reçoit. Les tokens cachés et les objets réservés au MJ ne lui sont jamais envoyés.
- Détails : [realtime.md](realtime.md).

### Mode présentiel

- Des écrans de projection se branchent à la séance avec un code à 6 chiffres ou un QR code. Aucun compte à créer.
- L'écran ne montre que la vue de table, calculée par le serveur.
- Échelle réelle (25 mm par case par défaut), calibrée à la diagonale ou à la règle. Rotation, miroir, pilotage de la caméra, verrou de vue.
- Jusqu'à 8 écrans par séance. Révocation immédiate.
- Détails : [irl.md](irl.md).

### Bibliothèque d'images

- Import par glisser-déposer (PNG, JPEG, WebP, GIF, WebP animés).
- Contrôle strict des fichiers : type réel, dimensions, fichiers piégés refusés, ré-encodage, miniatures.
- Quotas, déduplication, catégories, tags, favoris, bibliothèque générale, packs ZIP.

### Parties, membres, tokens et rencontres

- Parties : création, archivage, corbeille. Membres et co-MJ.
- Définitions de tokens avec image, taille, vision et lumière. Rencontres préparées à l'avance.
- Cloisonnement strict des données entre les parties.

### Administration, sécurité et mise à jour

- Installeur web en 6 étapes, qui reprend là où il s'est arrêté.
- Comptes : inscription ouverte, fermée ou sur invitation ; connexion, « se souvenir de moi », réinitialisation de mot de passe (SMTP optionnel), export et suppression des données personnelles.
- Console d'administration : comptes, quotas, invitations, réglages, e-mail de test, diagnostic, intégrité, sauvegarde et restauration, journal d'audit, migrations, mise à jour.
- Interface en français, thème clair, sombre ou automatique, trois styles (moderne, fantasy, science-fiction).

### Aide intégrée

Une page d'aide publique (`/aide`, lien « Aide » dans l'en-tête et le pied de page) décrit toutes les fonctionnalités par public : joueur, MJ, écran IRL et administrateur. Elle a une recherche, les raccourcis clavier, des captures d'écran et des liens « ? » dans les écrans clés. Les textes sont des fichiers Markdown dans `frontend/src/help/`.

