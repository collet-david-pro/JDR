# Prérequis du serveur

Cette page liste ce qu'il faut sur votre hébergement avant d'installer JDR. L'assistant `install.php` vérifie tout cela à l'étape 1 et vous dit quoi corriger. Pour l'installation elle-même, voir [installation.md](installation.md).

JDR n'a besoin ni de SSH, ni de Composer, ni de Node.js sur le serveur.

## En bref

| Élément | Ce qu'il faut |
|---|---|
| PHP | **8.1** ou plus récent |
| Base de données | MySQL **5.7** ou plus, ou MariaDB **10.3** ou plus (InnoDB, `utf8mb4`) |
| Serveur web | Apache (fichiers `.htaccess`), LiteSpeed, ou Nginx ([nginx.md](nginx.md)) |
| Place disque | Voir plus bas |
| HTTPS | Conseillé |
| Tâche cron | Facultative |

## PHP

Version minimale : **PHP 8.1**. Si la version est trop ancienne, l'assistant s'arrête avec un message. Changez alors la version de PHP dans le panneau de l'hébergeur.

### Extensions obligatoires

Sans l'une d'elles, l'étape 1 de l'installation est rouge et l'installation est impossible.

| Extension | Rôle |
|---|---|
| `pdo_mysql` | accès à la base de données |
| `mbstring` | textes en UTF-8 |
| `json` | échanges avec le navigateur |
| `fileinfo` | reconnaissance du vrai type des fichiers envoyés |
| `gd` | traitement des images (PNG, JPEG, WebP, GIF) |
| `zlib` | compression |
| `openssl` | clés et signatures |
| `ctype` | contrôles de texte |
| `session` | connexions |

Les panneaux d'hébergeur proposent en général une page « Extensions PHP » où l'on coche celles à activer.

### Extensions facultatives

Leur absence donne un point orange à l'étape 1, mais n'empêche pas l'installation.

| Extension | Ce qu'elle apporte | Sans elle |
|---|---|---|
| `sodium` | vérifie la signature des versions publiées | **la mise à jour automatique est désactivée** ; la mise à jour manuelle reste possible |
| `zip` | archives plus rapides | JDR écrit les ZIP lui-même, en PHP |
| `imagick` | meilleure qualité d'image, WebP animé | `gd` est utilisé |
| `apcu` | signaux temps réel en mémoire | des fichiers témoins sont utilisés |

**Conseil : activez `sodium`.** Il est livré avec PHP 7.2 et plus, mais certains hébergeurs le laissent désactivé. Sans lui, l'onglet **Administration > Mise à jour** affiche « Mise à jour automatique désactivée : l'extension PHP sodium est absente ».

### Réglages PHP conseillés

L'étape 1 de l'installation (et **Administration > Diagnostic** ensuite) signale en orange :

- `memory_limit` inférieur à 128 Mo (256 Mo idéal) ;
- `upload_max_filesize` et `post_max_size` inférieurs à 10 Mo ;
- `max_execution_time` inférieur à 30 secondes ;
- `output_buffering` ou `zlib.output_compression` activés : ils peuvent retarder le flux temps réel.

## Base de données

- MySQL 5.7 ou plus, ou MariaDB 10.3 ou plus.
- Moteur InnoDB, jeu de caractères `utf8mb4`.
- L'utilisateur de la base doit avoir les droits `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, `INDEX`, `REFERENCES` et `DROP`. Les droits `CREATE` et `ALTER` servent aussi aux mises à jour futures : ne les retirez pas après l'installation.
- Prévoyez un espace de base modeste : un site de quelques joueurs reste en général sous quelques dizaines de Mo. **Administration > Diagnostic** affiche la taille de la base.

## Modules Apache

Les trois modules ci-dessous sont **facultatifs**. Le site fonctionne sans eux.

| Module | À quoi il sert | Sans lui |
|---|---|---|
| `mod_rewrite` | adresses propres (`/games/12`) | le site fonctionne en « mode sans réécriture » (adresses de la forme `#/games/12`, voir [installation.md](installation.md)) |
| `mod_deflate` | compresse les pages, scripts et styles | le site est plus lent à charger, surtout sur téléphone |
| `mod_headers` | durée de cache des fichiers du site | les fichiers sont rechargés plus souvent |

Le fichier `.htaccess` ne s'applique que si l'hébergeur l'autorise. Si le site affiche une erreur 500 partout, voir le tableau de dépannage de [installation.md](installation.md).

## Place disque

JDR lui-même occupe peu de place. La place dépend surtout des images et sons que vos utilisateurs envoient dans le dossier `storage/assets/`.

- Comptez quelques dizaines de Mo pour les fichiers du site.
- Chaque utilisateur a un quota d'espace (réglable dans l'administration).
- Pour **sauvegarder** et **mettre à jour**, prévoyez de la place libre en plus : la sauvegarde de la base et les fichiers remplacés sont écrits temporairement dans `storage/`.
- Si votre hébergeur le permet, placez `storage/` hors de la racine web (étape 3 de l'installation).

## HTTPS

HTTPS est **conseillé**, et nécessaire pour certaines fonctions du navigateur :

- l'envoi d'une archive de mise à jour calcule son empreinte dans le navigateur, ce qui exige une connexion HTTPS ;
- les cookies sont marqués « sécurisés » quand le site est en HTTPS (`cookie_secure` dans `config.php`).

**Administration > Diagnostic** affiche un avertissement si le site n'est pas en HTTPS. La plupart des hébergeurs proposent un certificat gratuit (Let's Encrypt) en un clic.

## Tâche cron

La tâche cron est **facultative**. Sans elle, les tâches de fond (purge des journaux, corbeille, mise à jour automatique…) s'exécutent pendant la navigation des visiteurs.

Un cron est utile si le site reçoit peu de visites : sans visite, rien ne se purge et aucune mise à jour automatique ne démarre. Programmez alors, **toutes les 5 minutes**, l'appel de :

```
https://votre-site/cron.php?key=VOTRE_CLE_CRON
```

La clé est la valeur `cron_key` du fichier `config.php`. Gardez-la secrète.

## Autres points

- **Appels sortants** : pour vérifier les nouvelles versions, le serveur doit pouvoir joindre GitHub. Sinon, téléchargez les archives vous-même depuis la [page des releases](https://github.com/collet-david-pro/JDR/releases).
- **Auto-appel** : l'assistant d'installation fait de vraies requêtes vers votre propre site. Si l'hébergeur l'interdit, deux points passent en orange (voir [installation.md](installation.md)).
- **Horloge** : un grand écart entre l'horloge du serveur web et celle de la base est signalé.
