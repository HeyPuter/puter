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

-- An opaque name for a region of one user's key-value namespace that somebody
-- else may watch. Key-value subjects carry no owner component, so without this
-- a shared key is unaddressable: the handle is what a filesystem node uid
-- already is, an owner-independent name for a shared root.
--
--   - `handle`        : `kvh-<uuid>`, deliberately shaped unlike an app uid so
--                       the subject parser can tell which slot it is in. It is
--                       the only form the grantee ever sees, and it names
--                       neither the owner's username nor their uuid.
--   - `permission`    : the user-to-user grant this handle mirrors. Stored
--                       rather than derived: it is the key revocation settling
--                       matches subscriptions on, and deriving it would tie the
--                       settle path to a lookup per row.
--   - `key_prefix`    : the granted root, always ending on the key delimiter,
--                       so `key_prefix + relative` is a whole key.
--   - `revoked_at`    : set rather than deleted. A revoked handle stays visible
--                       to its owner, which is the only record of what was
--                       shared and when it stopped.
--
-- `created_at` / `revoked_at` are unix seconds, matching `event_subscriptions`.

CREATE TABLE IF NOT EXISTS `kv_share_handles` (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "handle" TEXT NOT NULL,
    "owner_user_id" INTEGER NOT NULL
        REFERENCES `user` ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "grantee_user_id" INTEGER NOT NULL
        REFERENCES `user` ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "app_uid" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL,    -- unix seconds
    "revoked_at" INTEGER DEFAULT NULL
);

-- Resolving a subject is a lookup by handle, on the subscribe path.
CREATE UNIQUE INDEX IF NOT EXISTS `idx_kv_share_handles_handle`
    ON `kv_share_handles` (`handle`);

-- The owner's audit listing, and the scope check behind revoke.
CREATE INDEX IF NOT EXISTS `idx_kv_share_handles_owner`
    ON `kv_share_handles` (`owner_user_id`, `id`);
