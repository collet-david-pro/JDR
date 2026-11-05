# app/Domain/Integrity

Contrôle d'intégrité (quotas, fichiers d'assets, références) avec corrections proposées.

## Fichiers clés

- `IntegrityScanner.php` : analyse par tranches sous un budget de temps
- `IntegrityFixer.php` : applique une correction après avoir recalculé le problème
- `Issue.php` : problème identifié par `type:sujet`, certains destructifs

## Invariants

- Une correction recalcule d'abord son problème : rien n'est fait sur la foi d'un résultat périmé.
- Les corrections destructives sont signalées par `Issue::destructive()`.

## Tests

- `tests/php/Integrity/`
