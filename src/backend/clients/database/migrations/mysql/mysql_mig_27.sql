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

-- Index `notification`.`created_at`. The retention sweep selects by age alone
-- and by nothing else, so no existing index on the table narrows it — every
-- pass would otherwise scan the whole table to find the oldest few hundred
-- rows.
--
-- Idempotent: the guarded procedure, as mig_26. There is no per-file
-- applied-state tracking, so a replay has to be a no-op.

DROP PROCEDURE IF EXISTS _puter_add_notification_created_at_index;
DELIMITER //
CREATE PROCEDURE _puter_add_notification_created_at_index()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'notification'
      AND INDEX_NAME = 'idx_notification_created_at'
  ) THEN
    ALTER TABLE `notification` ADD INDEX `idx_notification_created_at`
      (`created_at`);
  END IF;
END //
DELIMITER ;
CALL _puter_add_notification_created_at_index();
DROP PROCEDURE IF EXISTS _puter_add_notification_created_at_index;
