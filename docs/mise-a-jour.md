# Mise à jour

Cette page explique comment mettre JDR à jour, comment vérifier qu'une version est authentique, et quoi faire si quelque chose se passe mal. Pour la première installation, voir [installation.md](installation.md).

Dans tous les cas, l'archive `jdr-update-vX.Y.Z.zip` ne contient ni `config.php`, ni `storage/`, ni `install.php` : vos réglages, vos données et vos fichiers envoyés ne sont jamais touchés.

## Quelle voie choisir ?

| Voie | Pour qui |
|---|---|
| Automatique | par défaut, rien à faire |
| Manuelle (administration) | si vous voulez décider du moment, ou si le serveur ne peut pas joindre GitHub |
| Par FTP | si vous n'avez que le FTP |

## 1. Mise à jour automatique

Elle est **activée par défaut**. Le site consulte les releases GitHub (toutes les 6 heures au plus) et installe seul les nouvelles versions, en arrière-plan. Le site passe en maintenance le temps de la mise à jour.

### Le réglage

Ouvrez **Administration > Mise à jour**. La case **Mettre à jour automatiquement** l'active ou la désactive. Le **Canal de mise à jour** se choisit au même endroit : « Stable (versions publiées) » ou « Préversions (alpha, bêta) ».

### Les conditions

La mise à jour automatique ne démarre que si :

- la case est cochée ;
- la release est **signée** et sa signature est valide (voir plus bas) ;
- l'extension PHP `sodium` est présente. Sinon l'onglet affiche « Mise à jour automatique désactivée : l'extension PHP sodium est absente » ;
- l'archive correspond à l'empreinte du fichier `SHA256SUMS` de la release ;
- aucune séance de jeu n'a été lancée depuis moins de **12 heures** ;
- le site n'est pas une copie de développement.

La mise à jour n'avance que lorsque le site reçoit des visites ou qu'une tâche cron est configurée (voir [prerequis.md](prerequis.md)).

### Le rythme réel

- Elle est examinée à l'occasion d'une visite (environ **1 requête sur 50**), ou toutes les **5 minutes** avec la tâche cron.
- Elle lit la dernière release gardée en mémoire : au plus **6 heures** d'ancienneté. La « prochaine vérification au plus tôt » s'affiche dans l'onglet, avec la raison de tout blocage (sodium absent, release non signée, séance lancée il y a moins de 12 h, dernière erreur).
- Si vous ne voulez pas attendre, utilisez le bouton ci-dessous.

### Installer maintenant

Quand une version plus récente est annoncée, l'onglet propose **Installer la version X**. Le serveur force la vérification sur GitHub, télécharge l'archive, contrôle son empreinte `SHA256SUMS` **et** la signature, puis la présente comme une archive envoyée à la main : lisez le récapitulatif, choisissez de garder ou non la sauvegarde proposée, puis lancez l'installation. Ce bouton ignore la garde de 12 heures après une séance et les retentatives, et fonctionne même si la mise à jour automatique est désactivée. Il est refusé, avec une explication, si l'extension `sodium` est absente, si la release n'est pas signée ou sa signature invalide, s'il n'y a pas de version plus récente, si une archive ou une mise à jour est déjà en cours, ou sur une copie de développement.

### Les retentatives

- Si une **migration** de la base échoue, le site est restauré aussitôt et la mise à jour **n'est pas retentée** pour cette version.
- Pour les autres échecs, le site réessaie **3 fois**, à **1 heure** d'intervalle.
- Le résultat s'affiche dans **Administration > Mise à jour** : « Mise à jour automatique en cours », « La mise à jour automatique vers la version X a échoué » ou « Dernière mise à jour automatique : version X ».

## 2. Mise à jour manuelle (administration)

