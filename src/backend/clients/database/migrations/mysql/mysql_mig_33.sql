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

-- Deduplicate then constrain. See sqlite/0072 for why duplicates exist and why
-- dropping the higher-id row is lossless.

-- Self-join rather than `id NOT IN (SELECT MIN(id) ... FROM jct_user_group)`,
-- which mysql refuses with error 1093 -- it will not read the table it deletes
-- from in a subquery. Keeps the lowest id of each pair.
DELETE dup FROM `jct_user_group` dup
JOIN `jct_user_group` keep
  ON  dup.`user_id`  = keep.`user_id`
  AND dup.`group_id` = keep.`group_id`
  AND dup.`id`       > keep.`id`;

-- Guarded because mysql tracks no applied-state per file, so this may re-run.
DROP PROCEDURE IF EXISTS _puter_add_membership_pair_index;

DELIMITER //
CREATE PROCEDURE _puter_add_membership_pair_index()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'jct_user_group'
      AND INDEX_NAME = 'idx_jct_user_group_pair'
  ) THEN
    ALTER TABLE `jct_user_group`
      ADD UNIQUE INDEX `idx_jct_user_group_pair` (`user_id`, `group_id`);
  END IF;
END//
DELIMITER ;

CALL _puter_add_membership_pair_index();
DROP PROCEDURE IF EXISTS _puter_add_membership_pair_index;
