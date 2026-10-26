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

-- Share levels on kv_share_handles. See
-- sqlite/0095_kv-share-handle-levels.sql for the rationale. Idempotent via
-- IF NOT EXISTS; there is no per-file applied-state tracking.

ALTER TABLE kv_share_handles ADD COLUMN IF NOT EXISTS revoked_by VARCHAR(8) DEFAULT NULL;
ALTER TABLE kv_share_handles ADD COLUMN IF NOT EXISTS label VARCHAR(512) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_kv_share_handles_grantee
    ON kv_share_handles (grantee_user_id, id);

CREATE INDEX IF NOT EXISTS idx_kv_share_handles_app
    ON kv_share_handles (app_uid);
