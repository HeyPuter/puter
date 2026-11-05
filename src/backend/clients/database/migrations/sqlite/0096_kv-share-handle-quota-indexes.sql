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

-- Indexes behind the share-handle quotas, the app-filtered listings and the
-- retention purge on `kv_share_handles`.
--
--   - owner_live  : the owner's live count, in total and per app, read off
--                   the index alone.
--   - owner_app   : the owner's listing narrowed to one app, in id order.
--   - grantee_app : the holder's listing narrowed to one app, in id order.
--   - pair        : live handles one owner holds out to one holder, counted at
--                   mint and walked on revoke and unshare.
--   - revoked     : retired rows past retention, for the purge.

CREATE INDEX IF NOT EXISTS `idx_kv_share_handles_owner_live`
    ON `kv_share_handles` (`owner_user_id`, `revoked_at`, `app_uid`);

CREATE INDEX IF NOT EXISTS `idx_kv_share_handles_owner_app`
    ON `kv_share_handles` (`owner_user_id`, `app_uid`, `id`);

CREATE INDEX IF NOT EXISTS `idx_kv_share_handles_grantee_app`
    ON `kv_share_handles` (`grantee_user_id`, `app_uid`, `id`);

CREATE INDEX IF NOT EXISTS `idx_kv_share_handles_pair`
    ON `kv_share_handles` (`owner_user_id`, `grantee_user_id`, `revoked_at`);

CREATE INDEX IF NOT EXISTS `idx_kv_share_handles_revoked`
    ON `kv_share_handles` (`revoked_at`);
