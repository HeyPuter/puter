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

-- Add UNIQUE constraint to user.uuid column to support foreign key references
-- This is required for the foreign key in _extension_purchased_items table
-- which references "user"."uuid"

-- SQLite supports adding UNIQUE constraints via CREATE UNIQUE INDEX
-- This is much simpler and safer than recreating the entire table
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_uuid ON user(uuid);