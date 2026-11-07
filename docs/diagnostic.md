# Diagnostic et dépannage

Cette page présente les outils de contrôle de l'administration et les solutions aux problèmes les plus courants. Pour l'installation, voir [installation.md](installation.md). Pour la sécurité, voir [securite.md](securite.md).

## Le diagnostic

Ouvrez **Administration > Diagnostic**. La page liste des contrôles, chacun avec un état : **OK**, **Attention** (orange) ou **Erreur** (rouge). Le bouton **Relancer** refait les contrôles.

Elle vérifie notamment :

- la version de PHP, la version de MySQL ou MariaDB, la version du site, l'état de la base par rapport au code ;
- les extensions PHP obligatoires et facultatives (dont `sodium`), les formats d'image de GD ;
- `upload_max_filesize`, `post_max_size`, `memory_limit`, `max_execution_time`, `output_buffering`, `zlib.output_compression` ;
- le stockage des sessions, le mode de routage, HTTPS ;
- l'écriture dans `storage/`, la protection des dossiers privés, le décalage d'horloge entre PHP et la base, l'espace disque libre ;
- la taille de la base et le nombre d'assets ;
- l'intégrité des fichiers du site (comparés à `manifest.json`) ;
- le flux temps réel et les connexions en attente.

Chaque ligne en orange ou en rouge s'accompagne d'une explication. Corrigez d'abord les rouges.

## Bibliothèque générale vide : le pack de base

Le pack d'images de base s'installe à la fin de l'installation et après une mise à jour qui le modifie (par tranches, au passage du cron ou du pseudo-cron). Si la bibliothèque générale est vide ou incomplète, ouvrez **Administration > Intégrité** et cliquez sur **Installer / réparer le pack de base**. Après confirmation, le site importe les images manquantes, retente celles qui avaient échoué et affiche un compte rendu : installées, déjà présentes, en échec (avec la raison). L'action est inscrite au journal d'audit. Causes fréquentes d'un échec : dossier `app/Seed/base-pack/` incomplet après un envoi FTP, droits d'écriture sur `storage/`, extension GD sans PNG/WebP, `memory_limit` trop bas ; voir `storage/logs/`.

### Tester le flux temps réel

Dans la section « Flux temps réel », le bouton **Tester le flux temps réel** envoie 3 messages à une seconde d'intervalle. Trois résultats possibles :

- « Les messages arrivent au fil de l'eau » : tout va bien.
- « Les messages arrivent groupés » : l'hébergeur met le flux en mémoire tampon. Le site bascule seul sur l'attente longue (« long polling »). Les séances fonctionnent, avec un peu de retard.
- « Flux interrompu » : le site utilise le mode de repli.

Pour le détail des modes, voir [realtime.md](realtime.md).

## Intégrité des données

Ouvrez **Administration > Intégrité**. Cette page compare la base et les fichiers. Elle cherche :

- des quotas de stockage inexacts et des tailles de fichiers inexactes ;
- des assets dont le fichier manque, des fichiers orphelins (sans asset) ;
- des références d'assets de maps inexactes ;
- des blocs de map ou des brouillards illisibles ;
- des révisions de map incohérentes ;
- des maps qui utilisent un asset mis à la corbeille.

### Vérifier

1. Cliquez sur **Lancer la vérification**. Elle avance par tranches (« Vérification en cours : x / y ») et peut être annulée.
2. Les problèmes sont groupés par type, avec leur gravité (Erreur ou Avertissement). Sinon : « Aucun problème détecté ».

**Rien n'est modifié sans votre action.**

### Corriger

- Chaque problème a, s'il y en a une, sa propre action : **Recalculer le quota**, **Mettre à jour les tailles**, **Recalculer les références**, **Remonter la révision**, **Supprimer l'asset**, **Supprimer le fichier**, **Supprimer le bloc**, **Supprimer le brouillard**.
- Le bouton **Tout recalculer** applique d'un coup les recalculs sans risque.
- Toute **suppression** demande une confirmation (« N élément(s) vont être supprimés définitivement. Cette action est irréversible. »). **Faites une sauvegarde avant** (voir [sauvegarde.md](sauvegarde.md)).
- Les maps qui utilisent un asset supprimé sont signalées, sans correction automatique : remplacez l'asset dans la map ou restaurez-le depuis la corbeille.
- Après correction, relancez la vérification pour confirmer.

Sur un très gros site, la recherche des fichiers orphelins peut être longue.

## Journaux

### Journal d'audit

**Administration > Journal d'audit** garde la trace des actions d'administration (comptes, réglages, mises à jour…).

### Journaux de l'application

Les erreurs du serveur sont écrites dans des fichiers `storage/logs/app-AAAA-MM-JJ.log`, un par jour. Ils se consultent par FTP.

- Ils sont **supprimés automatiquement après 14 jours** (durée prévue pour le respect de la vie privée).
- La purge est faite par une tâche de fond nommée `logs`. Elle tourne avec le cron ou pendant la navigation.
- Joignez les lignes utiles si vous demandez de l'aide, après avoir retiré tout ce qui est personnel.

### Autres durées de conservation

