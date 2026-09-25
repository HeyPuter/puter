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

-- Opaque names for shared regions of a user's key-value namespace. See
-- sqlite/0080_kv-share-handles.sql for the column rationale.
--
-- Idempotent via IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS kv_share_handles (
    id BIGSERIAL PRIMARY KEY,
    handle VARCHAR(64) NOT NULL,
    owner_user_id INTEGER NOT NULL
        REFERENCES "user" (id) ON DELETE CASCADE ON UPDATE CASCADE,
    grantee_user_id INTEGER NOT NULL
        REFERENCES "user" (id) ON DELETE CASCADE ON UPDATE CASCADE,
    app_uid VARCHAR(40) NOT NULL,
    key_prefix VARCHAR(1024) NOT NULL,
    permission VARCHAR(1024) NOT NULL,
    created_at BIGINT NOT NULL,
    revoked_at BIGINT DEFAULT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kv_share_handles_handle
    ON kv_share_handles (handle);

CREATE INDEX IF NOT EXISTS idx_kv_share_handles_owner
    ON kv_share_handles (owner_user_id, id);

-- A cascading delete has to find the child rows, and postgres does not index
-- FK columns for you.
CREATE INDEX IF NOT EXISTS idx_kv_share_handles_grantee_fk
    ON kv_share_handles (grantee_user_id);

-- A subscription made through a handle stores the grant string it was
-- authorized under rather than an access mode, and a grant string carries a
-- user uuid, an app uid and a key prefix.
--
-- Guarded: an unconditional ALTER COLUMN TYPE takes an ACCESS EXCLUSIVE lock
-- on every replay, even widening to the same type. Skipped once the column is
-- already wide enough.
DO $$
BEGIN
    IF (
        SELECT character_maximum_length FROM information_schema.columns
        WHERE table_name = 'event_subscriptions' AND column_name = 'permission'
    ) < 1024 THEN
        ALTER TABLE event_subscriptions
            ALTER COLUMN permission TYPE VARCHAR(1024);
    END IF;
END $$;
