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

-- Share levels on `kv_share_handles`. See
-- sqlite/0095_kv-share-handle-levels.sql for the rationale. No per-file
-- applied-state tracking, so every step is guarded and a replay does nothing.

CALL _puter_add_col('kv_share_handles', 'revoked_by', '`revoked_by` varchar(8) DEFAULT NULL');
CALL _puter_add_col('kv_share_handles', 'label', '`label` varchar(512) DEFAULT NULL');

DROP PROCEDURE IF EXISTS _puter_add_kv_share_handle_indexes;
DELIMITER //
CREATE PROCEDURE _puter_add_kv_share_handle_indexes()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'kv_share_handles'
      AND INDEX_NAME = 'idx_kv_share_handles_grantee'
  ) THEN
    ALTER TABLE `kv_share_handles` ADD INDEX `idx_kv_share_handles_grantee` (`grantee_user_id`, `id`);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'kv_share_handles'
      AND INDEX_NAME = 'idx_kv_share_handles_app'
  ) THEN
    ALTER TABLE `kv_share_handles` ADD INDEX `idx_kv_share_handles_app` (`app_uid`);
  END IF;
END//
DELIMITER ;

CALL _puter_add_kv_share_handle_indexes();

DROP PROCEDURE IF EXISTS _puter_add_kv_share_handle_indexes;
