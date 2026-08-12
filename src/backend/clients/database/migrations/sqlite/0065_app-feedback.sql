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

-- User-to-developer feedback for apps that opt in. Opt-in is the new
-- `apps.feedback_enabled` column (developer-writable through the regular
-- `puter.apps.update` path; a dedicated column rather than a `metadata` key
-- because Dev Center saves replace the whole metadata blob and would erase
-- it). Each row of `app_feedback` is one message a signed-in user submitted
-- through the GUI feedback dialog; a copy is emailed to the app owner unless
-- the per-app daily email cap suppressed it (`email_sent` records which).
-- `app_uid` is denormalized alongside `app_id` so rows stay attributable
-- after an app is deleted (abuse forensics). `source_env` is 'app' (desktop
-- dialog) or 'web' (puter.com popup opened from an external site);
-- `source_origin` is the popup opener's browser-attested origin, null for
-- desktop submissions. `created_at` is unix seconds. The (user_id,
-- created_at) and (app_id, created_at) indexes serve the sliding-window
-- rate-limit counts in AppFeedbackStore.

ALTER TABLE apps ADD COLUMN "feedback_enabled" tinyint(1) DEFAULT '0';

CREATE TABLE IF NOT EXISTS `app_feedback` (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "uid" TEXT NOT NULL UNIQUE,
    "app_id" INTEGER NOT NULL,
    "app_uid" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "source_env" TEXT DEFAULT NULL,     -- 'app' | 'web'
    "source_origin" TEXT DEFAULT NULL,  -- attested opener origin (web popups)
    "email_sent" INTEGER NOT NULL DEFAULT 0,
    "created_at" INTEGER NOT NULL       -- unix seconds
);

CREATE INDEX IF NOT EXISTS idx_app_feedback_app_created
    ON `app_feedback` (`app_id`, `created_at`);
CREATE INDEX IF NOT EXISTS idx_app_feedback_user_created
    ON `app_feedback` (`user_id`, `created_at`);
