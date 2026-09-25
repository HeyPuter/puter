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

-- Subscriptions that outlive the connection that made them. Session
-- subscriptions never reach this table — they are Redis only — so every row
-- here is one somebody has to be able to find and revoke later.
--
--   - `sub_id`         : `<appUid>#<uuid>`, or `user#<uuid>` for a row a user
--                        session created. Unique table-wide; it is what
--                        `unsubscribe` names.
--   - `owner_user_id`  : owner of the anchor node. Dispatch only knows whose
--                        resource changed, so this is the side a shared-folder
--                        subscription has to be findable from, and the key a
--                        region's cache is rebuilt under.
--   - `holder_user_id` : who subscribed — the delivery target, whose access is
--                        re-checked, and who the quota counts against.
--   - `app_uid`        : NULL for a row a user session created. No foreign
--                        key: a row outlives the app that made it, which is
--                        what keeps it listable and revocable afterwards.
--   - `anchor_*`       : the resolved anchor. `match` is a glob relative to
--                        `anchor_path`, so the path is not decoration — the
--                        dispatch filter reads it on every event.
--   - `ops`            : op filter; a comma-separated set, NULL for every op.
--   - `targets`        : JSON array over socket|worker|push.
--   - `context`        : plaintext JSON, hard-capped at 4 KB, read only on the
--                        delivery path and never returned by `list`.
--   - `permission`     : the ACL mode the subscribe check passed under,
--                        re-checked per delivery.
--   - `suspended_*`    : set when a subscription stops delivering without
--                        being removed; the state machine that drives them
--                        lands with the delivery classes that need it.
--
-- `created_at` and the two timestamps are unix seconds, matching
-- `app_feedback` and `user_block`.

CREATE TABLE IF NOT EXISTS `event_subscriptions` (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "sub_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "owner_user_id" INTEGER NOT NULL
        REFERENCES `user` ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "holder_user_id" INTEGER NOT NULL
        REFERENCES `user` ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "app_uid" TEXT DEFAULT NULL,
    "subject" TEXT NOT NULL,
    "anchor_uid" TEXT NOT NULL,
    "anchor_path" TEXT NOT NULL,
    "match" TEXT DEFAULT NULL,
    "delivery" TEXT NOT NULL,
    "ops" TEXT DEFAULT NULL,
    "handler_name" TEXT DEFAULT NULL,
    "targets" TEXT NOT NULL,
    "context" TEXT DEFAULT NULL,
    "permission" TEXT NOT NULL,
    "suspended_at" INTEGER DEFAULT NULL,
    "suspended_reason" TEXT DEFAULT NULL,
    "expires_at" INTEGER DEFAULT NULL,
    "created_at" INTEGER NOT NULL     -- unix seconds
);

CREATE UNIQUE INDEX IF NOT EXISTS `idx_event_subscriptions_sub_id`
    ON `event_subscriptions` (`sub_id`);

-- Dispatch reads the table only when a region's cache is cold; this is the
-- lookup it falls back to.
CREATE INDEX IF NOT EXISTS `idx_event_subscriptions_token`
    ON `event_subscriptions` (`token`);

-- List, revoke and quota all key here — the index is the scope check rather
-- than a filter over a wider read.
CREATE INDEX IF NOT EXISTS `idx_event_subscriptions_holder`
    ON `event_subscriptions` (`holder_user_id`, `app_uid`);

-- Rebuilding one region's cache for one owner, and the sweep that follows it.
CREATE INDEX IF NOT EXISTS `idx_event_subscriptions_owner`
    ON `event_subscriptions` (`owner_user_id`);
