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

-- Schedule definitions: what `puter.events.onSchedule` stores. The next run
-- is never stored; it is computed from the definition, which never changes
-- after create.
--
--   - `uid`          : the public scheduleId.
--   - `namespace`    : the deployment the row belongs to, so deployments
--                      sharing a database never pick up each other's rows.
--   - `kind`         : `recurring`, `once`, or `deferred` (a delayed
--                      notification, which runs no handler).
--   - `sub_id`       : the `event_subscriptions` row a recurring or `once`
--                      schedule owns, set right after both inserts; NULL for
--                      `deferred`.
--   - `region`       : where the schedule fires.
--   - `start_at`     : the `every` origin, the earliest cron run, or a
--                      one-shot's time. Epoch ms, whole seconds.
--   - `ends_at`      : last allowed run, inclusive; equals `start_at` for a
--                      one-shot.
--   - `rate_per_hour`: worst-case runs in any hour, times 1000; 0 for a
--                      one-shot. What the fire budget sums.
--   - `min_gap_ms`   : smallest gap between runs; NULL for a one-shot.
--   - `handler_depth`: the creator's handler depth; runs happen at it.
--   - `action`, `payload`, `send_token`, `send_until`: `deferred` rows only.
--   - `state`        : `active`; `deferred` rows also `sending` and
--                      `delivered`; `done` once finished.
--   - `version`      : bumped by every UPDATE; orders changes to one row.
--   - `resume_epoch` : bumped by every resume; a run reset follows it.
--   - `deleted_at`   : soft delete, kept for a week so a listing shows why a
--                      schedule ended (`end_reason`).
--
-- Times are epoch ms.

CREATE TABLE IF NOT EXISTS `event_schedules` (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "uid" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sub_id" TEXT DEFAULT NULL,
    "holder_user_id" INTEGER NOT NULL
        REFERENCES `user` ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "app_uid" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "start_at" INTEGER NOT NULL,
    "every_ms" INTEGER DEFAULT NULL,
    "cron" TEXT DEFAULT NULL,
    "tz" TEXT NOT NULL DEFAULT 'UTC',
    "ends_at" INTEGER DEFAULT NULL,
    "rate_per_hour" INTEGER NOT NULL,
    "min_gap_ms" INTEGER DEFAULT NULL,
    "handler_depth" INTEGER NOT NULL DEFAULT 0,
    "action" TEXT DEFAULT NULL,
    "payload" TEXT DEFAULT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "send_token" TEXT DEFAULT NULL,
    "send_until" INTEGER DEFAULT NULL,
    "end_reason" TEXT DEFAULT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "resume_epoch" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" INTEGER DEFAULT NULL,
    "created_at" INTEGER NOT NULL,
    "updated_at" INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS `idx_event_schedules_uid`
    ON `event_schedules` (`uid`);

-- Reconcile: rows changed since a cursor, in one region.
CREATE INDEX IF NOT EXISTS `idx_event_schedules_ns_region_updated`
    ON `event_schedules` (`namespace`, `region`, `updated_at`, `id`);

-- Full diff and rebuild: every row of one region, by id.
CREATE INDEX IF NOT EXISTS `idx_event_schedules_ns_region_id`
    ON `event_schedules` (`namespace`, `region`, `id`);

-- Caps and uninstall.
CREATE INDEX IF NOT EXISTS `idx_event_schedules_holder`
    ON `event_schedules` (`holder_user_id`, `app_uid`, `deleted_at`);

-- A holder's listing, account-wide and for one app, in id order.
CREATE INDEX IF NOT EXISTS `idx_event_schedules_holder_ns_id`
    ON `event_schedules` (`holder_user_id`, `namespace`, `id`);
CREATE INDEX IF NOT EXISTS `idx_event_schedules_holder_ns_app_id`
    ON `event_schedules` (`holder_user_id`, `namespace`, `app_uid`, `id`);

-- Lifecycle hooks, which start from a subscription row.
CREATE INDEX IF NOT EXISTS `idx_event_schedules_sub`
    ON `event_schedules` (`sub_id`);

-- Delayed notifications of a deleted app.
CREATE INDEX IF NOT EXISTS `idx_event_schedules_app_kind`
    ON `event_schedules` (`app_uid`, `kind`);

-- Purge of soft-deleted rows.
CREATE INDEX IF NOT EXISTS `idx_event_schedules_deleted`
    ON `event_schedules` (`deleted_at`);
