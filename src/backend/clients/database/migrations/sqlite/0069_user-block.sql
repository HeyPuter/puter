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

-- One user refusing contact from another. Sharing is what reads it today —
-- a blocked sender's share is refused outright, and their pending invite is
-- dropped when the blocker confirms the address it was aimed at — but the
-- table is deliberately not share-specific: the same answer serves anything
-- else one person can push at another.
--
-- Rows are read on the share path by exact (blocker, blocked) pair, which the
-- unique index answers as a point lookup; the same index's leading column
-- serves "who have I blocked". `created_at` is unix seconds, matching
-- `app_feedback`.

CREATE TABLE IF NOT EXISTS `user_block` (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "blocker_user_id" INTEGER NOT NULL
        REFERENCES `user` ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "blocked_user_id" INTEGER NOT NULL
        REFERENCES `user` ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "created_at" INTEGER NOT NULL       -- unix seconds
);

CREATE UNIQUE INDEX IF NOT EXISTS `idx_user_block_pair`
    ON `user_block` (`blocker_user_id`, `blocked_user_id`);
