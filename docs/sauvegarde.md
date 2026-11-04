# Sauvegarde et restauration

Tout se passe dans **Administration > Sauvegarde**. Cette page explique ce que l'on peut sauvegarder, comment restaurer, et comment ne pas perdre ses données.

## À retenir

- Il y a **deux sauvegardes séparées** : la **base de données** et les **assets** (images, sons).
- **Aucune copie n'est gardée sur le serveur.** Chaque sauvegarde est construite, téléchargée dans votre navigateur, puis supprimée du serveur (au plus tard une heure après).
- La restauration se fait **uniquement depuis un fichier que vous envoyez**.
- Le fichier `config.php` n'est pas dans les sauvegardes : gardez-en une copie vous-même.

## Que contient chaque sauvegarde ?

| Sauvegarde | Contenu | Fichier |
|---|---|---|
| Base de données | comptes, parties, maps, tokens, réglages, tout ce qui est dans la base | `.sql.gz` |
| Assets | les images et sons envoyés (dossier `storage/assets/`) | `.zip` |

Pour sauvegarder tout le site, faites **les deux**.

## Sauvegarder

1. Ouvrez **Administration > Sauvegarde**.
2. Dans la section « Sauvegarder », cliquez sur **Sauvegarder la base de données** ou sur **Sauvegarder les assets**.
3. Attendez la fin (« Sauvegarde en cours… » avec un pourcentage). Vous pouvez cliquer sur **Annuler la sauvegarde**.
4. Le navigateur télécharge le fichier. Un message confirme : « Sauvegarde téléchargée : nom-du-fichier ».
5. Rangez le fichier ailleurs que sur le serveur (voir les conseils plus bas).

Le travail se fait par petites tranches : il convient aux hébergements mutualisés, même avec beaucoup de données. Gardez la page ouverte jusqu'au téléchargement.

## Restaurer

**Attention : la restauration remplace les données actuelles par celles du fichier.** Le site passe en maintenance pendant l'opération.

1. Ouvrez **Administration > Sauvegarde**, section « Restaurer ».
2. Choisissez ce que vous restaurez : « La base de données (fichier .sql.gz) » ou « Les assets (fichier .zip) ».
3. **Conseillé** : cliquez d'abord sur « Télécharger d'abord la base actuelle » (ou « … les assets actuels »). Si la restauration ne donne pas ce que vous attendiez, vous pourrez revenir en arrière.
4. Choisissez le fichier de sauvegarde. La taille maximale est affichée.
5. **Première confirmation** : cochez « Je comprends que les données actuelles seront remplacées ».
6. **Seconde confirmation** : tapez le mot demandé (`RESTAURER`).
7. Le bouton **Restaurer** s'active seulement quand le fichier est choisi, la case cochée et le mot tapé. Cliquez dessus.
8. Attendez la fin : « Envoi du fichier… » puis « Restauration en cours… ».

### Après une restauration de la base

- Toutes les sessions sont fermées : « Reconnectez-vous » avec le bouton **Se reconnecter**.
- Si la sauvegarde vient d'une **version plus ancienne** du site, le site vous le dit : cliquez sur **Ouvrir update.php** pour appliquer les migrations.
- Le fichier est vérifié avant d'être appliqué : seules les commandes attendues d'une sauvegarde de JDR sont acceptées. Un fichier modifié ou venant d'ailleurs est refusé.

### Après une restauration des assets

Un message donne le détail : fichiers remis, fichiers déjà présents, fichiers refusés. Un fichier refusé (par exemple d'un type non autorisé) n'est pas copié.

### Si la restauration s'interrompt

Si la page est fermée ou la connexion coupée pendant la restauration de la base, le site **reste en maintenance**. À la réouverture de l'onglet, un message explique que la restauration a été interrompue ou a échoué. Relancez-la avec un fichier de sauvegarde.

## Conseils

1. **Sauvegardez régulièrement**, par exemple avant chaque grosse séance et avant chaque mise à jour. Il n'y a pas de sauvegarde automatique.
2. **Gardez plusieurs copies**, dont au moins une **hors du serveur** (ordinateur, disque externe, stockage en ligne). Une sauvegarde qui n'existe que sur le serveur disparaît avec lui.
3. **Gardez plusieurs générations** : un fichier d'hier peut sauver ce qu'un fichier d'aujourd'hui a déjà perdu.
4. **Testez une restauration** de temps en temps, idéalement sur une autre installation de test : une sauvegarde jamais testée est une sauvegarde dont on n'est pas sûr.
5. **Sauvegardez aussi `config.php`**. Sans la clé `app_secret`, les liens de fichiers signés déjà distribués ne marchent plus.
6. **Protégez les fichiers de sauvegarde** : ils contiennent les données de vos utilisateurs.
7. Pensez aussi aux sauvegardes de votre hébergeur, si elles existent : elles complètent celles de JDR.

## Sauvegarde proposée à la mise à jour

À chaque mise à jour, le site fait une sauvegarde de la base et vous propose de la télécharger. Elle ne contient pas les assets. Voir [mise-a-jour.md](mise-a-jour.md). Elle se restaure ici, comme toute sauvegarde de la base.
