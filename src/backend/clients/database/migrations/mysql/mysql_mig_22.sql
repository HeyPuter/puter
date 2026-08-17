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

-- Grow `share` from a pending-email-invite table into the index of active
-- shares. See sqlite/0067_share_entries.sql for the column rationale.
--
-- Idempotent: columns go through _puter_add_col (from mig_1), indexes and
-- foreign keys through the guarded procedure below. There is no per-file
-- applied-state tracking, so every statement must tolerate a re-run.

CALL _puter_add_col('share', 'holder_user_id', '`holder_user_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('share', 'fsentry_id', '`fsentry_id` int unsigned DEFAULT NULL');
CALL _puter_add_col('share', 'mode', '`mode` varchar(20) DEFAULT NULL');
CALL _puter_add_col('share', 'applied_at', '`applied_at` timestamp NULL DEFAULT NULL');

DROP PROCEDURE IF EXISTS _puter_add_share_index_constraints;
DELIMITER //
CREATE PROCEDURE _puter_add_share_index_constraints()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'share'
      AND INDEX_NAME = 'idx_share_holder'
  ) THEN
    ALTER TABLE `share` ADD INDEX `idx_share_holder` (`holder_user_id`, `id`);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'share'
      AND INDEX_NAME = 'idx_share_fsentry'
  ) THEN
    ALTER TABLE `share` ADD INDEX `idx_share_fsentry` (`fsentry_id`);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'share'
      AND INDEX_NAME = 'idx_share_holder_entry_issuer'
  ) THEN
    ALTER TABLE `share` ADD UNIQUE INDEX `idx_share_holder_entry_issuer`
      (`holder_user_id`, `fsentry_id`, `issuer_user_id`);
  END IF;

  -- Retiring a deleted node's grants looks them up by permission text
  -- (`fs:<uuid>` and `fs:<uuid>:%`); the subject lives in that text rather
  -- than a column, so no foreign key can cascade it. The primary key is
  -- (issuer, holder, permission), which never puts `permission` first, so
  -- without this both the equality and the left-anchored LIKE degrade to a
  -- full scan on the delete path. The column is ascii varchar(255), well
  -- inside InnoDB's key limit, so it is indexed whole.
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'user_to_user_permissions'
      AND INDEX_NAME = 'idx_user_to_user_permissions_permission'
  ) THEN
    ALTER TABLE `user_to_user_permissions`
      ADD INDEX `idx_user_to_user_permissions_permission` (`permission`);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'share'
      AND CONSTRAINT_NAME = 'share_holder_user_fk'
  ) THEN
    ALTER TABLE `share` ADD CONSTRAINT `share_holder_user_fk`
      FOREIGN KEY (`holder_user_id`) REFERENCES `user` (`id`)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- The cascade that retires a share with its file.
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'share'
      AND CONSTRAINT_NAME = 'share_fsentry_fk'
  ) THEN
    ALTER TABLE `share` ADD CONSTRAINT `share_fsentry_fk`
      FOREIGN KEY (`fsentry_id`) REFERENCES `fsentries` (`id`)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END//
DELIMITER ;

CALL _puter_add_share_index_constraints();

DROP PROCEDURE IF EXISTS _puter_add_share_index_constraints;
