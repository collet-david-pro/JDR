# Mode présentiel (écrans de projection)

Ce document décrit le mode présentiel (phase 7) : une tablette, une télévision posée à plat ou un vidéoprojecteur affiche la map de la séance **à l'échelle réelle** (25 mm par case par défaut), pour y poser de vraies figurines. Le code serveur est dans `app/Domain/Displays/`, le client dans `frontend/src/components/display/` et `frontend/src/lib/displays/`.

## À quoi ça sert

Un **écran** est un appareil sans compte, appairé à une séance par un code. Il ne montre que la **vue de table** : ce que tout le monde autour de la table peut voir, jamais ce que le MJ cache. Le MJ garde sa console ; l'écran n'a aucune commande (sauf un menu discret local).

## Mise en place pas à pas

1. Lancer la séance, ouvrir la console MJ, onglet **Écrans**.
2. Saisir un nom (« Table », « Plafond »…) puis **Ajouter** : l'écran apparaît « en attente » avec un **code à 6 chiffres valable 10 minutes**, un **QR** et un lien `/display?c=<code>`.
3. Sur l'appareil, ouvrir `/display` (adresse du site suivie de `/display`) et saisir le code, ou scanner le QR / ouvrir le lien. Le code disparaît de l'adresse dès l'appairage.
4. L'écran passe « actif » dans la console, avec un voyant « en ligne » (vu depuis moins de 60 s).

## Calibrage

L'échelle est la taille réelle d'une case sur l'écran :

- **Diagonale en pouces** (réglage de la console) : `px/mm = hypot(largeur, hauteur de l'écran) / (diagonale × 25,4)`. Rapide, précis à quelques pour cent.
- **Règle à l'écran** (menu de l'écran, « Calibrer ») : on pose une règle contre l'écran, on ajuste la ligne affichée à une longueur connue, on enregistre. Plus précis ; ce réglage (`px_per_mm`) **prime sur la diagonale**.
- **Millimètres par case** : 25 par défaut, réglable de 5 à 100.

Bornes : diagonale 5 à 300 pouces, `px_per_mm` 0,5 à 50, `mm_per_cell` 5 à 100. Quand l'échelle est connue, **le zoom du MJ est ignoré** (seul le centre de la caméra est suivi) ; le zoom reste borné entre 0,05 et 8.

## Rotation et miroir

