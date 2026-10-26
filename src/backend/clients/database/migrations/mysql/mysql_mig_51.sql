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

-- Devices that can receive pushes for a user. See sqlite/0096_push-device.sql
-- for the rationale. Timestamps are unix seconds.
--
-- Idempotent: `CREATE TABLE IF NOT EXISTS` with the indexes declared inline,
-- so the directory can replay safely.

CREATE TABLE IF NOT EXISTS `push_device` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `uid` VARCHAR(40) NOT NULL,
    `user_id` INT UNSIGNED NOT NULL,
    `session_uid` VARCHAR(40) DEFAULT NULL,
    `platform` VARCHAR(16) NOT NULL,
    `token` TEXT NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `app_uid` VARCHAR(40) DEFAULT NULL,
    `user_agent` VARCHAR(512) DEFAULT NULL,
    `label` VARCHAR(64) DEFAULT NULL,
    `created_at` BIGINT NOT NULL,
    `last_seen_at` BIGINT NOT NULL,
    `failure_count` INT NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`),
    UNIQUE KEY `idx_push_device_token_hash` (`token_hash`),
    UNIQUE KEY `idx_push_device_uid` (`uid`),
    KEY `idx_push_device_user_app` (`user_id`, `app_uid`),
    KEY `idx_push_device_session` (`session_uid`),
    KEY `idx_push_device_last_seen` (`last_seen_at`),
    CONSTRAINT `fk_push_device_user` FOREIGN KEY (`user_id`)
        REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
