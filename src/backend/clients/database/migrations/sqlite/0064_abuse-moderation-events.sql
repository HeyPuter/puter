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

-- Append-only log of admin moderation actions, used to measure the abuse
-- system's false-positive rate: `unsuspend` (admin unblock) and
-- `admin_create_user` (an account minted by an admin, typically to recover a
-- legitimately-blocked signup) are the false-positive signals; `suspend` gives
-- the denominator. Unlike the `suspended`/`suspended_at`/`suspended_reason`
-- columns on `user` — which are cleared on unsuspend and so keep no history —
-- this table preserves every event. `created_at` is unix seconds (matching
-- `user.suspended_at`), stamped by the recorder in
-- extensions/admin/moderation_events.js. Written best-effort at the admin
-- suspend/unsuspend/create-user sites; surfaced on the /admin/abuse dashboard.

CREATE TABLE IF NOT EXISTS `abuse_moderation_events` (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "action" TEXT NOT NULL,             -- 'suspend' | 'unsuspend' | 'admin_create_user'
    "target_user_id" INTEGER DEFAULT NULL,
    "target_username" TEXT DEFAULT NULL,
    "admin_username" TEXT DEFAULT NULL, -- the acting admin (req.actor.user.username)
    "reason" TEXT DEFAULT NULL,
    "source" TEXT DEFAULT NULL,         -- 'user_page' | 'email_hostname_blacklist' | 'create_user'
    "created_at" INTEGER NOT NULL       -- unix seconds
);

CREATE INDEX IF NOT EXISTS idx_abuse_moderation_events_created_at
    ON `abuse_moderation_events` (`created_at`);
CREATE INDEX IF NOT EXISTS idx_abuse_moderation_events_action
    ON `abuse_moderation_events` (`action`);
