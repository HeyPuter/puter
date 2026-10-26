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

-- Devices that can receive pushes for a user. A provider address (token) has
-- one owner: registering it again, by anyone, rewrites the existing row, so
-- the unique token_hash is what decides ownership. app_uid is NULL for devices
-- Puter registered itself. Timestamps are unix seconds.

CREATE TABLE IF NOT EXISTS `push_device` (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "uid" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL
        REFERENCES `user` ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "session_uid" TEXT DEFAULT NULL,
    "platform" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "app_uid" TEXT DEFAULT NULL,
    "user_agent" TEXT DEFAULT NULL,
    "label" TEXT DEFAULT NULL,
    "created_at" INTEGER NOT NULL,
    "last_seen_at" INTEGER NOT NULL,
    "failure_count" INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS `idx_push_device_token_hash`
    ON `push_device` (`token_hash`);
CREATE UNIQUE INDEX IF NOT EXISTS `idx_push_device_uid`
    ON `push_device` (`uid`);
CREATE INDEX IF NOT EXISTS `idx_push_device_user_app`
    ON `push_device` (`user_id`, `app_uid`);
CREATE INDEX IF NOT EXISTS `idx_push_device_session`
    ON `push_device` (`session_uid`);
CREATE INDEX IF NOT EXISTS `idx_push_device_last_seen`
    ON `push_device` (`last_seen_at`);
