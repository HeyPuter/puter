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
-- 0065 / MySQL mysql_mig_20. Opt-in is the new `apps.feedback_enabled` column
-- (developer-writable through the regular `puter.apps.update` path). Each row
-- of `app_feedback` is one message a signed-in user submitted through the GUI
-- feedback dialog; a copy is emailed to the app owner unless the per-app
-- daily email cap suppressed it (`email_sent` records which). `app_uid` is
-- denormalized alongside `app_id` so rows stay attributable after an app is
-- deleted. `created_at` is unix seconds.
--
-- Idempotent via IF NOT EXISTS.

ALTER TABLE apps ADD COLUMN IF NOT EXISTS feedback_enabled boolean NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS app_feedback (
    id BIGSERIAL PRIMARY KEY,
    uid CHAR(36) NOT NULL UNIQUE,
    app_id BIGINT NOT NULL,
    app_uid VARCHAR(40) NOT NULL,
    user_id BIGINT NOT NULL,
    message TEXT NOT NULL,
    source_env VARCHAR(16) DEFAULT NULL,
    source_origin VARCHAR(2048) DEFAULT NULL,
    email_sent BOOLEAN NOT NULL DEFAULT FALSE,
    created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_feedback_app_created
    ON app_feedback (app_id, created_at);
CREATE INDEX IF NOT EXISTS idx_app_feedback_user_created
    ON app_feedback (user_id, created_at);
