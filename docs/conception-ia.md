# Conçu avec l'IA

Clairvoie n'existerait pas sans l'intelligence artificielle. Le projet est né d'une idée et d'un besoin de maître de jeu, mais tout le code (le serveur PHP, l'interface Svelte, le moteur de rendu, la génération procédurale, les milliers de tests) a été écrit avec **[Claude Code](https://claude.com/claude-code)**, l'assistant de développement d'Anthropic, et plusieurs modèles **Claude**. Sans eux, un projet de cette taille, développé par une seule personne en quelques semaines, n'aurait tout simplement pas été possible.

Le partage des rôles est clair. **L'auteur** décide : il a rédigé la spécification complète du projet (ce que l'outil doit faire, et surtout ce qu'il ne doit pas faire), il découpe le travail en phases, tranche chaque décision structurante (proposée avec ses alternatives), teste le résultat et choisit ce qui est publié. **L'IA** conçoit les solutions techniques, écrit le code, les tests et la documentation, et rend compte de ce qu'elle a fait, de ses choix et de ses doutes.

Le développement suit une méthode d'**orchestration** :

- un modèle principal (**Claude Opus 5.5**) joue le rôle de chef de projet technique : il prépare chaque phase (découpage en morceaux, contrat d'API, décisions à valider), rédige pour chaque morceau un **brief** court et autosuffisant, puis intègre le travail rendu ;
- chaque morceau est confié à un **agent** distinct : **Claude Sonnet 5.5** pour la plupart, **Claude Opus 5.5** pour les parties les plus délicates (algorithmes de génération, filtrage anti-fuite des séances, module de mise à jour qui réécrit les fichiers du site), **Claude Haiku 5.5** pour de la rédaction simple ; plusieurs agents peuvent travailler en parallèle sur des fichiers distincts ;
- à chaque intégration, **toutes les suites de tests** (PHPUnit, Vitest, vérification des types, lint, build, tests de bout en bout Playwright sur Chromium, Firefox et WebKit) sont lancées en local ; les défauts trouvés sont corrigés avant tout commit, et chaque commit indique la participation de l'IA (`Co-Authored-By`) ;
- un journal par phase garde la trace des décisions, des écarts et des dettes techniques, ce qui permet de reprendre le travail d'une session à l'autre sans rien perdre.

Cette façon de travailler n'enlève rien à l'exigence : chaque fonctionnalité a des critères d'acceptation vérifiés par des tests automatisés, et rien n'est poussé ni publié sans l'accord de l'auteur. Elle montre surtout qu'un passionné, avec une idée précise et de bons outils, peut aujourd'hui construire et maintenir seul un logiciel complet.

---

*P.-S. : même ce README a été rédigé par Claude Code. L'auteur s'est contenté de lui dire quoi écrire… ce qui, à bien y réfléchir, est exactement le rôle d'un maître de jeu : il décrit la scène, et quelqu'un d'autre lance les dés.* 🎲
