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

-- Handlers an app's user published into their own scope, kept apart from
-- `event_handlers` so code that predates them never reads them. See
-- sqlite/0101_user-scoped-handlers.sql for the column rationale.
--
-- Idempotent: `CREATE TABLE IF NOT EXISTS` with the indexes declared inline,
-- and a guarded column add. There is no per-file applied-state tracking, so a
-- replay has to be a no-op.

CREATE TABLE IF NOT EXISTS `event_user_handlers` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    -- Matches `apps`.`uid` exactly, charset included, so an equality against
    -- one never falls back to a conversion.
    `app_uid` char(40) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL,
    `holder_user_id` int unsigned NOT NULL,
    `name` varchar(128) NOT NULL,
    `source` mediumtext NOT NULL,
    `source_hash` char(64) NOT NULL,
    `created_at` bigint NOT NULL,
    `updated_at` bigint NOT NULL,
    -- When the scope first held a handler; kept across handler churn, so the
    -- rent sweep sees the scope's age, not its oldest remaining handler's.
    `scope_since` bigint NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `idx_event_user_handlers_app_holder_name` (`app_uid`, `holder_user_id`, `name`),
    KEY `idx_event_user_handlers_holder_app` (`holder_user_id`, `app_uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Guarded here rather than through `_puter_add_col`, so the file also applies
-- on its own to a database that never ran the earlier migrations.
DROP PROCEDURE IF EXISTS _puter_add_event_subscriptions_handler_scope;
DELIMITER //
CREATE PROCEDURE _puter_add_event_subscriptions_handler_scope()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'event_subscriptions'
      AND COLUMN_NAME = 'handler_scope'
  ) THEN
    ALTER TABLE `event_subscriptions`
      ADD COLUMN `handler_scope` tinyint unsigned NOT NULL DEFAULT 0,
      ALGORITHM=INSTANT;
  END IF;
END//
DELIMITER ;

CALL _puter_add_event_subscriptions_handler_scope();

DROP PROCEDURE IF EXISTS _puter_add_event_subscriptions_handler_scope;
