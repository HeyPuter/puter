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

-- Suspension reason column. Mirrors SQLite migration 0063. Why an account was
-- suspended (NULL while not suspended) — companion to the boolean `suspended`
-- flag and `suspended_at` timestamp. Constrained at the application layer to a
-- fixed set of reasons (see extensions/admin suspension_reasons.js).
-- Idempotent via IF NOT EXISTS.

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS suspended_reason text;
