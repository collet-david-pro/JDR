# Génération procédurale

Ce document décrit la génération procédurale (phase 8) : quatre générateurs de maps (donjon, grotte, extérieur, village), des textures raccordables et un pack d'images de base. Le cœur est dans `frontend/src/procgen/` (TypeScript pur, sans DOM), l'exécution et l'application dans `frontend/src/lib/procgen/` et `frontend/src/workers/gen.worker.ts`, le serveur dans `app/Domain/Procgen/`.

## Utilisation

Dans l'éditeur, bouton **Générer** de la barre du haut ou **Maj+G** : le panneau s'ouvre à droite, avec deux onglets.

**Onglet Générer**

1. Choisir le **générateur** (donjon, grotte, extérieur, village) puis un **préréglage**, ou régler les **paramètres** à la main (le préréglage passe alors à « Personnalisé »).
2. **Graine** : un texte libre de 1 à 64 caractères ; le bouton dé en tire une au hasard. La même graine redonne toujours la même map.
3. **Cible** :
   - *Nouvelle map* : nom et taille ; la map est créée dans la partie et s'ouvre dans l'éditeur avec le résultat ;
   - *Map actuelle* : remplace les tuiles et **tous** les murs, portes, fenêtres et lumières de la map (les tokens posés et le brouillard sont conservés), après confirmation si la map n'est pas vide ;
   - *Sélection* (donjon et grotte) : régénère seulement le rectangle sélectionné (voir plus bas).
4. L'**aperçu** (une vignette, un pixel par case) se met à jour un instant après chaque réglage ; dessous s'affichent la durée de calcul, l'empreinte du résultat et les éventuelles images manquantes du pack.
5. **Appliquer**. Avant de remplacer un contenu existant, un **instantané « Avant génération »** est créé dans l'historique des versions ; la génération entière s'annule ensuite d'un seul **Ctrl+Z** (Cmd+Z sur Mac).

Le calcul tourne dans un worker, sans bloquer la page : une grande map peut prendre du temps, la progression s'affiche et **Annuler** l'interrompt (rien n'est appliqué). Sur un navigateur sans worker, le calcul se fait dans la page et ne peut plus être annulé une fois lancé.

Les réglages de la dernière génération sur la map entière (générateur, version, graine, paramètres) sont enregistrés avec la map : le panneau se rouvre pré-rempli, et le dé suffit pour **régénérer** une variante.

**Onglet Textures** : matière, palette, taille et graine, aperçu en mosaïque 3 × 3 pour vérifier le raccord, puis **Enregistrer dans ma bibliothèque**.

## Les générateurs

| Générateur | Taille (cases) | Paramètres | Thèmes | Zone |
|---|---|---|---|---|
| **Donjon** (`dungeon`) | 20-400 (60×60) | salles 3-200 (14), taille min 3-20 (4) et max 4-40 (10), largeur des couloirs 1-3, boucles 0-50 % (15 %), probabilité de porte (80 %) et de porte secrète (5 %), densité de décor | pierre, crypte, égouts, bois | oui |
| **Grotte** (`cave`) | 20-400 (60×60) | remplissage 35-60 % (45 %), itérations 1-10 (5), lissage 0-3 (1), raccordement par tunnels ou comblement, densité de décor | roche, glace, lave | oui |
| **Extérieur** (`outdoor`) | 30-400 (80×80) | échelle 0,5-4, eau 0-100 % (30 %), rivières 0-6 (2), routes 0-6 (2), forêt 0-100 % (50 %) | tempéré, désert, hiver | non |
| **Village** (`village`) | 30-200 (70×70) | bâtiments 2-40 (10), part de bâtiments en L (30 %), intérieurs (oui/non), densité de décor | rural, bourg | non |

Chaque générateur propose des préréglages (« Petite crypte », « Grand donjon », « Caverne glacée », « Forêt et rivière », « Hameau »…).

- **Donjon** : partition binaire de l'espace, une salle par feuille, couloirs en L entre salles voisines, arbre couvrant minimal plus des boucles, murs tracés sur le contour du sol (segments alignés fusionnés), portes aux jonctions salle/couloir (les ouvertures plus larges qu'un couloir restent des arches), entrée et sortie (escaliers) dans les deux salles les plus éloignées, salles typées (entrée, sortie, boss, trésor, commune, réserve, sanctuaire…).
- **Grotte** : automate cellulaire (règle « 4-5 »), plus grande cavité conservée, les autres reliées par tunnels ou comblées, lissage, parois naturelles lissées (marching squares puis Douglas-Peucker), régions (bassins, champignons, cristaux…) peuplées de rochers, stalagmites, flaques, champignons lumineux ; lave infranchissable gardée hors du chemin entre l'entrée et la sortie.
- **Extérieur** : élévation et humidité par bruit fractal, biomes (eau profonde, eau, plage, plaine, forêt, colline, montagne, neige) avec lisières adoucies, rivières qui descendent des hauteurs, routes tracées au plus court selon le terrain, ponts (traversées courtes) ou gués, arbres et rochers répartis par échantillonnage de Poisson.
- **Village** : route principale et embranchements, parcelles adossées aux routes, bâtiments rectangulaires ou en L avec porte côté route, pièces (taverne, forge, temple, maison, ferme, entrepôt, échoppe) reliées par des portes, fenêtres sur les façades, mobilier par type de pièce, puits, étals, clôtures et lanternes.

