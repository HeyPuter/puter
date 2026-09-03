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

-- Named handlers an app deploys once and its users' subscriptions bind to by
-- name. A handler is an addressable object with its own lifecycle: nothing
-- triggers by name, and a row here runs only when a subscription bound to it
-- has a delivery.
--
--   - `app_uid`     : the namespace. Names are unique per app, and there is no
--                     foreign key for the same reason `event_subscriptions`
--                     has none — a row has to stay manageable after the app
--                     row moves.
--   - `name`        : the identity a subscription binds to, stable across
--                     source changes.
--   - `source`      : the serialized function. Read only by the delivery path
--                     and never returned by `list`.
--   - `source_hash` : change detector and idempotency key. A publish carrying
--                     the same hash is a no-op, and a subscription sending an
--                     inline hash binds only when it matches this one.
--
-- `created_at` / `updated_at` are unix seconds, matching `event_subscriptions`.

CREATE TABLE IF NOT EXISTS `event_handlers` (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "app_uid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_hash" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL,    -- unix seconds
    "updated_at" INTEGER NOT NULL
);

-- The name is the identity, and it is unique inside one app. This index is
-- also the lookup a subscribe binding check runs on.
CREATE UNIQUE INDEX IF NOT EXISTS `idx_event_handlers_app_name`
    ON `event_handlers` (`app_uid`, `name`);
