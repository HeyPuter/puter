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

-- See sqlite/0084_share-anyone-with-link.sql for the column rationale.
-- No per-file applied-state tracking, so the column goes through _puter_add_col
-- and the index through a guarded procedure, as mysql_mig_34 does.

CALL _puter_add_col('share', 'anyone', '`anyone` tinyint(1) DEFAULT NULL');

DROP PROCEDURE IF EXISTS _puter_add_share_anyone_index;

DELIMITER //
CREATE PROCEDURE _puter_add_share_anyone_index()
BEGIN
  -- Every other row leaves `anyone` NULL, so this binds only link shares.
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'share'
      AND INDEX_NAME = 'idx_share_anyone'
  ) THEN
    ALTER TABLE `share` ADD UNIQUE INDEX `idx_share_anyone` (`fsentry_id`, `anyone`);
  END IF;
END//
DELIMITER ;

CALL _puter_add_share_anyone_index();
DROP PROCEDURE IF EXISTS _puter_add_share_anyone_index;
