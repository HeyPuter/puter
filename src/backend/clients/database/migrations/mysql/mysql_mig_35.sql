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

-- Opaque names for shared regions of a user's key-value namespace. See
-- sqlite/0080_kv-share-handles.sql for the column rationale.
--
-- Idempotent: `CREATE TABLE IF NOT EXISTS` with the indexes declared inline,
-- as mig_29. There is no per-file applied-state tracking, so a replay has to
-- be a no-op.

CREATE TABLE IF NOT EXISTS `kv_share_handles` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    `handle` varchar(64) NOT NULL,
    `owner_user_id` int unsigned NOT NULL,
    `grantee_user_id` int unsigned NOT NULL,
    -- Matches `apps`.`uid` exactly, charset included, so an equality against
    -- one never falls back to a conversion. No foreign key: a handle outlives
    -- the app it was minted against, which is what keeps it revocable.
    `app_uid` char(40) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL,
    `key_prefix` varchar(1024) NOT NULL,
    `permission` varchar(1024) NOT NULL,
    `created_at` bigint NOT NULL,
    `revoked_at` bigint DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `idx_kv_share_handles_handle` (`handle`),
    KEY `idx_kv_share_handles_owner` (`owner_user_id`, `id`),
    CONSTRAINT `fk_kv_share_handles_owner` FOREIGN KEY (`owner_user_id`)
        REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_kv_share_handles_grantee` FOREIGN KEY (`grantee_user_id`)
        REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A subscription made through a handle stores the grant string it was
-- authorized under rather than an access mode, and a grant string carries a
-- user uuid, an app uid and a key prefix. Guarded on the current length, as
-- mig_24: replaying a column change on a growing table rebuilds it every boot.

DROP PROCEDURE IF EXISTS _puter_widen_subscription_permission;
DELIMITER //
CREATE PROCEDURE _puter_widen_subscription_permission()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'event_subscriptions'
      AND COLUMN_NAME = 'permission'
      AND CHARACTER_MAXIMUM_LENGTH < 1024
  ) THEN
    ALTER TABLE `event_subscriptions` MODIFY `permission` varchar(1024) NOT NULL;
  END IF;
END //
DELIMITER ;
CALL _puter_widen_subscription_permission();
DROP PROCEDURE IF EXISTS _puter_widen_subscription_permission;
