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

-- Suspended-at column. Mirrors SQLite migration 0061. `suspended_at` is when
-- the account was suspended, as unix seconds (NULL while not suspended) — the
-- timestamp sibling of the boolean `suspended` flag, indexed so the
-- signup-abuse harness can count an IP's recently-suspended accounts.
--
-- Idempotent: the column add uses _puter_add_col (defined in mig_1, which
-- leaves it resident for later migrations); the index add is guarded against
-- INFORMATION_SCHEMA.STATISTICS so the directory replays safely.

CALL _puter_add_col('user', 'suspended_at', '`suspended_at` bigint DEFAULT NULL');

DROP PROCEDURE IF EXISTS _puter_add_user_suspended_at_index;
DELIMITER //
CREATE PROCEDURE _puter_add_user_suspended_at_index()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'user'
      AND INDEX_NAME = 'idx_user_suspended_at'
  ) THEN
    ALTER TABLE `user` ADD INDEX `idx_user_suspended_at` (`suspended_at`);
  END IF;
END//
DELIMITER ;

CALL _puter_add_user_suspended_at_index();

DROP PROCEDURE IF EXISTS _puter_add_user_suspended_at_index;
