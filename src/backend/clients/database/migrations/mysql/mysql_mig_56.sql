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

-- `notification` (`user_id`, `audience`, `app_uid`, `id`). See
-- sqlite/0102_notification-scope-id-index.sql for the rationale. No per-file
-- applied-state tracking, so the index is added only when missing and a
-- replay does nothing.

DROP PROCEDURE IF EXISTS _puter_add_notification_scope_id_index;
DELIMITER //
CREATE PROCEDURE _puter_add_notification_scope_id_index()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'notification'
      AND INDEX_NAME = 'idx_notification_scope_id'
  ) THEN
    ALTER TABLE `notification` ADD INDEX `idx_notification_scope_id`
      (`user_id`, `audience`, `app_uid`, `id`), ALGORITHM=INPLACE, LOCK=NONE;
  END IF;
END//
DELIMITER ;

CALL _puter_add_notification_scope_id_index();

DROP PROCEDURE IF EXISTS _puter_add_notification_scope_id_index;
