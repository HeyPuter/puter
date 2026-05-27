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

-- Mirrors SQLite migration 0053. Adds the
-- `access_token_uid` reverse-lookup column on `sessions` so raw-uuid
-- revoke can find the matching session row when only the v2 token_uid
-- (no JWT) is presented.
--
-- Idempotent: each ADD COLUMN / ADD INDEX is guarded so the migration
-- directory can be replayed safely.

DROP PROCEDURE IF EXISTS _puter_sessions_access_token_uid;
DELIMITER //
CREATE PROCEDURE _puter_sessions_access_token_uid()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sessions' AND COLUMN_NAME = 'access_token_uid'
  ) THEN
    ALTER TABLE `sessions`
      ADD COLUMN `access_token_uid` VARCHAR(64) DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sessions'
      AND INDEX_NAME = 'idx_sessions_access_token_uid'
  ) THEN
    ALTER TABLE `sessions`
      ADD INDEX `idx_sessions_access_token_uid` (`access_token_uid`);
  END IF;
END//
DELIMITER ;

CALL _puter_sessions_access_token_uid();

DROP PROCEDURE IF EXISTS _puter_sessions_access_token_uid;
