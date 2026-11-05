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

-- The owner of the shared entry, recorded on the share row. Mirrors SQLite
-- migration 0092. Guarded like mysql_mig_45, because there is no per-file
-- applied-state tracking and a replay must do nothing.

ALTER TABLE "share" ADD COLUMN IF NOT EXISTS entry_owner_user_id BIGINT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_share_entry_owner
    ON "share" (entry_owner_user_id, id);

UPDATE "share"
SET entry_owner_user_id = f.user_id
FROM fsentries f
WHERE f.id = "share".fsentry_id
  AND "share".fsentry_id IS NOT NULL
  AND "share".entry_owner_user_id IS NULL;
