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

-- `notification`.`group_key`. See sqlite/0098_notification-group-key.sql
-- for the rationale. A hex digest, so ascii and compared byte for byte. No
-- per-file applied-state tracking, so every step is guarded and a replay does
-- nothing.

CALL _puter_add_col('notification', 'group_key', '`group_key` char(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL');

DROP PROCEDURE IF EXISTS _puter_add_notification_group_index;
DELIMITER //
CREATE PROCEDURE _puter_add_notification_group_index()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'notification'
      AND INDEX_NAME = 'idx_notification_group'
  ) THEN
    ALTER TABLE `notification` ADD INDEX `idx_notification_group`
      (`user_id`, `app_uid`, `group_key`);
  END IF;
END//
DELIMITER ;

CALL _puter_add_notification_group_index();

DROP PROCEDURE IF EXISTS _puter_add_notification_group_index;
