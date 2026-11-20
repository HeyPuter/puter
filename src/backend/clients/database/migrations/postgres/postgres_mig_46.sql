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

-- Fills "share".entry_owner_user_id on any row that names an entry but was
-- written without the owner. Mirrors SQLite migration 0103. No per-file
-- applied-state tracking; a replay finds nothing to fill.

UPDATE "share"
SET entry_owner_user_id = f.user_id
FROM fsentries f
WHERE f.id = "share".fsentry_id
  AND "share".fsentry_id IS NOT NULL
  AND "share".entry_owner_user_id IS NULL;
