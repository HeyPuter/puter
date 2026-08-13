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

-- User-to-developer feedback for apps that opt in. Mirrors SQLite migration
-- 0065. Opt-in is the new `apps.feedback_enabled` column (developer-writable
-- through the regular `puter.apps.update` path). Each row of `app_feedback`
-- is one message a signed-in user submitted through the GUI feedback dialog;
-- a copy is emailed to the app owner unless the per-app daily email cap
-- suppressed it (`email_sent` records which). `app_uid` is denormalized
-- alongside `app_id` so rows stay attributable after an app is deleted.
-- `created_at` is unix seconds.
--
-- Idempotent: the column add uses _puter_add_col (defined in mig_1, which
-- always runs first) and the table uses `CREATE TABLE IF NOT EXISTS`, so the
-- directory can replay safely.

CALL _puter_add_col('apps', 'feedback_enabled', '`feedback_enabled` tinyint(1) DEFAULT ''0''');

CREATE TABLE IF NOT EXISTS `app_feedback` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `uid` CHAR(36) NOT NULL,
    `app_id` INT NOT NULL,
    `app_uid` CHAR(40) NOT NULL,
    `user_id` INT NOT NULL,
    `message` TEXT NOT NULL,
    `source_env` VARCHAR(16) DEFAULT NULL,
    `source_origin` VARCHAR(2048) DEFAULT NULL,
    `email_sent` TINYINT(1) NOT NULL DEFAULT 0,
    `created_at` BIGINT NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_app_feedback_uid` (`uid`),
    KEY `idx_app_feedback_app_created` (`app_id`, `created_at`),
    KEY `idx_app_feedback_user_created` (`user_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
