# Peindre le terrain

Le sol est fait de **tuiles** posées sur trois calques : **Sol**, **Terrain** et **Décor**. Choisissez une tuile dans la palette (images de votre bibliothèque), le calque actif (touches **1** à **9**), puis un outil.

**Textures.** La palette accepte aussi les images de type _texture_ (bouton **Ajouter une texture**, filtre **Tuiles** / **Textures**). Une texture est alignée sur la carte : elle couvre _N × N_ cases (réglage **Cases couvertes par la texture**, par défaut la taille de l'image divisée par la taille d'une case) et chaque case en montre la portion qui lui correspond, ce qui donne un sol continu sans motif répété à chaque case. Pour un résultat sans raccord visible, utilisez une texture _répétable_ (voir l'onglet Textures procédurales de la bibliothèque). La rotation et la variante aléatoires sont sans effet sur une texture. Changer le réglage modifie toutes les cases déjà peintes avec elle.

- **Pinceau** (B) : peint ; taille avec **[** et **]**, forme carrée ou ronde ; _variante aléatoire_ et _rotation aléatoire_ pour varier le rendu.
- **Gomme** (E) : efface.
- **Remplissage** (G) : remplit la zone de même tuile (jusqu'à 50 000 cases).
- **Formes** (U) : rectangle, ellipse ou ligne, pleins ou en contour.
- **Pipette** (I) : reprend la tuile d'une case.
- **Sélection** (V) : glissez pour sélectionner des cases ; **Maj** ajoute à la sélection, **Échap** la vide.
- **Règle** (M) : mesure une distance. **Alt** désactive l'aimantation à la grille.
- **Main** (H) : déplace la vue. Maintenez **Espace** pour passer temporairement à la main.

Dans l'onglet **Calques** des panneaux : visibilité, verrou, solo et opacité de chaque calque, et ordre des calques. Le menu **Affichage** de la barre du haut règle l'affichage et le thème de la grille (parchemin, ardoise, plan technique, sombre, clair, pointillés, croix, grille marquée toutes les 5 cases, encre sur parchemin, lueur). Le thème s'applique à l'éditeur, à la vue des joueurs, aux écrans et à l'export PNG.

**Bords adoucis.** Sous la palette, la case à cocher **Bords adoucis** s'applique à la tuile ou à la texture sélectionnée. Quand deux cases voisines (haut, bas, gauche, droite) montrent deux images différentes qui ont toutes deux l'option, la frontière est fondue sur environ 40 % de la case au lieu d'être nette. C'est un simple effet d'affichage : les cases peintes ne changent pas, il se voit aussi chez les joueurs et dans l'export PNG, et il suit les modifications. Une image sans l'option garde un bord net. L'option peut être retirée à tout moment.

## Symétrie et répétition

Avec le **Pinceau** ou la **Gomme**, le bloc _Symétrie et répétition_ du panneau d'options duplique chaque trait :

- **Miroir** gauche/droite, haut/bas ou dans les deux sens, autour du centre de la map ou d'un axe que vous choisissez (case, par demi-case).
- **Répétition** : _Copies répétées_ recopie le trait avec un pas horizontal et vertical en cases (utile pour des piliers, des dalles ou des rangées régulières).

Les cases générées sont peintes dans le même trait : une seule annulation (**Ctrl+Z**) les retire toutes.
