# Installation

> Document en cours de rédaction : l'installeur (`install.php`) arrive en phase 1. Les sections marquées *à compléter* seront détaillées à ce moment-là.

## Prérequis de l'hébergement

- PHP **8.1** ou plus récent, extensions `pdo_mysql`, `gd` (JPEG, WebP), `zip`, `mbstring`, `json`, `fileinfo`.
- MySQL **5.7** ou plus / MariaDB **10.3** ou plus, moteur InnoDB, jeu de caractères `utf8mb4`.
- Un utilisateur de base de données avec les droits `CREATE`, `ALTER`, `INDEX`, `REFERENCES`, `DROP`, `SELECT`, `INSERT`, `UPDATE`, `DELETE`.
- Serveur Apache (fichiers `.htaccess`) ou Nginx (voir [nginx.md](nginx.md)). La réécriture d'URL est conseillée mais pas obligatoire (mode `query`).
- HTTPS fortement recommandé.

Aucun accès SSH, aucune tâche cron, aucun Composer ne sont nécessaires.

## Installation neuve

1. Télécharger l'archive `jdr-vX.Y.Z-full.zip` et l'extraire sur votre ordinateur.
2. Envoyer **tout le contenu** par FTP dans le dossier web (fichiers à la racine du site ou dans un sous-dossier).
3. Ouvrir `https://votre-site/install.php` et suivre les étapes :
   1. prérequis (contrôle automatique, y compris la protection des dossiers privés) ;
   2. base de données ;
   3. réglages du site ;
   4. compte administrateur ;
   5. installation (migrations, données initiales, `config.php`) ;
   6. fin : `install.php` est supprimé ou verrouillé.

*À compléter (phase 1) : captures, messages d'erreur fréquents, cas où `config.php` ne peut pas être écrit (contenu à copier à la main), stockage hors racine web, reprise après interruption.*

## Mise à jour

1. Sauvegarder (l'outil le fait aussi automatiquement avant de migrer).
2. Envoyer le contenu de `jdr-update-vX.Y.Z.zip` **par-dessus** l'installation. Cette archive ne contient ni `config.php`, ni `storage/`, ni `install.php` : vos données ne sont pas touchées.
3. Se connecter en administrateur : le site passe en maintenance et propose `update.php`, qui vérifie d'abord l'intégrité des fichiers envoyés (`manifest.json`), puis applique les migrations une par une.

*À compléter (phase 10) : restauration d'une sauvegarde, échec d'une migration, retour arrière.*

## Tâches planifiées (optionnel)

*À compléter : URL de `cron.php` et clé, fréquence conseillée. Sans cron, les tâches de fond s'exécutent pendant la navigation.*
