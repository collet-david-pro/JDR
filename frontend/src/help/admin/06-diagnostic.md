# Le diagnostic

Onglet **Diagnostic** : un contrôle de santé du serveur (versions PHP et base, extensions, dossiers inscriptibles, limites, tâches planifiées…) avec un état OK, Attention ou Erreur pour chaque point. **Relancer** refait le contrôle.

Le bouton **Tester le flux temps réel** vérifie que l'hébergeur transmet les messages au fil de l'eau. S'ils arrivent groupés, le site bascule seul sur un autre mode (long polling ou interrogation régulière) ; le jeu reste possible.
