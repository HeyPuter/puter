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

-- Home region column. Mirrors SQLite migration 0074. Home region this
-- account's data belongs in — a node id, not a storage region. NULL for
-- accounts that predate the column, which fall back to `signup_server`.
--
-- Idempotent: the column add uses _puter_add_col (defined in mig_1, which
-- leaves it resident for later migrations).

CALL _puter_add_col('user', 'home', '`home` VARCHAR(64) DEFAULT NULL');