Dans **Administration > Réglages**, section « Limites et conservation » : conservation des événements, versions de map conservées, durée de la corbeille, expiration d'inactivité des sessions.

## Limite de connexions en direct

Chaque appareil en séance garde une connexion ouverte avec le serveur (flux en direct, ou attente longue). Sur un hébergement mutualisé, chaque connexion occupe un processus PHP, et leur nombre est limité par l'hébergeur.

Pour éviter de saturer le serveur, Clairvoie limite ces connexions avec le réglage **Connexions en attente maximales** (`realtime_max_waiting`) :

- valeur par défaut : **4** ;
- au-delà, les appareils suivants passent en **interrogation** : ils demandent des nouvelles au serveur toutes les 2 secondes. Ça marche, mais avec un peu plus de délai (environ 2 secondes) ;
- ils retentent de reprendre une connexion en direct après environ 2 minutes ;
- le réglage se trouve dans **Administration > Réglages**, section « Limites et conservation ». Il accepte des valeurs de 0 à 1000 ; 0 force l'interrogation pour tout le monde.

La ligne « Connexions en attente (occupées / plafond) » du diagnostic montre l'occupation. Si elle est en orange, toutes les places sont prises.

**Quand l'augmenter ?** Si votre hébergeur offre beaucoup de processus PHP et que vous avez plusieurs séances en parallèle. **Quand le garder bas ?** Sur un petit hébergement : mieux vaut une interrogation un peu moins fluide qu'un site qui ne répond plus.

## Retours des utilisateurs (formulaires GitHub)

Le pied de page et la section « Donner son avis » de l'aide proposent deux liens : **Signaler un problème** et **Proposer une idée**. Ils ouvrent, dans un nouvel onglet, un formulaire d'issue GitHub (un compte GitHub est nécessaire) déjà rempli avec la version du site, le navigateur et le motif de la page (par exemple `/games/:id/maps`), sans identifiant, code de séance, jeton ni nom de domaine.

Le dépôt visé se règle dans **Administration > Réglages**, section « Général » (`feedback_repo_url`) :

- par défaut : `https://github.com/collet-david-pro/JDR` ;
- pour un fork, indiquez l'adresse de votre dépôt, strictement de la forme `https://github.com/propriétaire/dépôt` (sinon le réglage est refusé) ;
- champ vide : les liens sont masqués.

Les formulaires sont dans `.github/ISSUE_TEMPLATE/` du dépôt ; un fork doit les conserver pour que le pré-remplissage fonctionne.

## Problèmes courants

| Symptôme | Cause probable et solution |
|---|---|
| Le site est en maintenance et personne ne peut se connecter | Une mise à jour ou une restauration a été interrompue. Ouvrez `update.php` et connectez-vous en administrateur, ou relancez la restauration (voir [mise-a-jour.md](mise-a-jour.md) et [sauvegarde.md](sauvegarde.md)). |
| Diagnostic : « La base est en retard sur le code » | Ouvrez `update.php` pour appliquer les migrations. |
| Diagnostic : « Des fichiers diffèrent de la version livrée ou manquent » | Renvoyez par FTP l'archive de mise à jour de la version installée. |
| « Mise à jour automatique désactivée : l'extension PHP sodium est absente » | Activez `sodium` dans les extensions PHP de l'hébergeur, ou mettez à jour à la main. |
| « La mise à jour automatique vers la version X a échoué » | Lisez le message dans **Administration > Mise à jour**. Réessayez à la main avec l'envoi du zip. |
| « Impossible de joindre GitHub depuis le serveur » | L'hébergeur bloque les appels sortants. Téléchargez le zip depuis la page des releases. |
| Les séances sont lentes ou les mouvements arrivent par à-coups | Lancez le test du flux temps réel. Si « groupés », désactivez `output_buffering` et `zlib.output_compression` si possible. Voir aussi la limite de connexions ci-dessus. |
| Le diagnostic signale « Dossier privé lisible depuis le web » | Les fichiers `.htaccess` n'ont pas été envoyés (fichiers cachés), ou ils sont ignorés. Voir [installation.md](installation.md). |
| Erreur 500 sur tout le site | L'hébergeur refuse une directive de `.htaccess` : retirez la ligne `Options -Indexes` du `.htaccess` racine. |
| Envoi d'images refusé | `upload_max_filesize` ou `post_max_size` trop petits, ou quota de l'utilisateur atteint. |
| Connexion impossible après avoir changé d'adresse | Vérifiez `base_url` dans `config.php` et le réglage d'adresse dans l'administration. |
| Les utilisateurs sont déconnectés sans cesse | Dossier de sessions non inscriptible : activez les sessions en base dans les réglages. |
| Espace disque faible | Videz la corbeille et supprimez les assets inutiles. Vérifiez qu'aucun ancien fichier de sauvegarde ou d'archive ne traîne dans `storage/` ou à la racine du site. |
| Un fichier d'image ne s'affiche plus | Lancez **Administration > Intégrité** : « Assets sans fichier ». Restaurez les assets depuis une sauvegarde. |

Si le problème persiste, lisez les fichiers de `storage/logs/` et, pour une faille de sécurité, suivez [securite.md](securite.md).
