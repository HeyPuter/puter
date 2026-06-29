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

-- When the account was suspended, as unix seconds; NULL while not suspended.
-- The timestamp sibling of the existing boolean `suspended` flag, stamped by
-- every suspension site. Indexed so the signup-abuse harness can count an IP's
-- recently-suspended accounts (see extensions/abuse/v2 suspendedAccountsByIp).
ALTER TABLE `user` ADD COLUMN `suspended_at` INTEGER DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_user_suspended_at ON `user` (`suspended_at`);
