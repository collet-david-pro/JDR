# Installation sur YunoHost (application My Webapp)

Ce guide décrit l'installation de JDR sur un serveur YunoHost avec l'application **My Webapp**. Il repose sur un cas réel : le site est servi sous un sous-chemin (ici `/jdr/`) et Nginx traite le PHP dans des blocs `location` inclus depuis le dossier de configuration de l'application.

Nginx ne lit pas les fichiers `.htaccess`. Tant que les dossiers privés ne sont pas protégés dans la configuration Nginx, l'installeur signale « Dossier privé lisible depuis le web ». Ce guide ajoute cette protection.

Remplacez `/jdr/` par le chemin que vous avez choisi pour l'application, et `<domaine>` par votre nom de domaine. Pour la configuration Nginx générale, voir aussi [nginx.md](nginx.md).

## 1. Installer l'application et envoyer les fichiers

1. Installez l'application **My Webapp** sur votre domaine, avec le chemin voulu (par exemple `/jdr`).
2. Envoyez **tout le contenu** de `jdr-v0.1.0-alpha.1-full.zip` dans le dossier web de l'application, sans oublier les fichiers cachés. Voir [installation.md](installation.md) pour la préparation de la base de données.
3. Ne lancez pas encore l'installation : protégez d'abord les dossiers privés (étape 3).

## 2. Trouver le fichier de configuration Nginx de l'application

Sur le serveur, listez les configurations du domaine :

```bash
ls /etc/nginx/conf.d/<domaine>.d/
```

Repérez le dossier `<app>.d/` et le fichier `<app>.conf` de votre application, puis affichez leur contenu :

```bash
ls /etc/nginx/conf.d/<domaine>.d/<app>.d/
sudo cat /etc/nginx/conf.d/<domaine>.d/<app>.conf
sudo cat /etc/nginx/conf.d/<domaine>.d/<app>.d/*.conf
```

Vous devez y retrouver :

- une directive `alias` vers le dossier web de l'application ;
- une `location` qui traite le PHP, avec son `fastcgi_pass` ;
- un `try_files ... /jdr/index.php?$args`, qui suffit pour le mode « réécriture » de JDR.

Le dossier `<app>.d/` est conservé par My Webapp lors des mises à jour de l'application : c'est le bon endroit pour vos ajouts.

## 3. Protéger les dossiers privés

Créez, **dans le dossier `<app>.d/`**, un fichier nommé `00-jdr-protect.conf`. Le préfixe `00-` le fait lire avant la règle PHP.

```bash
sudo nano /etc/nginx/conf.d/<domaine>.d/<app>.d/00-jdr-protect.conf
```

Contenu (adaptez `/jdr/` à votre chemin) :

```nginx
location ~ ^/jdr/(app|migrations|storage|i18n)(/|$) { deny all; }
location = /jdr/config.php    { deny all; }
location = /jdr/manifest.json { deny all; }
```

Testez puis rechargez Nginx :

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 4. Vérifier la protection

```bash
curl -sI https://<domaine>/jdr/app/bootstrap.php
```

La réponse doit commencer par `HTTP/2 403` (ou `HTTP/1.1 403`). Vérifiez de la même façon `/jdr/config.php` et `/jdr/migrations/0001_initial.sql`.

Ouvrez ensuite `https://<domaine>/jdr/install.php` et suivez l'assistant. Le diagnostic de l'étape des prérequis ne doit plus signaler de dossier privé lisible.

## 5. Temps réel (facultatif)

Sans configuration particulière, les séances fonctionnent : le navigateur bascule automatiquement du flux SSE vers le long polling. C'est un peu moins réactif (voir [realtime.md](realtime.md)).

Pour obtenir le flux direct (SSE), ajoutez dans le même dossier `<app>.d/` un fichier, par exemple `01-jdr-stream.conf`, avec une `location` dédiée :

```nginx
location = /jdr/api/v1/stream {
    fastcgi_buffering off;
    gzip off;
    # Reprenez ici les directives fastcgi_* de la location PHP de l'application
    # (include fastcgi_params, SCRIPT_FILENAME, et surtout le même fastcgi_pass).
}
```

Les deux directives indispensables sont `fastcgi_buffering off;` et `gzip off;`. Le reste (`fastcgi_pass`, paramètres FastCGI) doit être identique à la configuration PHP de l'application, relevée à l'étape 2. Rechargez Nginx (`sudo nginx -t && sudo systemctl reload nginx`), puis testez le flux avec la commande `curl -N` décrite dans la section « Vérifier le flux temps réel » de [nginx.md](nginx.md).

Si le flux reste tamponné, ne bloquez pas : le repli automatique en long polling garde les séances utilisables.

## Dépannage

| Symptôme | Piste |
|---|---|
| L'installeur signale encore « Dossier privé lisible » | Le fichier n'est pas dans le bon dossier `<app>.d/`, le chemin `/jdr/` ne correspond pas, ou Nginx n'a pas été rechargé. Refaites la vérification `curl` de l'étape 4. |
| `nginx -t` échoue | Erreur de syntaxe dans `00-jdr-protect.conf` : relisez les accolades et les points-virgules. |
| Le fichier a disparu après une mise à jour de l'application | Vérifiez qu'il se trouve bien dans le dossier `<app>.d/` (conservé lors des mises à jour), et non ailleurs. |
