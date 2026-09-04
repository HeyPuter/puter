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

-- `event_subscriptions` grew three hot queries with no index behind them:
-- a handler's own rows, the expiry reaper and the suspended reaper. See
-- sqlite/0081_event-subscriptions-indexes.sql for the query shapes.
--
-- Idempotent: the guarded procedure, as mig_30/mig_34/mig_35. There is no
-- per-file applied-state tracking, so a replay has to be a no-op.

DROP PROCEDURE IF EXISTS _puter_add_event_subscriptions_indexes;
DELIMITER //
CREATE PROCEDURE _puter_add_event_subscriptions_indexes()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'event_subscriptions'
      AND INDEX_NAME = 'idx_event_subscriptions_app_handler'
  ) THEN
    ALTER TABLE `event_subscriptions`
      ADD INDEX `idx_event_subscriptions_app_handler` (`app_uid`, `handler_name`);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'event_subscriptions'
      AND INDEX_NAME = 'idx_event_subscriptions_expires'
  ) THEN
    ALTER TABLE `event_subscriptions`
      ADD INDEX `idx_event_subscriptions_expires` (`expires_at`);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'event_subscriptions'
      AND INDEX_NAME = 'idx_event_subscriptions_suspended'
  ) THEN
    ALTER TABLE `event_subscriptions`
      ADD INDEX `idx_event_subscriptions_suspended` (`suspended_at`, `id`);
  END IF;
END//
DELIMITER ;

CALL _puter_add_event_subscriptions_indexes();
DROP PROCEDURE IF EXISTS _puter_add_event_subscriptions_indexes;
