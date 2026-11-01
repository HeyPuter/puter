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

-- Schedule definitions. See sqlite/0101_event-schedules.sql for the columns.
-- Idempotent via IF NOT EXISTS; there is no per-file applied-state tracking.

CREATE TABLE IF NOT EXISTS event_schedules (
    id BIGSERIAL PRIMARY KEY,
    uid CHAR(36) NOT NULL UNIQUE,
    namespace VARCHAR(128) NOT NULL,
    kind VARCHAR(16) NOT NULL,
    sub_id VARCHAR(80) DEFAULT NULL,
    holder_user_id INTEGER NOT NULL
        REFERENCES "user" (id) ON DELETE CASCADE ON UPDATE CASCADE,
    app_uid VARCHAR(40) NOT NULL,
    region VARCHAR(64) NOT NULL,
    start_at BIGINT NOT NULL,
    every_ms BIGINT DEFAULT NULL,
    cron VARCHAR(128) DEFAULT NULL,
    tz VARCHAR(64) NOT NULL DEFAULT 'UTC',
    ends_at BIGINT DEFAULT NULL,
    rate_per_hour INTEGER NOT NULL,
    min_gap_ms BIGINT DEFAULT NULL,
    handler_depth SMALLINT NOT NULL DEFAULT 0,
    action VARCHAR(64) DEFAULT NULL,
    payload JSONB DEFAULT NULL,
    state VARCHAR(16) NOT NULL DEFAULT 'active',
    send_token VARCHAR(64) DEFAULT NULL,
    send_until BIGINT DEFAULT NULL,
    end_reason VARCHAR(32) DEFAULT NULL,
    version BIGINT NOT NULL DEFAULT 1,
    deleted_at BIGINT DEFAULT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_schedules_ns_region_updated
    ON event_schedules (namespace, region, updated_at, id);
CREATE INDEX IF NOT EXISTS idx_event_schedules_ns_region_id
    ON event_schedules (namespace, region, id);
CREATE INDEX IF NOT EXISTS idx_event_schedules_holder
    ON event_schedules (holder_user_id, app_uid, deleted_at);
CREATE INDEX IF NOT EXISTS idx_event_schedules_sub
    ON event_schedules (sub_id);
CREATE INDEX IF NOT EXISTS idx_event_schedules_app_kind
    ON event_schedules (app_uid, kind);
CREATE INDEX IF NOT EXISTS idx_event_schedules_deleted
    ON event_schedules (deleted_at);
