# app/Domain/Jobs

Tâches longues découpées en tranches, pilotées par le navigateur (`POST /jobs/{id}/step`).

## Fichiers clés

- `JobRunner.php` : exécute une tranche sous verrou, annule
- `JobHandler.php` : interface : `step()` travaille jusqu'à l'échéance, `cleanup()` libère
- `Job.php, JobRepository.php` : ligne `background_jobs`, progression `{done,total,state}`

## Invariants

- Une seule tranche à la fois par tâche (verrou `GET_LOCK`).
- Une exception marque la tâche en échec ; `cleanup()` est appelé après annulation ou échec.
- Le champ `state` de la progression est privé au gestionnaire.

## Tests

- `tests/php/Assets/PacksApiTest.php`
- `tests/php/Backup/`
