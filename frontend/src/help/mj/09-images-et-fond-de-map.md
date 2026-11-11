# Images et fond de map

Une battlemap toute faite (une image) peut servir de fond : il ne reste qu'à poser les murs, portes, lumières et tokens. Les images de la bibliothèque (objets, fonds, tokens, textures) peuvent aussi être posées librement sur la map.

## Image de fond

1. Dans l'éditeur, outil **Image** (touche **J**), bouton **Image de fond…** (ou la [palette de commandes](#mj-palette-de-commandes)).
2. **Choisir une image** dans la bibliothèque, ou **Envoyer une image** (rangée comme _fond_).
3. **Recalage sur la grille**, au choix :
   - la **taille d'une case dans l'image** (en pixels) ou le **nombre de cases en largeur**, puis le **décalage X / Y** en cases ;
   - la **taille de la map (en cases)** : choisissez le côté donné (**largeur** ou **hauteur**) et son nombre de cases. L'autre côté suit les proportions de l'image, arrondi à la case la plus proche ; l'image couvre toute la map sans être déformée, centrée (quand l'arrondi laisse un écart, elle dépasse d'au plus une demi-case, répartie sur les deux bords).

   L'aperçu montre l'image sous la grille de la map, ou de la map à sa future taille.

4. **Ajuster à la map** fait tenir toute l'image dans la map ; **Redimensionner la map à l'image** change la taille de la map pour qu'elle contienne l'image (l'éditeur se recharge). En mode _taille de la map_, **Appliquer et redimensionner la map** fait les deux d'un coup. Si la map rétrécit, les tuiles, objets et tokens hors de la nouvelle taille sont supprimés (un avertissement le rappelle).
5. **Appliquer**. Le fond est dessiné sous les tuiles et **verrouillé** : il ne bouge pas par mégarde. Chaque étage peut avoir son propre fond.

Pour le recaler plus tard, sélectionnez-le et utilisez **Recaler le fond…** dans le panneau Propriétés.

### Très grandes battlemaps

Une image de fond plus grande que la limite du site (4096 px de côté par défaut) n'est pas réduite : votre navigateur la **découpe en morceaux** (avec un pixel de recouvrement pour éviter toute couture), envoie chaque morceau comme une image de la bibliothèque (rangée comme _fond_) et les pose côte à côte sur la map. Le serveur ne décode jamais plus d'un morceau à la fois, ce qui convient aux hébergements mutualisés. Ça marche aussi pour **Nouvelle map depuis une image**.

- Le recalage, l'aperçu, **Ajuster à la map** et **Redimensionner la map à l'image** s'appliquent à l'image entière ; **Recaler le fond…** déplace tous les morceaux ensemble.
- L'éditeur, la vue des joueurs, les écrans, l'export PNG et la miniature affichent l'image assemblée, sans différence.
- Le navigateur doit pouvoir décoder l'image entière : au-delà d'environ 100 millions de pixels (10 000 × 10 000), l'envoi est refusé. Sur un appareil peu puissant, préférez un ordinateur.
- Les images animées ne sont pas découpées. Les images posées librement (pas en fond) sont toujours réduites si elles dépassent la limite.
- Pour remplacer ou supprimer un fond en morceaux, passez par **Image de fond…** (remplacer) ; les anciens morceaux sont retirés de la map, mais restent dans la bibliothèque.

## Changer la taille d'une map

**Taille de la map…** (bouton de l'outil Image, ou palette de commandes **Ctrl+K**) change la largeur et la hauteur en cases (de 1 à 400). Choisissez un **point d'ancrage** parmi les neuf positions : haut gauche par défaut, le côté choisi garde sa place. Avec un autre ancrage (le centre, par exemple), tout le contenu des étages suit : tuiles, murs, portes, objets, images, tokens placés, lumières, brouillard révélé, notes épinglées et points d'arrivée des liens venant d'autres maps.

Si la map rétrécit, la fenêtre compte ce qui sortira de la map (étages chargés) et demande confirmation. Un objet (mur, porte, lumière, passage…) qui dépasse de la nouvelle map est **supprimé en entier**, un token placé hors de la map aussi, une image reste tant qu'une partie la recouvre. Une version nommée « Avant redimensionnement » est enregistrée juste avant : **Ctrl+Z** (⌘Z sur Mac) la restaure aussitôt après le rechargement (**Ctrl+Y** refait le redimensionnement) ; plus tard, restaurez-la depuis l'**Historique**.

## Nouvelle map depuis une image

Dans l'onglet Maps, **Nouvelle map**, partie **Depuis une image** : choisissez ou envoyez l'image et indiquez la **taille d'une case dans l'image** (70 px par défaut) ou la **taille de la map** (largeur ou hauteur en cases, l'autre côté suit les proportions de l'image). La taille de la map et des cases est calculée, l'image est posée en fond et l'éditeur s'ouvre.

## Poser des images sur la map

1. Outil **Image** (**J**), **Choisir une image** (filtres par type, catégorie et tag ; les objets par défaut).
2. Choisissez la **position** : _sur les objets_ (sous les tokens) ou _fond_ (sous les tuiles), et le calque.
3. Cliquez sur la map : l'image est posée à sa taille d'origine.
4. Glissez l'image sélectionnée pour la **déplacer**, ses **coins** pour la **redimensionner** (**Maj** garde les proportions), la poignée au-dessus pour la **tourner**. **Alt** désactive l'aimantation. **Suppr** l'efface, **Ctrl+Z** annule.
5. Le panneau **Propriétés** règle l'**opacité**, les **miroirs**, la position et le calque.

À savoir :

- Les images **animées** (GIF, WebP animé) s'animent sur la map, dans l'éditeur, la vue des joueurs et les écrans. Elles restent sur leur première image si l'appareil demande moins d'animations (réglage _réduire les animations_), en mode performance, sur les navigateurs qui ne savent pas les décoder, si elles sont trop lourdes (très grandes et très longues), et dans les exports PNG et les miniatures de map. Une image hors de l'écran ne s'anime pas.
- Une image ne bloque ni la vue, ni la lumière, ni les déplacements : posez des murs par-dessus.
- Une image du calque **MJ** n'est jamais montrée aux joueurs ni aux écrans. Le brouillard cache les images comme le reste.
- Les images posées librement trop grandes pour les limites du site sont réduites à l'envoi (les fonds de map, eux, sont découpés). Si l'envoi est refusé, réduisez ou découpez l'image, ou demandez à l'administrateur de relever les limites.
