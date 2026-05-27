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

-- Enforce case-insensitive uniqueness on user.username.
--
-- SQLite defaults varchar columns to BINARY collation, so without this
-- index `Admin` and `admin` can coexist as separate rows even though the
-- reserved-name check and adminOnly gate both treat usernames as
-- case-insensitive. Prod MySQL already uses ascii_general_ci on this
-- column; this brings self-hosted SQLite to the same invariant.
--
-- If this CREATE fails because the DB already contains case-collision
-- duplicates, resolve them manually before re-running the migration —
-- there is no safe automatic merge of two user accounts.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_username_nocase
    ON user(username COLLATE NOCASE)
    WHERE username IS NOT NULL;
