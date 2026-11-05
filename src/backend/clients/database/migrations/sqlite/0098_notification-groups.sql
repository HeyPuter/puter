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

-- What app message groups need from `notification`:
--
--   - `group_key`   : a sha256 hex digest of an app message's `group`, so the
--                     notification a newer one replaces is found by index.
--                     Null on every other row, and on rows written before
--                     this, which therefore never match.
--   - `replaced_at` : epoch milliseconds of the last replacement, null for a
--                     row never replaced. Live and fetched copies carry it as
--                     their version, so a client can tell a replacement from a
--                     copy it already has. Indexed per mailbox slice, so a
--                     catch-up reads the rows replaced since its cursor
--                     without scanning the ones that never were.

ALTER TABLE `notification` ADD COLUMN `group_key` TEXT DEFAULT NULL;
ALTER TABLE `notification` ADD COLUMN `replaced_at` INTEGER DEFAULT NULL;

CREATE INDEX IF NOT EXISTS `idx_notification_group`
    ON `notification` (`user_id`, `app_uid`, `group_key`);

CREATE INDEX IF NOT EXISTS `idx_notification_replaced`
    ON `notification` (`user_id`, `audience`, `app_uid`, `replaced_at`);
