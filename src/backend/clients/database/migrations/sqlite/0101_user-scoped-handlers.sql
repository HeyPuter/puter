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

-- Handlers an app's user published into their own scope, in a table of their
-- own so `event_handlers` stays the app owner's set. Same columns as
-- `event_handlers` (see 0076_event-handlers.sql) plus the holder.
--
--   - `holder_user_id` : the user whose scope this is. A name is unique per
--                        (app, holder), so the same name can live in the app's
--                        set and in each holder's.
--   - `(holder_user_id, app_uid)` : a holder's scopes, for listing and for the
--                        rent count.
--
-- `event_subscriptions.handler_scope` says which table a row's `handler_name`
-- refers to: 0 the app's set, 1 the row holder's scope.

CREATE TABLE IF NOT EXISTS `event_user_handlers` (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "app_uid" TEXT NOT NULL,
    "holder_user_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_hash" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL,    -- unix seconds
    "updated_at" INTEGER NOT NULL,
    "scope_since" INTEGER NOT NULL    -- unix seconds; the scope's first handler, kept across churn
);

CREATE UNIQUE INDEX IF NOT EXISTS `idx_event_user_handlers_app_holder_name`
    ON `event_user_handlers` (`app_uid`, `holder_user_id`, `name`);
CREATE INDEX IF NOT EXISTS `idx_event_user_handlers_holder_app`
    ON `event_user_handlers` (`holder_user_id`, `app_uid`);

ALTER TABLE `event_subscriptions` ADD COLUMN `handler_scope` INTEGER NOT NULL DEFAULT 0;
