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

-- Widen `notification.shown` and `notification.acknowledged` to hold the unix
-- second the store has been writing to them since the backend rework.
--
-- Both arrived from the v1 schema as `tinyint(1)`, where they were flags. The
-- rework changed the writes to timestamps and sqlite (`INTEGER`) and postgres
-- (`bigint`) took them; only mysql was left too narrow, so every `markShown`
-- and `markAcknowledged` there fails with ER_WARN_DATA_OUT_OF_RANGE and the
-- column stays NULL. Dismissing a notification therefore never sticks, and one
-- already delivered is re-sent on every reconnect.
--
-- No backfill: every reader tests `IS NULL` / `IS NOT NULL` only, so a legacy
-- `1` keeps meaning "yes" once widened.
--
-- Guarded on the current type rather than run unconditionally. Changing a
-- column type copies the table, and this one grows without bound — a migration
-- directory that replays on every boot must not rebuild it every time.

DROP PROCEDURE IF EXISTS _puter_widen_notification_stamps;
DELIMITER //
CREATE PROCEDURE _puter_widen_notification_stamps()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'notification'
      AND COLUMN_NAME = 'shown'
      AND DATA_TYPE = 'tinyint'
  ) THEN
    ALTER TABLE `notification` MODIFY `shown` BIGINT DEFAULT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'notification'
      AND COLUMN_NAME = 'acknowledged'
      AND DATA_TYPE = 'tinyint'
  ) THEN
    ALTER TABLE `notification` MODIFY `acknowledged` BIGINT DEFAULT NULL;
  END IF;
END //
DELIMITER ;
CALL _puter_widen_notification_stamps();
DROP PROCEDURE IF EXISTS _puter_widen_notification_stamps;
