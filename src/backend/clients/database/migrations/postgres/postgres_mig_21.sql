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

-- Teams. See sqlite/0077_teams.sql for the column rationale.
-- Idempotent via IF NOT EXISTS; there is no per-file applied-state tracking.

ALTER TABLE "group" ADD COLUMN IF NOT EXISTS kind       text;
ALTER TABLE "group" ADD COLUMN IF NOT EXISTS name       text;
ALTER TABLE "group" ADD COLUMN IF NOT EXISTS handle     text;
ALTER TABLE "group" ADD COLUMN IF NOT EXISTS deleted_at timestamp;

-- On lower(handle): text is case-sensitive here, unlike MySQL's utf8mb4_unicode_ci.
-- Handle lookups must therefore compare lower(handle) to hit this index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_group_handle ON "group" (lower(handle));

-- No idx_group_owner here: idx_group_owner_user_id already covers it.

ALTER TABLE jct_user_group ADD COLUMN IF NOT EXISTS org_owned smallint;

-- Composite, unlike the existing single-column idx_jct_user_group_group_id.
CREATE INDEX IF NOT EXISTS idx_jct_user_group_group
    ON jct_user_group (group_id, user_id);

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS requires_password_change smallint NOT NULL DEFAULT 0;
