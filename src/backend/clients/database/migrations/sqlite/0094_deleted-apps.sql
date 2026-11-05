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

-- Uid and owner of each deleted app. An origin-derived uid comes back when the
-- origin is used again; on a hosted subdomain now registered to someone else,
-- AuthService moves on to a fresh uid so the deleted app's data stays put.

CREATE TABLE IF NOT EXISTS `deleted_apps` (
    "uid" TEXT PRIMARY KEY NOT NULL,
    "owner_user_id" INTEGER DEFAULT NULL
);