Le décor est posé par des **règles déclaratives** (`frontend/src/procgen/rules/<générateur>/<thème>.json`) : objet, nombre ou densité, placement (contre un mur, dans un coin, au centre, partout), distance minimale aux portes, rotation. Garanties vérifiées par les tests : rien n'est posé sur un passage ni devant une porte, aucune porte n'est bloquée, un objet encombrant ne coupe jamais le sol en deux. Les objets de décor sont des tuiles du calque Décor : ils ne bloquent pas le déplacement en séance (seuls les murs bloquent).

Un seul étage par génération pour l'instant (les escaliers sont des tuiles de décor).

## Génération dans une sélection

Donjon et grotte peuvent régénérer **l'intérieur d'une sélection rectangulaire** (au moins 8×8 cases) : les cases de sol qui touchent le bord de la sélection depuis l'extérieur, sans mur entre les deux, deviennent des **ouvertures** que le générateur relie à son réseau (aucun mur n'est tracé en travers). Les tuiles du rectangle sont remplacées, les objets entièrement dans le rectangle aussi ; ceux qui le traversent sont conservés.

## Déterminisme et empreintes

- Même générateur, même version, même graine et mêmes paramètres ⇒ **exactement** le même résultat, dans tous les navigateurs. Le hasard vient d'un générateur pseudo-aléatoire `sfc32` initialisé par `xmur3(graine + ':' + générateur + ':' + version)`.
- Dans `frontend/src/procgen/`, une règle ESLint interdit `Math.random`, `Date`, la trigonométrie, `exp`/`log`/`pow` et `**` (résultats qui peuvent varier d'un moteur JavaScript à l'autre) ; seuls les rendus de textures et de pictogrammes (`textures/`, `sprites/`) ont droit à la trigonométrie. Les tris utilisent toujours un comparateur total et les nombres sortants sont arrondis à 3 décimales.
- Un générateur produit un résultat **abstrait** (`GenResult` : tuiles désignées par des clés de pack comme `floor.stone`, murs, portes, fenêtres, lumières, salles) ; son **empreinte** est le SHA-256 de son JSON canonique (clés triées). Les tests figent 20 graines de référence (`or-01` à `or-20`) et quelques préréglages par générateur dans `frontend/tests/procgen/golden/<générateur>.v1.json`.
- Modifier un algorithme impose une **nouvelle version** du générateur ; les anciennes restent appelables (registre `procgen/registry.ts`). Pour régénérer les valeurs de référence après un changement voulu : `UPDATE_GOLDEN=1 npx vitest run tests/procgen` (dans `frontend/`).
- La **liaison** (`procgen/bind.ts`) transforme le résultat en **une seule commande** d'édition : entrées de palette, tuiles des trois calques (par paquets de 5 000 cellules), suppression puis ajout des objets avec des identifiants aléatoires. Un seul Ctrl+Z annule tout.

## Pack de base

Les clés de pack (`frontend/src/procgen/pack-keys.ts` : 10 sols, 4 terrains, 25 décors) désignent des images du **pack de base** : 39 images 256×256 de remplacement, produites par nos propres générateurs (textures procédurales pour les sols et terrains, pictogrammes vus de dessus pour le décor), versionnées dans `app/Seed/base-pack/` (`pack.json` + PNG, 1,9 Mo).

- Le pack s'installe **tout seul** dans la bibliothèque générale au premier appel de `GET /api/v1/procgen/pack` (une seule fois, sous verrou, sans doublon ; source `system`, hors quota). La correspondance clé ⇒ image est gardée dans le réglage `base_pack`.
- Un administrateur peut remplacer ou supprimer ces images : une clé dont l'image a disparu est remplacée par la clé par défaut de sa famille (`floor.stone`, `terrain.water`) ; un décor manquant est laissé vide et signalé.
- Pour régénérer les images après une modification des textures ou des pictogrammes : `UPDATE_BASE_PACK=1 npx vitest run tests/procgen/textures/base-pack.test.ts` (dans `frontend/`), puis augmenter `BASE_PACK_VERSION` pour que les sites déjà installés importent la nouvelle version.

## Textures procédurales

Dix matières (pierre, dalles, pavés, bois, herbe, terre, sable, eau, lave, glace) × palettes, en 128, 256 ou 512 pixels, **raccordables** (bruits périodiques : une mosaïque ne montre pas de couture). Une texture enregistrée devient un asset normal de la bibliothèque personnelle (`source = generated`, soumis au quota).

## API

| Endpoint | Rôle |
|---|---|
| `GET /api/v1/procgen/pack` | `{version, assets: {clé: {asset_id, url, name}}}` (URL signées ; installe le pack au premier appel) |
| `POST /api/v1/assets` | champ `source` facultatif : `upload` (défaut) ou `generated` |
| `POST /api/v1/maps/{id}/versions` | champ `kind` : `manual` (défaut) ou `pre_generate` |
| `PATCH /api/v1/maps/{id}` | champ `generation` : `{generator, gen_version, seed, params}` ou `null` ; renvoyé par `GET /api/v1/maps/{id}` |
