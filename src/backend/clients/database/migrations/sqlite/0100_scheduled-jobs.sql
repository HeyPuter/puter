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

-- System jobs that run once per cadence across every node sharing this
-- database. One row per (deployment namespace, job name), so deployments that
-- share a database never run each other's jobs.
--
--   - `next_run_at`  : epoch ms the job is next due.
--   - `lease_until`  : epoch ms by the database's clock until which the
--                      current run holds the job; null when nobody does.
--   - `lease_token`  : fencing token of the current run. Renewals, state
--                      saves and the finish only apply while it still matches.
--   - `lease_owner`  : which node holds the lease, for logs.
--   - `state`        : JSON the job carries from one run to the next.
--   - `failures`     : consecutive failed runs.

CREATE TABLE IF NOT EXISTS `scheduled_jobs` (
    "namespace" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "next_run_at" INTEGER NOT NULL,
    "lease_until" INTEGER DEFAULT NULL,
    "lease_token" TEXT DEFAULT NULL,
    "lease_owner" TEXT DEFAULT NULL,
    "state" TEXT DEFAULT NULL,
    "last_run_at" INTEGER DEFAULT NULL,
    "last_duration_ms" INTEGER DEFAULT NULL,
    "last_error" TEXT DEFAULT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "updated_at" INTEGER NOT NULL,
    PRIMARY KEY ("namespace", "name")
);
