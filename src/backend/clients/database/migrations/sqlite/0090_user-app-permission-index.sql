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

-- Withdrawing an app's cross-app data grants looks them up by permission text,
-- and no existing index on either table leads with `permission`. Same fix as
-- `idx_user_to_user_permissions_permission` in 0067.
CREATE INDEX IF NOT EXISTS `idx_user_to_app_permissions_permission`
    ON `user_to_app_permissions` (`permission`);

-- The sweep reads both tables; MySQL and Postgres already index this one.
CREATE INDEX IF NOT EXISTS `idx_dev_to_app_permissions_permission`
    ON `dev_to_app_permissions` (`permission`);
