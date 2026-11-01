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

-- `notification`.`send_key`: the key of the delayed send (a `deferred`
-- schedule) that wrote this row or last replaced it, derived from the
-- schedule and its slot. Unique, so one slot can never write two rows, and a
-- send that crashed after writing finds its row again by it. Null on every row
-- a delayed send never touched.

ALTER TABLE `notification` ADD COLUMN `send_key` TEXT DEFAULT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS `idx_notification_send_key`
    ON `notification` (`send_key`);
