# Accessibilité

Cible : WCAG 2.2 niveau AA, hors canvas (projet.md §22).

## Ce qui est garanti

- Langue `fr` déclarée, un `<title>` par page, un seul `<h1>` par vue, repères (`header`, `nav`, `main`).
- Tout est utilisable au clavier : ordre de focus logique, focus visible (`:focus-visible`), pas de piège dans les dialogues (Échap les ferme, le focus y reste puis revient au déclencheur).
- Contrastes : 4,5:1 pour le texte, 3:1 pour les composants et les grands textes, corrigés dans les jetons de couleur des thèmes (clair, sombre, contraste élevé) et dans la feuille de l'installeur.
- Champs avec libellé, erreurs liées au champ (`aria-describedby`), toasts et résultats annoncés par `aria-live`.
- Cibles tactiles et clics d'au moins 24 × 24 px ; `prefers-reduced-motion` respecté.
- Images d'assets : leur nom en texte alternatif.
- Éditeur : la liste textuelle des objets de la map (`SceneObjectList`) permet de sélectionner au clavier tout ce que porte la scène, et la palette Cmd/Ctrl+K donne accès à tous les outils.

## Comment c'est testé

- `e2e/tests/a11y.spec.ts` (axe-core via `@axe-core/playwright`, règles `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, canvas exclu) : connexion, inscription, mot de passe oublié, appairage d'écran, 404, accueil, création de partie, bibliothèque, profil, chaque onglet de l'administration, `update.php`, `install.php` (étape 1), les onglets d'une partie, console MJ, lobby et vue joueur, palette, dialogue de confirmation, écran de projection. Zéro violation tolérée.
- Le même fichier déroule un parcours entièrement au clavier : liste des parties, ouverture d'une partie, création d'une map, éditeur, palette, retour ; il vérifie `:focus-visible` et l'indicateur à chaque étape.
- `node dev/lighthouse.mjs` (Lighthouse épinglé, desktop et mobile) : performance, accessibilité et bonnes pratiques d'au moins 90 sur connexion, accueil, une partie, bibliothèque, administration. Il sort en erreur sous 90.

## Limites connues

- Le canvas (éditeur, vue joueur, console, écran de projection) est une image : les lecteurs d'écran n'y lisent rien. La liste textuelle des objets, l'état de séance et les panneaux de la console en sont les équivalents ; le déplacement d'un token reste une action de pointeur (le clavier passe par la liste et ses commandes).
- Le contenu Markdown des notes dépend du soin de l'auteur (titres, textes alternatifs).
- L'audit automatique ne couvre qu'une partie des critères WCAG : lecteurs d'écran et zoom à 400 % relèvent de vérifications manuelles.
