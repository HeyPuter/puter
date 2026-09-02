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

-- Subscriptions that outlive the connection that made them. See
-- sqlite/0075_event-subscriptions.sql for the column rationale.
--
-- Idempotent via IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS event_subscriptions (
    id BIGSERIAL PRIMARY KEY,
    sub_id VARCHAR(80) NOT NULL UNIQUE,
    token VARCHAR(255) NOT NULL,
    owner_user_id INTEGER NOT NULL
        REFERENCES "user" (id) ON DELETE CASCADE ON UPDATE CASCADE,
    holder_user_id INTEGER NOT NULL
        REFERENCES "user" (id) ON DELETE CASCADE ON UPDATE CASCADE,
    app_uid VARCHAR(40) DEFAULT NULL,
    subject VARCHAR(4096) NOT NULL,
    anchor_uid VARCHAR(36) NOT NULL,
    anchor_path VARCHAR(4096) NOT NULL,
    "match" VARCHAR(1024) DEFAULT NULL,
    delivery VARCHAR(16) NOT NULL,
    ops VARCHAR(64) DEFAULT NULL,
    handler_name VARCHAR(128) DEFAULT NULL,
    targets JSONB NOT NULL,
    context TEXT DEFAULT NULL,
    permission VARCHAR(32) NOT NULL,
    suspended_at BIGINT DEFAULT NULL,
    suspended_reason VARCHAR(64) DEFAULT NULL,
    expires_at BIGINT DEFAULT NULL,
    created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_subscriptions_token
    ON event_subscriptions (token);
CREATE INDEX IF NOT EXISTS idx_event_subscriptions_holder
    ON event_subscriptions (holder_user_id, app_uid);
CREATE INDEX IF NOT EXISTS idx_event_subscriptions_owner
    ON event_subscriptions (owner_user_id);
