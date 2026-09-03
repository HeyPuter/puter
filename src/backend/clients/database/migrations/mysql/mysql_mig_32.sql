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

-- Teams. See sqlite/0077_teams.sql for the column rationale.
-- No per-file applied-state tracking, so every statement must tolerate a re-run:
-- columns go through _puter_add_col, indexes through the guarded procedure below.

CALL _puter_add_col('group', 'kind', '`kind` varchar(20) DEFAULT NULL');
CALL _puter_add_col('group', 'name', '`name` varchar(255) DEFAULT NULL');
CALL _puter_add_col('group', 'handle', '`handle` varchar(64) DEFAULT NULL');
CALL _puter_add_col('group', 'deleted_at', '`deleted_at` timestamp NULL DEFAULT NULL');
CALL _puter_add_col('jct_user_group', 'org_owned', '`org_owned` tinyint(1) DEFAULT NULL');
CALL _puter_add_col('user', 'requires_password_change', '`requires_password_change` tinyint(1) NOT NULL DEFAULT ''0''');

DROP PROCEDURE IF EXISTS _puter_add_team_indexes;
DELIMITER //
CREATE PROCEDURE _puter_add_team_indexes()
BEGIN
  -- Already case-insensitive: the table is utf8mb4_unicode_ci. NULLs stay distinct.
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'group'
      AND INDEX_NAME = 'idx_group_handle'
  ) THEN
    ALTER TABLE `group` ADD UNIQUE INDEX `idx_group_handle` (`handle`);
  END IF;

  -- Composite, unlike the existing single-column `group_id` key.
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'jct_user_group'
      AND INDEX_NAME = 'idx_jct_user_group_group'
  ) THEN
    ALTER TABLE `jct_user_group`
      ADD INDEX `idx_jct_user_group_group` (`group_id`, `user_id`);
  END IF;
END//
DELIMITER ;

CALL _puter_add_team_indexes();

DROP PROCEDURE IF EXISTS _puter_add_team_indexes;
