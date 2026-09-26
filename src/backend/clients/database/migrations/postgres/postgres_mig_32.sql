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

-- Mirrors SQLite migration 0088: index `apps.index_url` for origin lookups.
-- Hash rather than btree: `index_url` allows 3000 characters, past btree's
-- ~2.7 KB row limit, and every lookup is equality (`=` / `IN`).
--
-- Idempotent via IF NOT EXISTS.

CREATE INDEX IF NOT EXISTS idx_apps_index_url ON apps USING hash (index_url);
