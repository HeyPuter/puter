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

-- `event_subscriptions`.`anchor_uid` was sized for a filesystem node uuid.
-- A key-value subscription anchors on an app instead, and `apps`.`uid` is
-- `char(40)`, so the column has to hold one.
--
-- Idempotent: the guarded procedure, as mig_27. There is no per-file
-- applied-state tracking, so a replay has to be a no-op.

DROP PROCEDURE IF EXISTS _puter_widen_event_subscriptions_anchor_uid;
DELIMITER //
CREATE PROCEDURE _puter_widen_event_subscriptions_anchor_uid()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'event_subscriptions'
      AND COLUMN_NAME = 'anchor_uid'
      AND CHARACTER_MAXIMUM_LENGTH < 40
  ) THEN
    ALTER TABLE `event_subscriptions`
      MODIFY COLUMN `anchor_uid` varchar(40) NOT NULL;
  END IF;
END //
DELIMITER ;

CALL _puter_widen_event_subscriptions_anchor_uid();
DROP PROCEDURE IF EXISTS _puter_widen_event_subscriptions_anchor_uid;
