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

CREATE TABLE `thread` (
    `id` INTEGER PRIMARY KEY,
    `uid` TEXT NOT NULL UNIQUE,
    `parent_uid` TEXT NULL DEFAULT NULL,
    `owner_user_id` INTEGER NOT NULL,
    `schema` TEXT NULL DEFAULT NULL,
    `text` TEXT NOT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY("parent_uid") REFERENCES "thread" ("uid") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY("owner_user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX `idx_thread_uid` ON `thread` (`uid`);
