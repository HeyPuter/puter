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

CREATE TABLE `user_comments` (
    `id` INTEGER PRIMARY KEY,
    `uid` TEXT NOT NULL UNIQUE,
    `user_id` INTEGER NOT NULL,
    `metadata` JSON DEFAULT NULL,
    `text` TEXT NOT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX `idx_user_comments_uid` ON `user_comments` (`uid`);

CREATE TABLE `user_fsentry_comments` (
    `id` INTEGER PRIMARY KEY,
    `user_comment_id` INTEGER NOT NULL,
    `fsentry_id` INTEGER NOT NULL,
    FOREIGN KEY("user_comment_id") REFERENCES "user_comments" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY("fsentry_id") REFERENCES "fsentries" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE `user_fsentry_version_comments` (
    `id` INTEGER PRIMARY KEY,
    `user_comment_id` INTEGER NOT NULL,
    `fsentry_version_id` INTEGER NOT NULL,
    FOREIGN KEY("user_comment_id") REFERENCES "user_comments" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY("fsentry_version_id") REFERENCES "fsentry_versions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE `user_group_comments` (
    `id` INTEGER PRIMARY KEY,
    `user_comment_id` INTEGER NOT NULL,
    `group_id` INTEGER NOT NULL,
    FOREIGN KEY("user_comment_id") REFERENCES "user_comments" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY("group_id") REFERENCES "group" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE `user_user_comments` (
    `id` INTEGER PRIMARY KEY,
    `user_comment_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    FOREIGN KEY("user_comment_id") REFERENCES "user_comments" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
