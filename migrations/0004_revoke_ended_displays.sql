-- 0004_revoke_ended_displays: projection screens no longer survive the end of their session (etapes P7g).
-- Compatible MySQL 5.7+ / MariaDB 10.3+. Replayable: a plain DELETE (nothing left to delete the second time).
--
-- From now on ending a session revokes all its screens (display.revoked + deletion). This removes
-- the screens of the sessions that were ended before. No event: nobody is usefully listening.
DELETE d FROM `{{prefix}}session_displays` d
  JOIN `{{prefix}}play_sessions` s ON s.`id` = d.`session_id`
  WHERE s.`state` = 'ended';
