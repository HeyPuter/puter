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

-- Share-handle quota, listing and purge indexes. See
-- sqlite/0096_kv-share-handle-quota-indexes.sql for what each serves. No
-- per-file applied-state tracking, so every index is guarded and a replay does
-- nothing.

DROP PROCEDURE IF EXISTS _puter_add_kv_share_handle_quota_indexes;
DELIMITER //
CREATE PROCEDURE _puter_add_kv_share_handle_quota_indexes()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'kv_share_handles'
      AND INDEX_NAME = 'idx_kv_share_handles_owner_live'
  ) THEN
    ALTER TABLE `kv_share_handles` ADD INDEX `idx_kv_share_handles_owner_live` (`owner_user_id`, `revoked_at`, `app_uid`);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'kv_share_handles'
      AND INDEX_NAME = 'idx_kv_share_handles_owner_app'
  ) THEN
    ALTER TABLE `kv_share_handles` ADD INDEX `idx_kv_share_handles_owner_app` (`owner_user_id`, `app_uid`, `id`);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'kv_share_handles'
      AND INDEX_NAME = 'idx_kv_share_handles_grantee_app'
  ) THEN
    ALTER TABLE `kv_share_handles` ADD INDEX `idx_kv_share_handles_grantee_app` (`grantee_user_id`, `app_uid`, `id`);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'kv_share_handles'
      AND INDEX_NAME = 'idx_kv_share_handles_pair'
  ) THEN
    ALTER TABLE `kv_share_handles` ADD INDEX `idx_kv_share_handles_pair` (`owner_user_id`, `grantee_user_id`, `revoked_at`);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'kv_share_handles'
      AND INDEX_NAME = 'idx_kv_share_handles_revoked'
  ) THEN
    ALTER TABLE `kv_share_handles` ADD INDEX `idx_kv_share_handles_revoked` (`revoked_at`);
  END IF;
END//
DELIMITER ;

CALL _puter_add_kv_share_handle_quota_indexes();

DROP PROCEDURE IF EXISTS _puter_add_kv_share_handle_quota_indexes;
