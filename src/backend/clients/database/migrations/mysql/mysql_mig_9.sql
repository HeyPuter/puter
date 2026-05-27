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

-- Composite-key lookups + audit columns. Mirrors
-- SQLite migration 0052. MySQL has no partial unique indexes, so the
-- "at most one active row per (user_id, app_uid)" / "one active row
-- per legacy_token_uid" semantics are encoded via VIRTUAL generated
-- columns that are NULL when the row isn't subject to the rule —
-- MySQL allows multiple NULLs in a UNIQUE index, so non-applicable
-- rows don't conflict.
--
-- Idempotent: each ADD COLUMN / ADD INDEX is guarded so the migration
-- directory can be replayed safely.

DROP PROCEDURE IF EXISTS _puter_sessions_v2_lookups;
DELIMITER //
CREATE PROCEDURE _puter_sessions_v2_lookups()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sessions' AND COLUMN_NAME = 'app_uid'
  ) THEN
    ALTER TABLE `sessions` ADD COLUMN `app_uid` VARCHAR(64) DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sessions' AND COLUMN_NAME = 'legacy_token_uid'
  ) THEN
    ALTER TABLE `sessions`
      ADD COLUMN `legacy_token_uid` VARCHAR(64) DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sessions' AND COLUMN_NAME = 'created_via'
  ) THEN
    ALTER TABLE `sessions` ADD COLUMN `created_via` VARCHAR(32) DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sessions' AND COLUMN_NAME = 'auth_id'
  ) THEN
    ALTER TABLE `sessions` ADD COLUMN `auth_id` VARCHAR(64) DEFAULT NULL;
  END IF;

  -- Generated discriminant: non-NULL only for active app-authorization rows,
  -- so UNIQUE(app_unique_key) enforces "one active app session per
  -- (user_id, app_uid)" while permitting any number of revoked rows.
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sessions' AND COLUMN_NAME = 'app_unique_key'
  ) THEN
    ALTER TABLE `sessions`
      ADD COLUMN `app_unique_key` VARCHAR(150)
        GENERATED ALWAYS AS (
          IF(`kind` = 'app' AND `revoked_at` IS NULL,
             CONCAT(`user_id`, '|', `app_uid`),
             NULL)
        ) VIRTUAL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sessions' AND COLUMN_NAME = 'legacy_token_unique_key'
  ) THEN
    ALTER TABLE `sessions`
      ADD COLUMN `legacy_token_unique_key` VARCHAR(64)
        GENERATED ALWAYS AS (
          IF(`revoked_at` IS NULL, `legacy_token_uid`, NULL)
        ) VIRTUAL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sessions'
      AND INDEX_NAME = 'idx_sessions_user_app_active'
  ) THEN
    ALTER TABLE `sessions`
      ADD UNIQUE INDEX `idx_sessions_user_app_active` (`app_unique_key`);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sessions'
      AND INDEX_NAME = 'idx_sessions_legacy_token_active'
  ) THEN
    ALTER TABLE `sessions`
      ADD UNIQUE INDEX `idx_sessions_legacy_token_active`
        (`legacy_token_unique_key`);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sessions'
      AND INDEX_NAME = 'idx_sessions_kind_user'
  ) THEN
    ALTER TABLE `sessions`
      ADD INDEX `idx_sessions_kind_user` (`kind`, `user_id`);
  END IF;
END//
DELIMITER ;

CALL _puter_sessions_v2_lookups();

DROP PROCEDURE IF EXISTS _puter_sessions_v2_lookups;