Rotation 0, 90, 180 ou 270° (écran à plat, vu de côté) et miroir (projection au plafond ou par l'arrière). Réglables depuis la console ou le menu de l'écran ; appliqués par transformation CSS du conteneur, largeur et hauteur permutées à 90 et 270°.

## Pilotage depuis la console

- **Suivre la caméra** : l'écran centre la vue sur celle du MJ ; **Diffuser ma caméra** envoie chaque déplacement de caméra aux écrans.
- **Partager ma vue** : envoie la caméra une fois.
- **Verrouiller la vue** : fixe la vue actuelle (centre, zoom, étage) sur un écran ; **Déverrouiller** la libère.
- **Afficher les tokens** : par écran (utile pour une carte « décor » sans pions : on pose les figurines).

## Ce que montre l'écran

La **vue de table** est calculée par le serveur :

- les **viewers** sont les tokens posés, non cachés, de l'étage courant **affectés à un joueur**, plus les tokens `pc` **non affectés** ;
- la portée est l'**exploré** de la séance plus des disques de rayon `vision + 2` cases autour des viewers ; la console MJ explore pour la table quand un écran est actif ;
- jamais de token caché, de lumière réservée au MJ, de porte secrète (vue comme un mur), de code de séance ni de nom d'utilisateur. Le snapshot de l'écran porte `role:"display"`, `players: []` et des affectations sans nom.

## Pause et textes à lire

En pause, l'écran affiche un fond uni ou une **image avec texte** (éditeur « Écran de pause » de la console). Les textes à lire envoyés par le MJ s'affichent en grand sur l'écran.

## Plusieurs écrans

Jusqu'à **8 écrans** par séance, chacun avec ses réglages. À la fin d'une séance, ses écrans sont **révoqués automatiquement** (pas de réutilisation) : ils reviennent aussitôt au formulaire d'appairage, et un nouvel écran se crée dans la séance suivante.

## Écran toujours allumé

La page demande un **Wake Lock** (`navigator.wakeLock`) et le redemande à chaque retour de visibilité. Sans Wake Lock, elle joue une vidéo invisible (`canvas.captureStream()`), et à défaut affiche un bandeau d'avertissement. État exposé : `data-wake` = `active`, `video`, `unsupported` ou `idle`. Conseils : désactiver la mise en veille de l'appareil, passer en plein écran, utiliser un mode kiosque (navigateur verrouillé sur `/display`), brancher l'appareil au secteur.

## Menu discret

Touche **M**, ou **appui long de 2 s dans un coin** : calibrer, rotation, miroir, état du Wake Lock, plage de zoom, **Quitter** (désappairer, avec confirmation), Fermer.

## Sécurité

- Aucun compte. L'écran porte un cookie `jdr_display` **HttpOnly, SameSite=Strict, valable 30 jours** et renouvelé à l'usage.
- Hors des pages `/display/*`, les requêtes d'un écran portent `?as=display` : sans cela, le cookie n'est pas pris en compte.
- Un écran ne lit que sa séance (`404` sur toute autre) et uniquement par la vue de table.
- **Révocation immédiate** : supprimer l'écran dans la console renvoie l'appareil au formulaire d'appairage en moins de 2 s ; toute requête suivante reçoit `401 display_unpaired`.
- L'appairage est limité (`pair`, 10 par minute et par adresse IP).

## Référence technique

| Côté | Point d'accès |
|---|---|
| MJ | `POST /api/v1/sessions/{id}/displays {name}` (écran + code), `GET /sessions/{id}/displays` (`displays`), `PATCH /displays/{id} {name?, settings?}`, `DELETE /displays/{id}`, `POST /displays/{id}/regenerate-code` |
| Écran | `POST /display/pair {code}`, `GET\|PATCH /display/me?as=display`, `POST /display/unpair?as=display` |
| Lecture écran | `GET /events` et `/stream` (`channels=session:{id}`), `/sessions/{id}/snapshot`, `/sessions/{id}/preload`, `/maps/{id}/chunks`, `/maps/{id}/fog`, tous avec `?as=display` |

Réglages d'un écran : `diagonal_in`, `px_per_mm`, `mm_per_cell`, `rotation`, `mirror`, `show_tokens`, `follow_camera`, `view_lock {x, y, zoom, floor_id}` ou `null`. Événements : `display.paired`, `display.updated`, `display.revoked` ; les événements d'un écran ont l'audience `displays` et `view:"display"` ; `camera.moved` va aussi aux écrans.

## Dépannage

- **Code refusé ou expiré** : cliquer « Nouveau code » dans la console (le code vit 10 minutes).
- **« Trop de tentatives »** : au plus 10 appairages par minute et par IP ; attendre une minute.
- **Cases trop grandes ou trop petites** : vérifier la diagonale, ou recalibrer à la règle ; une valeur hors bornes est refusée, et le menu de l'écran signale une échelle impossible à atteindre (zoom hors de 0,05 à 8).
- **L'écran s'éteint** : le navigateur n'a pas de Wake Lock et le repli vidéo est bloqué ; désactiver la veille de l'appareil.
- **Écran revenu au formulaire** : il a été révoqué, ou son cookie a expiré ; recréer un code.

## Vérifications manuelles recommandées

Les huit critères de la phase sont vérifiés par `e2e/tests/displays-criteria.spec.ts` (Chromium, Firefox, WebKit). Deux points ne s'automatisent pas :

- **Mesure à la règle** d'une case sur l'appareil réel : 25 mm ± 0,5 mm après calibrage ;
- **Écran allumé 1 heure** sur l'appareil réel, sans toucher.
