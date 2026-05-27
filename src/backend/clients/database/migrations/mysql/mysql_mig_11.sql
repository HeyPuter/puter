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

-- Worker session uniqueness. Each Puter worker is a separately-deployed
-- code unit (its own subdomain), so one user can have many workers under
-- the same app — distinguished by `meta.worker_name`. The natural unique
-- key for an active worker session is therefore
-- (user_id, app_uid, worker_name), and app_uid is allowed NULL for
-- user-scoped workers that aren't bound to any specific app.
--
-- Implemented the same way as `app_unique_key` from mig_9: a VIRTUAL
-- generated column that's non-NULL only for the rows under the rule,
-- then a UNIQUE INDEX on the column. NULLs don't conflict in MySQL
-- UNIQUE indexes, so soft-revoked / non-worker rows fall out
-- automatically. IFNULL normalises NULL `app_uid` so two user-scoped
-- workers with the same name still dedupe. JSON_UNQUOTE strips the
-- JSON value quoting from JSON_EXTRACT so the concatenated key is a
-- plain string that matches the SELECT path's binding.
--
-- Idempotent: each ADD COLUMN / ADD INDEX is guarded so the migration
-- directory can be replayed safely.

DROP PROCEDURE IF EXISTS _puter_sessions_worker_unique;
DELIMITER //
CREATE PROCEDURE _puter_sessions_worker_unique()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sessions' AND COLUMN_NAME = 'worker_unique_key'
  ) THEN
    ALTER TABLE `sessions`
      ADD COLUMN `worker_unique_key` VARCHAR(550)
        GENERATED ALWAYS AS (
          IF(`kind` = 'worker' AND `revoked_at` IS NULL,
             CONCAT(`user_id`, '|', IFNULL(`app_uid`, ''), '|',
                    IFNULL(JSON_UNQUOTE(JSON_EXTRACT(`meta`, '$.worker_name')), '')),
             NULL)
        ) VIRTUAL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sessions'
      AND INDEX_NAME = 'idx_sessions_user_worker_active'
  ) THEN
    ALTER TABLE `sessions`
      ADD UNIQUE INDEX `idx_sessions_user_worker_active` (`worker_unique_key`);
  END IF;
END//
DELIMITER ;

CALL _puter_sessions_worker_unique();

DROP PROCEDURE IF EXISTS _puter_sessions_worker_unique;
