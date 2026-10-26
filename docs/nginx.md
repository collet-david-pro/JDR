# Configuration Nginx

Nginx ne lit pas les fichiers `.htaccess` : les protections et la réécriture d'URL fournies pour Apache doivent être reproduites dans la configuration du serveur. Si vous ne pouvez pas modifier cette configuration (hébergement géré), installez en **mode `query`** (voir plus bas) et vérifiez la protection des dossiers privés avec le diagnostic de l'installeur.

## Exemple complet (PHP-FPM)

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name jdr.example.org;

    root /var/www/jdr;          # dossier contenant index.php
    index index.php;

    client_max_body_size 16m;   # >= limite d'import des assets

    # --- Fichiers et dossiers privés : jamais servis -------------------------
    location ~ ^/(app|migrations|storage|i18n)(/|$) { deny all; }
    location = /config.php                        { deny all; }
    location ~ /\.(?!well-known/)                  { deny all; }   # .htaccess, .git…

    # --- Flux temps réel (SSE) : aucune mise en tampon, aucune compression --
    location = /api/v1/stream {
        gzip off;
        fastcgi_buffering off;
        fastcgi_read_timeout 60s;
        rewrite ^ /index.php break;   # exécute index.php ; REQUEST_URI reste /api/v1/stream
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root/index.php;
        fastcgi_pass unix:/run/php/php8.3-fpm.sock;
    }

    # --- Front compilé : noms hachés, cache long ------------------------------
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }

    # Service Worker : toujours revalidé
    location = /sw.js {
        add_header Cache-Control "no-cache";
        try_files $uri =404;
    }

    # --- Tout le reste passe par le contrôleur frontal (mode rewrite) -------
    location / {
        try_files $uri /index.php?$query_string;
    }

    # Seuls les scripts d'entrée de la racine sont exécutés
    location ~ ^/(index|install|update|cron)\.php$ {
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_pass unix:/run/php/php8.3-fpm.sock;
    }
    location ~ \.php$ { return 404; }
}
```

Adapter le chemin du socket PHP-FPM (`fastcgi_pass`) à votre installation. Pour une installation dans un sous-dossier (`/jdr/`), préfixer les `location` et la cible de `try_files` (`/jdr/index.php?$query_string`).

## Points importants

- **Dossiers privés** : `app/`, `migrations/`, `storage/`, `i18n/` et `config.php` ne doivent jamais être accessibles. L'application les protège aussi par une garde en tête de chaque fichier PHP et un `index.php` qui renvoie 403, mais la règle Nginx reste nécessaire pour les fichiers non PHP (journaux, sauvegardes, assets privés de `storage/`).
- **Mieux encore** : placer `storage/` hors de la racine web (`storage_path` dans `config.php`, proposé par l'installeur).
- **SSE** (`/api/v1/stream`) : `fastcgi_buffering off` et `gzip off` sont indispensables, sinon les événements restent bloqués dans les tampons. L'application envoie aussi `X-Accel-Buffering: no`, que Nginx respecte, ce qui couvre l'accès en mode `query`. Si le flux reste tamponné, le client bascule automatiquement en long polling puis en polling court.
- **PHP-FPM** : chaque flux SSE occupe un processus PHP pendant environ 25 s. Prévoir `pm.max_children` suffisant (au moins 2 par appareil connecté en séance, plus la marge des requêtes normales) et `request_terminate_timeout` ≥ 60 s (ou 0).
- **HTTP/2** recommandé : il lève la limite de 6 connexions simultanées par domaine du HTTP/1.1.
- **Proxy devant Nginx** (Cloudflare, répartiteur…) : il doit lui aussi laisser passer `text/event-stream` sans tampon, sinon le repli long polling prend le relais.

## Mode `query` (sans réécriture)

Si `try_files` ne peut pas être configuré, choisir `routing_mode = 'query'` (l'installeur le détecte) : toutes les URL deviennent `index.php?r=/chemin` (ex. `index.php?r=/api/v1/health`) et le front utilise un routage par `#`. Les règles de protection des dossiers privés restent nécessaires.

## Vérification

```bash
curl -i https://jdr.example.org/api/v1/health                 # 200
curl -i 'https://jdr.example.org/index.php?r=/api/v1/health'  # 200 (mode query)
curl -i https://jdr.example.org/config.php                    # 403 ou 404
curl -i https://jdr.example.org/app/bootstrap.php             # 403 ou 404
curl -i https://jdr.example.org/storage/index.php             # 403 ou 404
curl -i https://jdr.example.org/migrations/0001_initial.sql   # 403 ou 404
curl -N -H 'Cookie: jdr_sid=…' 'https://jdr.example.org/api/v1/stream?channels=session:1'   # voir ci-dessous
```

## Vérifier le flux temps réel

Le temps réel d'une séance repose sur `GET /api/v1/stream` (SSE). Pour vérifier que rien ne le met en tampon, se connecter dans le navigateur, copier la valeur du cookie `jdr_sid` (outils de développement, onglet Stockage) et lancer :

```bash
curl -N -H 'Cookie: jdr_sid=VALEUR' 'https://jdr.example.org/api/v1/stream?channels=session:ID'
```

`ID` est l'identifiant d'une séance dont on est le MJ ou un joueur (visible dans l'URL `/sessions/ID`). Attendu : un bloc de remplissage (commentaire de 2 Ko), `retry: 1500` et un premier `event: ping` **immédiatement** ; un nouveau `event: ping` toutes les 10 s ; la connexion se termine d'elle-même après 25 s (le navigateur se reconnecte). Les événements de la séance (`event: session.state`, `event: maptoken.moved`…) apparaissent au moment où le MJ agit.

Symptôme d'un tampon : rien ne s'affiche pendant environ 25 s, puis tout arrive d'un coup à la fin de la réponse. Les joueurs ne sont pas bloqués : après 5 s de silence leur navigateur bascule en long polling, puis en polling si besoin (indicateur réseau de la vue joueur, `docs/realtime.md`). C'est normal mais moins réactif : désactiver `proxy_buffering` / `fastcgi_buffering` pour `/api/v1/stream` (exemple ci-dessus) ou le tampon du proxy en amont.
