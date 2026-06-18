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

-- Add 'worker' to the `kind` CHECK constraint on `sessions`. Mirrors the
-- MySQL ENUM extension in mysql_mig_12.
--
-- SQLite cannot ALTER a CHECK constraint in place, so we follow the
-- standard 12-step rebuild: create `sessions_new` with the corrected
-- constraint, copy rows, drop the old table, rename, then recreate every
-- index that lived on the original (indexes are auto-dropped with their
-- table).

CREATE TABLE `sessions_new` (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "uuid" TEXT NOT NULL,
    "meta" JSON DEFAULT NULL,
    "created_at" INTEGER DEFAULT 0,
    "last_activity" INTEGER DEFAULT 0,
    "kind" TEXT NOT NULL DEFAULT 'web'
        CHECK (`kind` IN ('web', 'app', 'access_token', 'asset', 'worker')),
    "label" TEXT,
    "parent_session_id" TEXT,
    "last_ip" TEXT,
    "last_user_agent" TEXT,
    "revoked_at" INTEGER,
    "expires_at" INTEGER,
    "app_uid" TEXT,
    "legacy_token_uid" TEXT,
    "created_via" TEXT,
    "auth_id" TEXT,
    "access_token_uid" TEXT,
    FOREIGN KEY("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO `sessions_new` (
    `id`, `user_id`, `uuid`, `meta`, `created_at`, `last_activity`,
    `kind`, `label`, `parent_session_id`, `last_ip`, `last_user_agent`,
    `revoked_at`, `expires_at`, `app_uid`, `legacy_token_uid`,
    `created_via`, `auth_id`, `access_token_uid`
)
SELECT
    `id`, `user_id`, `uuid`, `meta`, `created_at`, `last_activity`,
    `kind`, `label`, `parent_session_id`, `last_ip`, `last_user_agent`,
    `revoked_at`, `expires_at`, `app_uid`, `legacy_token_uid`,
    `created_via`, `auth_id`, `access_token_uid`
FROM `sessions`;

DROP TABLE `sessions`;

ALTER TABLE `sessions_new` RENAME TO `sessions`;

CREATE INDEX IF NOT EXISTS `idx_sessions_user_revoked`
    ON `sessions` (`user_id`, `revoked_at`);

CREATE INDEX IF NOT EXISTS `idx_sessions_parent`
    ON `sessions` (`parent_session_id`);

CREATE UNIQUE INDEX IF NOT EXISTS `idx_sessions_user_app_active`
    ON `sessions` (`user_id`, `app_uid`)
    WHERE `kind` = 'app' AND `revoked_at` IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS `idx_sessions_legacy_token_active`
    ON `sessions` (`legacy_token_uid`)
    WHERE `legacy_token_uid` IS NOT NULL AND `revoked_at` IS NULL;

CREATE INDEX IF NOT EXISTS `idx_sessions_kind_user`
    ON `sessions` (`kind`, `user_id`);

CREATE INDEX IF NOT EXISTS `idx_sessions_access_token_uid`
    ON `sessions` (`access_token_uid`)
    WHERE `access_token_uid` IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS `idx_sessions_user_worker_active`
    ON `sessions` (`user_id`, IFNULL(`app_uid`, ''), json_extract(`meta`, '$.worker_name'))
    WHERE `kind` = 'worker' AND `revoked_at` IS NULL;