1. Connectez-vous en administrateur, puis ouvrez **Administration > Mise à jour**.
2. Cliquez sur **Vérifier les mises à jour**. Le site affiche la dernière version et un lien **Télécharger le zip de mise à jour**. Si GitHub est injoignable depuis le serveur, ouvrez la [page des releases](https://github.com/collet-david-pro/JDR/releases) dans votre navigateur.
3. Téléchargez le zip sur votre ordinateur. Ne le décompressez pas.
4. Envoyez-le avec **Envoyer un zip de mise à jour** (100 Mo au maximum, envoi par petits morceaux). Le navigateur calcule l'empreinte du fichier : une connexion HTTPS est nécessaire.
5. Lisez le récapitulatif : versions, fichiers ajoutés, modifiés ou supprimés, migrations, authenticité. Si l'archive est « Archive officielle (empreinte vérifiée) », continuez. Sinon, le site indique que l'authenticité n'a pas pu être vérifiée : n'installez que si vous savez d'où vient le fichier, et cochez alors la case de confirmation.
6. Cliquez sur **Installer**. La page `update.php` met le site en maintenance, sauvegarde la base, sauvegarde les fichiers remplacés, copie les nouveaux fichiers, contrôle leur intégrité, puis applique les migrations. **Gardez la page ouverte** jusqu'à « Mise à jour terminée ».

### La sauvegarde proposée avant la mise à jour

Avant d'installer, le site fait toujours une **sauvegarde de la base**. À la fin, il vous propose de la **télécharger** pour la garder (bouton « Télécharger la sauvegarde de la base d'avant la mise à jour ») ou de ne pas la garder.

- Après une mise à jour manuelle, ce fichier est supprimé après le téléchargement, et au plus tard **une heure** après la mise à jour.
- Après une mise à jour automatique, il reste disponible **7 jours au plus**, ou jusqu'à ce que vous le téléchargiez ou l'écartiez.
- Elle **ne contient pas les assets** (images, sons). Sauvegardez-les à part, voir [sauvegarde.md](sauvegarde.md).
- Elle se restaure depuis **Administration > Sauvegarde** (voir [sauvegarde.md](sauvegarde.md)).

## 3. Mise à jour par FTP

1. Téléchargez `jdr-update-vX.Y.Z.zip` sur votre ordinateur et décompressez-le.
2. Envoyez son contenu **par-dessus** l'installation, avec votre client FTP (fichiers cachés compris).
3. La visite suivante termine la mise à jour (migrations comprises). Si la mise à jour automatique est désactivée, ouvrez `update.php` à la racine du site et connectez-vous en administrateur.

Le contrôle d'intégrité utilise le fichier `manifest.json` livré dans l'archive. Si des fichiers manquent ou diffèrent, `update.php` les liste : renvoyez-les. Tant que la mise à jour n'est pas terminée, le site reste en maintenance si la base est en retard sur le code.

## Vérifier qu'une version est authentique

Chaque release publie sur GitHub :

- `SHA256SUMS` : la liste des empreintes (SHA-256) des archives ;
- `SHA256SUMS.sig` : la **signature Ed25519** de ce fichier. Elle prouve que la liste vient bien de l'auteur.

Le site fait ces vérifications seul :

1. il vérifie la signature de `SHA256SUMS` avec la clé publique intégrée au code (extension `sodium` nécessaire) ;
2. il compare l'empreinte de l'archive à celle de `SHA256SUMS`.

Si la signature est **invalide**, la mise à jour automatique est refusée et l'onglet vous dit de ne pas installer l'archive sans vérification. Si la release n'est **pas signée**, la mise à jour automatique est impossible ; l'envoi manuel reste possible.

Les versions publiées jusqu'à la `0.2.0` incluse ne sont pas signées. À partir de la `0.3.0`, chaque release l'est.

## Retour arrière

- Si la **copie des fichiers** échoue, les fichiers précédents sont remis en place automatiquement.
- Si une **migration** échoue, le site reste en maintenance. `update.php` propose :
  - **Réessayer**, après avoir corrigé la cause (par exemple un droit manquant sur la base) ;
  - **Restaurer** la version précédente, à partir de la sauvegarde faite au début.
- Plus tard, vous pouvez restaurer la base d'avant la mise à jour depuis le fichier téléchargé (**Administration > Sauvegarde**). Une base d'une version plus ancienne demande ensuite d'ouvrir `update.php` pour appliquer les migrations.

## En cas d'échec

1. Ne fermez pas la page et ne supprimez rien. Lisez le message affiché.
2. Si la page a été fermée ou la connexion coupée : ouvrez **Administration > Mise à jour** et cliquez sur **Reprendre**, ou rouvrez `update.php`.
3. Une migration a échoué : corrigez la cause indiquée, puis **Réessayer**. Sinon **Restaurer**.
4. Le site reste en maintenance et vous ne pouvez plus vous connecter : ouvrez `update.php` à la racine du site et connectez-vous en administrateur.
5. Rien ne marche : restaurez la sauvegarde de la base téléchargée avant la mise à jour et renvoyez par FTP les fichiers de la version précédente.
6. Pour les autres symptômes, voir [diagnostic.md](diagnostic.md).
