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

-- What share levels need from `kv_share_handles`. The level itself is not a
-- column: it is the root of the stored `permission`.
--
--   - `revoked_by` : `owner`, `holder` or `system` (the namespace app was
--                    deleted). Null while live, and on rows retired before
--                    this existed.
--   - `label`      : optional owner-set text the holder is shown.
--   - the grantee index serves the holder's listing and their unshare, and
--     the app index retiring a deleted app's handles.

ALTER TABLE `kv_share_handles` ADD COLUMN `revoked_by` TEXT DEFAULT NULL;
ALTER TABLE `kv_share_handles` ADD COLUMN `label` TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS `idx_kv_share_handles_grantee`
    ON `kv_share_handles` (`grantee_user_id`, `id`);

CREATE INDEX IF NOT EXISTS `idx_kv_share_handles_app`
    ON `kv_share_handles` (`app_uid`);
