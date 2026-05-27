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

-- Add 'worker' to the `sessions.kind` ENUM. mig_11 already added the
-- worker uniqueness index and the application code in SessionStore
-- inserts rows with kind='worker', but the ENUM defined in mig_8 never
-- listed 'worker' as a permitted value. Under STRICT_TRANS_TABLES the
-- INSERT fails outright; under a relaxed sql_mode the value is coerced
-- to '' (and the worker SELECT-by-kind path then misses the row).
-- Mirrors SQLite migration 0056.
--
-- Idempotent: guarded against COLUMN_TYPE so re-running the directory is
-- a no-op once 'worker' is in the ENUM.

DROP PROCEDURE IF EXISTS _puter_sessions_kind_worker;
DELIMITER //
CREATE PROCEDURE _puter_sessions_kind_worker()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sessions'
      AND COLUMN_NAME = 'kind'
      AND FIND_IN_SET('worker', REPLACE(REPLACE(REPLACE(COLUMN_TYPE, 'enum(', ''), ')', ''), '''', '')) > 0
  ) THEN
    ALTER TABLE `sessions`
      MODIFY COLUMN `kind`
        ENUM('web', 'app', 'access_token', 'asset', 'worker')
        NOT NULL DEFAULT 'web';
  END IF;
END//
DELIMITER ;

CALL _puter_sessions_kind_worker();

DROP PROCEDURE IF EXISTS _puter_sessions_kind_worker;
