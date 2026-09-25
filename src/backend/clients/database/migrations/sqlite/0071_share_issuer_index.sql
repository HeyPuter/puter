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

-- "Shared by me" pages by keyset: issuer equality, then `id` as the cursor.
-- The issuer foreign key created no index here (unlike mysql, where the FK's
-- index implicitly ends in the primary key), so without this the issued half
-- of that listing walks the whole table.
CREATE INDEX IF NOT EXISTS `idx_share_issuer`
    ON `share` (`issuer_user_id`, `id`);
