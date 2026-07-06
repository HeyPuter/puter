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

-- Append-only log of admin moderation actions. Mirrors SQLite migration 0064 /
-- MySQL mysql_mig_19. Used to measure the abuse system's false-positive rate:
-- `unsuspend` (admin unblock) and `admin_create_user` are the false-positive
-- signals; `suspend` gives the denominator. Preserves history the `user`
-- suspension columns lose on unsuspend. `created_at` is unix seconds.
--
-- Idempotent via IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS abuse_moderation_events (
    id BIGSERIAL PRIMARY KEY,
    action VARCHAR(32) NOT NULL,
    target_user_id BIGINT DEFAULT NULL,
    target_username VARCHAR(255) DEFAULT NULL,
    admin_username VARCHAR(255) DEFAULT NULL,
    reason TEXT DEFAULT NULL,
    source VARCHAR(64) DEFAULT NULL,
    created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_abuse_moderation_events_created_at
    ON abuse_moderation_events (created_at);
CREATE INDEX IF NOT EXISTS idx_abuse_moderation_events_action
    ON abuse_moderation_events (action);
