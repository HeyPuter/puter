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

-- Add 'debug_app' to the `sessions.kind` ENUM: a short-lived app session an
-- operator creates on a user's behalf. Mirrors SQLite migration 0105.
--
-- Idempotent: guarded against COLUMN_TYPE so re-running the directory is a
-- no-op once 'debug_app' is in the ENUM.

DROP PROCEDURE IF EXISTS _puter_sessions_kind_debug_app;
DELIMITER //
CREATE PROCEDURE _puter_sessions_kind_debug_app()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sessions'
      AND COLUMN_NAME = 'kind'
      AND FIND_IN_SET('debug_app', REPLACE(REPLACE(REPLACE(COLUMN_TYPE, 'enum(', ''), ')', ''), '''', '')) > 0
  ) THEN
    ALTER TABLE `sessions`
      MODIFY COLUMN `kind`
        ENUM('web', 'app', 'access_token', 'asset', 'worker', 'debug_app')
        NOT NULL DEFAULT 'web',
      ALGORITHM=INSTANT;
  END IF;
END//
DELIMITER ;

CALL _puter_sessions_kind_debug_app();

DROP PROCEDURE IF EXISTS _puter_sessions_kind_debug_app;
