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

-- Extend `sessions` so a single row can represent any token kind
-- (web/app/access_token/asset), carry display metadata for the
-- manage-sessions UI, and be soft-revoked.

ALTER TABLE `sessions` ADD COLUMN `kind` TEXT NOT NULL DEFAULT 'web'
    CHECK (`kind` IN ('web', 'app', 'access_token', 'asset'));
ALTER TABLE `sessions` ADD COLUMN `label` TEXT;
ALTER TABLE `sessions` ADD COLUMN `parent_session_id` TEXT;
ALTER TABLE `sessions` ADD COLUMN `last_ip` TEXT;
ALTER TABLE `sessions` ADD COLUMN `last_user_agent` TEXT;
ALTER TABLE `sessions` ADD COLUMN `revoked_at` INTEGER;
ALTER TABLE `sessions` ADD COLUMN `expires_at` INTEGER;

CREATE INDEX IF NOT EXISTS `idx_sessions_user_revoked`
    ON `sessions` (`user_id`, `revoked_at`);
CREATE INDEX IF NOT EXISTS `idx_sessions_parent`
    ON `sessions` (`parent_session_id`);
