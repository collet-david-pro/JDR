# Installation

JDR s'installe sur un hébergement PHP/MySQL mutualisé classique (OVH, o2switch, Hostinger, Ionos…), **sans SSH, sans Composer et sans tâche cron obligatoire** : on envoie les fichiers par FTP, puis on ouvre `install.php` dans le navigateur. Comptez moins de 3 minutes une fois les fichiers envoyés.

## Prérequis de l'hébergement

| Élément | Exigence |
|---|---|
| PHP | **8.1** ou plus récent |
| Extensions PHP obligatoires | `pdo_mysql`, `mbstring`, `json`, `fileinfo`, `gd` (PNG, JPEG, WebP, GIF), `zlib`, `openssl`, `ctype`, `session` |
| Extensions facultatives | `imagick` (meilleure qualité d'image), `apcu`, `zip`, `sodium` |
| Base de données | MySQL **5.7+** ou MariaDB **10.3+**, moteur InnoDB, jeu de caractères `utf8mb4` |
| Droits de l'utilisateur de la base | `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, `INDEX`, `REFERENCES`, `DROP` |
| Serveur web | Apache (fichiers `.htaccess`), LiteSpeed, ou Nginx (voir [nginx.md](nginx.md)) |
| Conseillé | HTTPS, `memory_limit` ≥ 128 Mo (256 Mo idéal), `upload_max_filesize` et `post_max_size` ≥ 10 Mo |

La réécriture d'adresses (`mod_rewrite`) est **conseillée mais pas obligatoire** : sans elle, le site fonctionne en mode « sans réécriture » (voir plus bas).

L'assistant vérifie tout cela lui-même à l'étape 1 et explique quoi faire en cas de problème.

## Installation pas à pas

1. Téléchargez l'archive `jdr-vX.Y.Z-full.zip` et décompressez-la sur votre ordinateur.
2. Avec votre client FTP (FileZilla…), envoyez **tout le contenu** du dossier décompressé dans le dossier web du site (souvent `www/` ou `public_html/`), à la racine ou dans un sous-dossier (`www/jdr/`).
   - Affichez les fichiers cachés dans votre client FTP : les fichiers `.htaccess` doivent être envoyés, ils protègent les dossiers privés.
3. Dans le panneau de l'hébergeur, créez une base de données MySQL et notez : serveur, port, nom de la base, utilisateur, mot de passe. (L'assistant peut aussi créer la base si l'utilisateur en a le droit.)
4. Ouvrez `https://votre-site/install.php` (ou `https://votre-site/jdr/install.php`) et suivez les 6 étapes.

### Étape 1 — Prérequis

Un tableau vert / orange / rouge résume l'état du serveur :

- **rouge** : bloquant, l'installation est impossible tant que le point n'est pas corrigé (bouton « Revérifier ») ;
- **orange** : recommandation, l'installation reste possible.

L'assistant fait aussi de **vraies requêtes HTTP** vers votre site pour :

- détecter si la réécriture d'adresses fonctionne (mode `rewrite`) ou non (mode `query`) ;
- vérifier que les dossiers privés `app/` et `storage/` ne sont **pas** lisibles depuis le web (ils doivent répondre « 403 » ou « 404 »). Si l'un d'eux est lisible, le point est rouge : vérifiez que les fichiers `.htaccess` ont bien été envoyés, ou appliquez les règles de [nginx.md](nginx.md).

Si votre hébergeur interdit au serveur de s'appeler lui-même, ces deux points passent en orange : l'assistant choisit alors le mode sans réécriture par prudence, et vous indique comment vérifier la protection à la main (ouvrir `https://votre-site/app/canary.txt` doit afficher une erreur).

### Étape 2 — Base de données

Saisissez les informations fournies par l'hébergeur et le **préfixe des tables** (`jdr_` par défaut ; il permet plusieurs installations dans la même base). Le bouton « Tester et continuer » vérifie : la connexion, la version du serveur, InnoDB, `utf8mb4`, les droits (création puis suppression de deux tables de test) et l'écart d'horloge.

Si des tables portent déjà ce préfixe, l'assistant vous laisse le choix :

- **Annuler** : rien n'est touché ; vous pouvez choisir un autre préfixe ;
- **Reprendre** une installation interrompue (proposé seulement si ces tables viennent de JDR) ;
- **Écraser** : les tables seront supprimées, après une double confirmation (case à cocher **et** saisie du préfixe). La suppression n'a lieu qu'au lancement de l'étape 5.

Rien n'est écrit sur le serveur avant l'étape 5 (hormis la création éventuelle de la base et les tests ci-dessus).

### Étape 3 — Site

Nom du site, adresse (détectée automatiquement), langue, mode d'inscription (ouvertes, fermées, sur invitation), espace par utilisateur, limites d'import. Tous ces réglages restent modifiables ensuite dans l'administration.

**Emplacement des fichiers** : par défaut, le dossier `storage/` du site (protégé). Si votre hébergeur vous donne accès à un dossier **hors de la racine web** (par exemple `/home/compte/jdr-storage`), choisissez-le : c'est plus sûr. L'assistant refuse un dossier situé dans la partie publique du site.

### Étape 4 — Administrateur

E-mail, pseudo (3 à 40 caractères : lettres, chiffres, espace, `_ . -`) et mot de passe (10 caractères minimum, les mots de passe trop courants sont refusés). Le mot de passe est immédiatement chiffré de façon irréversible : il n'est conservé en clair nulle part.

### Étape 5 — Installation

Un récapitulatif s'affiche ; cliquez sur « Lancer l'installation ». L'assistant enchaîne alors, **une étape par requête** (pour respecter les limites de durée des hébergements mutualisés) :

1. création des tables (migrations `0001`, `0002`…) et des données initiales ;
2. enregistrement des réglages du site et création du compte administrateur ;
3. création de l'arborescence `storage/` et de ses protections ;
4. écriture de `config.php` (droits `0640`) ;
5. verrouillage (`storage/install.lock`).

La page avance toute seule, **avec ou sans JavaScript** (sans JavaScript, elle se recharge automatiquement). Un journal affiche chaque étape.

**En cas d'erreur ou d'interruption** (coupure réseau, onglet fermé, délai dépassé) : corrigez la cause si besoin, puis cliquez sur « Réessayer » ou rouvrez simplement `install.php`. L'installation **reprend là où elle s'est arrêtée** : les migrations déjà appliquées ne sont pas rejouées. Si vous avez fermé le navigateur, refaites les étapes 1 à 4 avec les mêmes informations et choisissez « Reprendre » à l'étape 2.

#### Si `config.php` ne peut pas être écrit

Quand le dossier du site n'est pas inscriptible par PHP, l'assistant affiche le contenu complet de `config.php` :

1. copiez ce contenu dans un fichier texte nommé exactement `config.php` (encodage UTF-8) ;
2. envoyez-le par FTP à la racine du site, à côté de `index.php` et `install.php` ;
3. cliquez sur « J'ai déposé le fichier, vérifier ».

Ce contenu contient des secrets (mot de passe de la base, clé de l'application) : ne le partagez pas et ne le laissez pas traîner sur votre ordinateur.

### Étape 6 — Terminé

L'assistant tente de supprimer `install.php`. S'il n'y parvient pas, le fichier reste de toute façon **verrouillé** (il refuse de fonctionner tant que `config.php` ou `storage/install.lock` existe) ; supprimez-le tout de même par FTP par précaution.

La page indique aussi l'adresse du cron facultatif (voir plus bas). Cliquez ensuite sur « Se connecter ».

## Mode sans réécriture d'adresses

Si `mod_rewrite` n'est pas disponible, JDR fonctionne quand même :

- l'API est appelée en `index.php?r=/api/v1/…` ;
- les pages utilisent des adresses de la forme `https://votre-site/#/games/12`.

Le mode est enregistré dans `config.php` (`'routing_mode' => 'query'`). Si la réécriture devient disponible plus tard, remplacez la valeur par `'rewrite'`.

## Le fichier `config.php`

Généré par l'assistant, il ne doit jamais être partagé ni versionné. Exemple (valeurs fictives) :

```php
<?php

defined('JDR_BOOT') || exit;

return [
    'db' => [
        'host' => 'localhost',
        'port' => 3306,
        'name' => 'ma_base',
        'user' => 'mon_utilisateur',
        'pass' => 'mot de passe de la base',
        'prefix' => 'jdr_',
    ],
    'base_url' => 'https://votre-site.fr',
    'routing_mode' => 'rewrite', // rewrite | query
    'storage_path' => __DIR__ . '/storage',
    'app_secret' => '128 caractères hexadécimaux aléatoires',
    'cron_key' => 'clé aléatoire',
    'debug' => false,
    'cookie_secure' => true, // true si le site est en HTTPS
];
```

Écrire ce fichier à la main n'est utile qu'en dernier recours (la base doit alors avoir été créée par l'assistant) : utilisez de préférence l'assistant, qui génère `app_secret` et `cron_key` de façon sûre.

## Réinstaller

L'assistant refuse de fonctionner sur un site déjà installé. Pour repartir de zéro :

1. **sauvegardez** vos données (administration, ou export de la base depuis le panneau de l'hébergeur) ;
2. supprimez par FTP `config.php` et `storage/install.lock` ;
3. renvoyez `install.php` s'il a été supprimé ;
4. ouvrez `install.php` : à l'étape 2, choisissez un **nouveau préfixe** pour garder l'ancienne installation, ou **Écraser** pour supprimer ses tables.

Les fichiers importés (dossier `storage/assets/`) ne sont pas supprimés par l'assistant : videz-le à la main si vous repartez réellement de zéro.

## Tâches planifiées (facultatif)

Sans cron, les tâches de fond (purges, corbeille, rotation des journaux…) s'exécutent pendant la navigation. Si votre hébergeur propose des tâches « cron », programmez **toutes les 5 minutes** l'appel de l'adresse affichée à la fin de l'installation :

```
https://votre-site/cron.php?key=VOTRE_CLE_CRON
```

La clé est la valeur `cron_key` de `config.php` ; gardez-la secrète. En ligne de commande : `php cron.php --key=VOTRE_CLE_CRON`.

## Dépannage

| Symptôme | Cause probable et solution |
|---|---|
| Page blanche ou « PHP 8.1 requis » | Changez la version de PHP dans le panneau de l'hébergeur. |
| Erreur 500 sur tout le site | L'hébergeur interdit une directive de `.htaccess` : supprimez la ligne `Options -Indexes` du `.htaccess` racine. |
| « Dossier privé lisible depuis le web » | Fichiers `.htaccess` non envoyés (fichiers cachés) ou serveur Nginx : voir [nginx.md](nginx.md). |
| « Accès refusé » à l'étape 2 | Utilisateur ou mot de passe de la base erroné. |
| « Serveur injoignable » à l'étape 2 | Mauvais serveur ou port (souvent `localhost`, sinon l'adresse donnée par l'hébergeur). |
| « Droits manquants » | Accordez les droits listés à l'utilisateur de la base dans le panneau de l'hébergeur. |
| L'assistant revient à l'étape 1 à chaque page | Les cookies sont bloqués, ou `session.save_path` n'est pas inscriptible (point orange à l'étape 1). |
| Interruption pendant l'installation | Rouvrez `install.php` : l'installation reprend (voir étape 5). |

## Mise à jour

Deux voies, au choix. Dans les deux cas, l'archive `jdr-update-vX.Y.Z.zip` ne contient ni `config.php`, ni `storage/`, ni `install.php` : vos réglages, vos données et vos fichiers envoyés ne sont jamais touchés. Son empreinte officielle (SHA-256) est publiée dans le fichier `SHA256SUMS` de chaque release, ce qui permet au site de reconnaître une archive officielle.

### 1. Depuis la console d'administration (recommandé)

1. Connectez-vous en administrateur, puis ouvrez **Administration > Mise à jour**.
2. Cliquez sur **Vérifier les mises à jour** : le site interroge GitHub et affiche la dernière version, ses notes et un lien **Télécharger le zip de mise à jour**. Si le serveur ne peut pas joindre GitHub, ouvrez la [page des releases](https://github.com/collet-david-pro/JDR/releases) depuis votre navigateur.
3. Téléchargez le zip sur votre ordinateur (ne le décompressez pas), puis envoyez-le avec **Envoyer un zip de mise à jour**. L'envoi se fait par petits morceaux (100 Mo au maximum), indépendamment des limites `upload_max_filesize` et `post_max_size` de PHP.
4. Vérifiez le récapitulatif (versions, fichiers ajoutés, modifiés ou supprimés, migrations, authenticité). Une archive dont l'empreinte n'a pas pu être comparée à l'empreinte officielle est signalée : vous devez cocher la case de confirmation pour l'installer.
5. Cliquez sur **Installer** : la page `update.php` enchaîne la mise en maintenance du site, la sauvegarde de la base de données dans `storage/backups/` (fichier `.sql.gz`), la sauvegarde des fichiers remplacés, la copie des nouveaux fichiers, le contrôle d'intégrité puis les migrations. Gardez la page ouverte jusqu'à « Mise à jour terminée ».

Si la copie des fichiers échoue, les fichiers précédents sont remis en place automatiquement. Si une migration échoue, le site reste en maintenance et `update.php` propose **Réessayer** (après avoir corrigé la cause, par exemple un droit manquant sur la base) ou **Restaurer** la version précédente à partir de la sauvegarde faite au début. Une mise à jour interrompue (fermeture de l'onglet, coupure) se reprend depuis l'onglet Mise à jour (bouton **Reprendre**) ou en rouvrant `update.php`.

### 2. Par FTP

1. Téléchargez `jdr-update-vX.Y.Z.zip`, décompressez-le et envoyez son contenu **par-dessus** l'installation.
2. Ouvrez `update.php` à la racine du site et connectez-vous en administrateur : il termine la mise à jour (contrôle d'intégrité des fichiers envoyés grâce à `manifest.json`, sauvegarde de la base, migrations) comme décrit ci-dessus.

Tant que la mise à jour n'est pas terminée, le site reste en maintenance si la base de données est en retard sur le code.

La mise à jour automatique, sans téléchargement manuel du zip, viendra dans une version ultérieure.

## Développement local

Avec le serveur intégré de PHP, lancez-le **avec plusieurs processus** (l'assistant s'appelle lui-même pour tester la réécriture et la protection des dossiers) :

```bash
PHP_CLI_SERVER_WORKERS=4 php -S 127.0.0.1:8000 index.php
```

Dans une copie de développement (dossier `.git` présent), l'assistant ne supprime pas `install.php` à la fin.
