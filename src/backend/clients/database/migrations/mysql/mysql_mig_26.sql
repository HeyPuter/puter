-- Copyright (C) 2024-present Puter Technologies Inc.
--
-- This file is part of Puter.
--
-- Puter is free software: you can redistribute it and/or modify
-- it under the terms of the GNU Affero General Public License as published
-- by the Free Software Foundation, either version 3 of the License, or
-- (at your option) any later version.
--
-- This program is distributed in the hope that it will be useful,
-- but WITHOUT ANY WARRANTY; without even the implied warranty of
-- MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
-- GNU Affero General Public License for more details.
--
-- You should have received a copy of the GNU Affero General Public License
-- along with this program.  If not, see <https://www.gnu.org/licenses/>.

-- Give `notification` a scope tuple: what the row is (`type`), the app it is
-- about (`app_uid`, NULL for platform), and who the recipient is in relation
-- to it (`audience`). Attribution lived inside the `value` JSON as two
-- free-form markers, `source` and `template`, that could disagree; these
-- columns replace them and are what a scoped list can be indexed on.
--
-- `app_uid` is char(40) to match `apps`.`uid`, which is `app-` plus a uuid.
--
-- Idempotent: columns go through `_puter_add_col` (mig_1), the index through
-- the guarded procedure. There is no per-file applied-state tracking, so every
-- statement here tolerates a re-run.

CALL _puter_add_col('notification', 'app_uid', '`app_uid` char(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL');
CALL _puter_add_col('notification', 'audience', '`audience` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''account''');
CALL _puter_add_col('notification', 'type', '`type` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''''');

DROP PROCEDURE IF EXISTS _puter_add_notification_scope_index;
DELIMITER //
CREATE PROCEDURE _puter_add_notification_scope_index()
BEGIN
  -- Serves both the scoped list and the unacknowledged count.
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'notification'
      AND INDEX_NAME = 'idx_notification_scope'
  ) THEN
    ALTER TABLE `notification` ADD INDEX `idx_notification_scope`
      (`user_id`, `audience`, `app_uid`, `acknowledged`);
  END IF;
END //
DELIMITER ;
CALL _puter_add_notification_scope_index();
DROP PROCEDURE IF EXISTS _puter_add_notification_scope_index;

-- Backfill from the markers the payload actually carried. `type = ''` is the
-- not-yet-classified state, so re-running matches nothing the first pass
-- claimed, and a row matching no marker keeps the defaults (`''` / 'account')
-- and reads as legacy.

UPDATE `notification`
SET `type` = 'share.received', `audience` = 'account', `app_uid` = NULL
WHERE `type` = ''
  AND JSON_UNQUOTE(JSON_EXTRACT(`value`, '$.template')) = 'file-shared-with-you';

UPDATE `notification`
SET `type` = 'share.claimed', `audience` = 'account', `app_uid` = NULL
WHERE `type` = ''
  AND JSON_UNQUOTE(JSON_EXTRACT(`value`, '$.template')) = 'file-shared-before-you-joined';

-- Worker rows carried only `source: 'worker'` and a title, so the app they
-- belong to is unrecoverable and they stay unattributed. The title prefix is
-- the sole surviving signal of which way the deploy went.
UPDATE `notification`
SET `audience` = 'developer',
    `app_uid` = NULL,
    `type` = CASE
      WHEN JSON_UNQUOTE(JSON_EXTRACT(`value`, '$.title')) LIKE 'Successfully deployed %'
        THEN 'app.worker.deployed'
      ELSE 'app.worker.deployFailed'
    END
WHERE `type` = ''
  AND JSON_UNQUOTE(JSON_EXTRACT(`value`, '$.source')) = 'worker';
