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

-- See sqlite/0076. Types follow mysql_mig_1; the guarded procedure follows mysql_mig_22.

CREATE TABLE IF NOT EXISTS `audit_team_membership` (
  `id`            int unsigned NOT NULL AUTO_INCREMENT,
  `group_id`      int unsigned DEFAULT NULL,
  `group_id_keep` int unsigned NOT NULL,
  `user_id`       int unsigned DEFAULT NULL,
  `user_id_keep`  int unsigned NOT NULL,
  `actor_user_id` int unsigned DEFAULT NULL,
  `action`        varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reason`        varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at`    timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_team_membership_group` (`group_id_keep`, `id`),
  KEY `idx_audit_team_membership_user` (`user_id_keep`, `id`),
  KEY `idx_audit_team_membership_group_fk` (`group_id`),
  KEY `idx_audit_team_membership_user_fk` (`user_id`),
  KEY `idx_audit_team_membership_actor_fk` (`actor_user_id`),
  -- SET NULL, never CASCADE: deleting an account must not erase what was done to it.
  CONSTRAINT `fk_audit_team_membership_group` FOREIGN KEY (`group_id`)
    REFERENCES `group` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_audit_team_membership_user` FOREIGN KEY (`user_id`)
    REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_audit_team_membership_actor` FOREIGN KEY (`actor_user_id`)
    REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL _puter_add_col('share', 'holder_group_id', '`holder_group_id` int unsigned DEFAULT NULL');

DROP PROCEDURE IF EXISTS _puter_add_group_share_constraints;

DELIMITER //
CREATE PROCEDURE _puter_add_group_share_constraints()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'share'
      AND INDEX_NAME = 'idx_share_holder_group'
  ) THEN
    ALTER TABLE `share` ADD INDEX `idx_share_holder_group` (`holder_group_id`, `id`);
  END IF;
  -- Team shares leave `holder_user_id` NULL, so the existing unique index binds none.
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'share'
      AND INDEX_NAME = 'idx_share_holder_group_entry_issuer'
  ) THEN
    ALTER TABLE `share` ADD UNIQUE INDEX `idx_share_holder_group_entry_issuer`
      (`holder_group_id`, `fsentry_id`, `issuer_user_id`);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'share'
      AND CONSTRAINT_NAME = 'share_holder_group_fk'
  ) THEN
    ALTER TABLE `share` ADD CONSTRAINT `share_holder_group_fk`
      FOREIGN KEY (`holder_group_id`) REFERENCES `group` (`id`)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END//
DELIMITER ;

CALL _puter_add_group_share_constraints();
DROP PROCEDURE IF EXISTS _puter_add_group_share_constraints;
