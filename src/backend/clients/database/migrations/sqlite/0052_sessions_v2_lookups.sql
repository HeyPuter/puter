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

-- Composite-key lookups + audit columns.
--   - `app_uid`           : binds `kind='app'` rows to their app authorization
--                           target. (user_id, app_uid) is the idempotency key.
--   - `legacy_token_uid`  : keys lazy-backfilled rows to the v1 token_uid that
--                           originally minted them.
--   - `created_via`       : audit sentinel (e.g. 'legacy_backfill').
--   - `auth_id`           : stable per-user identity that survives re-login;
--                           lets manage-sessions group by identity.

ALTER TABLE `sessions` ADD COLUMN `app_uid` TEXT;
ALTER TABLE `sessions` ADD COLUMN `legacy_token_uid` TEXT;
ALTER TABLE `sessions` ADD COLUMN `created_via` TEXT;
ALTER TABLE `sessions` ADD COLUMN `auth_id` TEXT;

-- Partial unique indexes keep "at most one active row per key" without
-- breaking the soft-revoke pattern (revoked rows stay for audit).

CREATE UNIQUE INDEX IF NOT EXISTS `idx_sessions_user_app_active`
    ON `sessions` (`user_id`, `app_uid`)
    WHERE `kind` = 'app' AND `revoked_at` IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS `idx_sessions_legacy_token_active`
    ON `sessions` (`legacy_token_uid`)
    WHERE `legacy_token_uid` IS NOT NULL AND `revoked_at` IS NULL;

-- Supports manage-sessions list queries grouped by kind.
CREATE INDEX IF NOT EXISTS `idx_sessions_kind_user`
    ON `sessions` (`kind`, `user_id`);
