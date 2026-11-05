# app/Core : noyau HTTP et infrastructure

Noyau sans logique métier : noyau d'application (requête vers réponse), routage, conteneur, base de données, session, erreurs, journal, configuration. Tout le reste du dépôt en dépend ; il ne dépend de rien d'autre.

## Fichiers clés

- `App.php` : noyau : construit le conteneur, enchaîne les middlewares, route, répond
- `Router.php / RouteMatch.php` : routage par motifs `{nom}` ou `{nom:regex}`, options de route
- `Pipeline.php` : exécute les middlewares puis le gestionnaire
- `Request.php / Response.php` : requête et réponse ; enveloppe API `{ok, data, meta}` / `{ok:false, error}`
- `Db.php` : enveloppe PDO (connexion paresseuse, préfixe de tables, transactions)
- `Container.php` : conteneur minimal avec autowiring par type de constructeur
- `Cron.php` : tâches de ménage, par cron réel ou pseudo-cron
- `Session/` : session applicative et cookies (backends natif et mémoire)
- `Errors/` : exceptions HTTP typées, converties par `ErrorHandler.php`
- `RateLimiter.php, Signer.php, SecurityHeaders.php` : limitation de débit, signatures HMAC, en-têtes de sécurité

## Invariants

- La base ne contient que des identifiants entiers ; ils sortent en chaînes dans le JSON (`Ids.php`).
- Pas de `unsafe-eval` dans la CSP (`SecurityHeaders.php`).
- Toute exception devient une réponse normalisée par `ErrorHandler` ; aucune trace n'est exposée hors mode debug.
- `SystemStatus` ne lève jamais d'exception : il décrit l'état (base, version de schéma, maintenance).
- Les chemins privés sont refusés une troisième fois par `PathGuard.php`, en plus de `.htaccess`.

## Tests

- `tests/php/Core/ (Config, Container, Cron, I18n, Logger, PathGuard, Request, Response, Router, SecurityHeaders, Signer, SystemStatus)`
- `tests/php/Domain/ (RateLimiter, Session, DbSessionHandler, CronTasks)`
