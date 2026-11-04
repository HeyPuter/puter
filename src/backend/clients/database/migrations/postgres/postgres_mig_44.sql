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

-- Handlers an app's user published into their own scope. See
-- sqlite/0101_user-scoped-handlers.sql for the column rationale.
-- Idempotent via IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS event_user_handlers (
    id BIGSERIAL PRIMARY KEY,
    app_uid VARCHAR(40) NOT NULL,
    holder_user_id INTEGER NOT NULL,
    name VARCHAR(128) NOT NULL,
    source TEXT NOT NULL,
    source_hash VARCHAR(64) NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    scope_since BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_user_handlers_app_holder_name
    ON event_user_handlers (app_uid, holder_user_id, name);
CREATE INDEX IF NOT EXISTS idx_event_user_handlers_holder_app
    ON event_user_handlers (holder_user_id, app_uid);

ALTER TABLE event_subscriptions ADD COLUMN IF NOT EXISTS handler_scope smallint NOT NULL DEFAULT 0;
