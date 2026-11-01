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

-- `notification`.`send_key`. See sqlite/0101_notification-send-key.sql for the
-- rationale. The key is a uuid, so ascii and compared byte for byte. No
-- per-file applied-state tracking, so every step is guarded and a replay does
-- nothing.

CALL _puter_add_col('notification', 'send_key', '`send_key` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL');

DROP PROCEDURE IF EXISTS _puter_add_notification_send_key_index;
DELIMITER //
CREATE PROCEDURE _puter_add_notification_send_key_index()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'notification'
      AND INDEX_NAME = 'idx_notification_send_key'
  ) THEN
    ALTER TABLE `notification` ADD UNIQUE KEY `idx_notification_send_key`
      (`send_key`);
  END IF;
END//
DELIMITER ;

CALL _puter_add_notification_send_key_index();

DROP PROCEDURE IF EXISTS _puter_add_notification_send_key_index;
