# Murs, portes et fenêtres

Les murs bloquent la vue, la lumière et les déplacements. Ils décident de ce que les joueurs voient.

- **Mur** (W) : clic pour poser un point, **double-clic** ou **Entrée** pour finir, **Échap** pour annuler. L'option **Pièce** trace un rectangle fermé. Types : pierre, brique, bois, métal, naturel, invisible. **Alt** désactive l'aimantation. Le **pas d'aimantation** (1, 1/2, 1/4 ou 1/8 de case) se règle par map dans le panneau Ambiance et dans les options des outils ; des repères de grille fine apparaissent pendant le tracé.
- **Porte / fenêtre** (D) : cliquez sur un mur, il est découpé autour de l'ouverture. Une porte peut être **ouverte**, **verrouillée** ou **secrète** (elle ressemble alors à un mur pour les joueurs). Fenêtres : vitrée, barreaux ou ouverture.
- Panneau **Propriétés** : épaisseur, ce que l'objet bloque (vision, lumière, déplacement), sens d'ouverture des portes, visibilité (tous, MJ seulement, caché jusqu'à révélation).
- **Texture de mur** : dans les options de l'outil Mur (pour les prochains murs) ou dans le panneau **Propriétés** d'un mur, bouton **Choisir** pour prendre une image de la bibliothèque (de préférence de type texture). Le motif se répète le long du mur, sur toute son épaisseur ; **Retirer** revient à la couleur du type de mur. Un mur invisible reste en pointillés.
- **Image de porte** : dans les Propriétés d'une porte, choisissez une image pour la porte **fermée** et une pour la porte **ouverte**. Sans image, la porte garde son dessin habituel. Une porte secrète reste un simple mur pour les joueurs.
- Les textures et images de porte s'affichent aussi en séance (MJ, joueurs, écrans) et dans l'export PNG ; elles voyagent avec la map dans l'export ZIP et empêchent la suppression de l'image tant qu'elles sont utilisées. Annuler et Rétablir fonctionnent comme pour les autres propriétés.
- Pendant la séance, un clic du MJ sur une porte l'ouvre ou la ferme.

Le **Mode performance** (menu **Affichage**) allège les calculs de vision sur les très grandes maps.

**Aimantation au déplacement** : avec l'outil Sélection, glisser des objets les aimante aux extrémités et milieux de murs et de portes, et aux coins et centres des autres objets proches ; un repère marque le point aimanté. **Alt** désactive l'aimantation.
