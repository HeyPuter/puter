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

-- A `group` row with `kind = 'team'` owns accounts and pays for them; seeded
-- system groups keep `kind` NULL so a team query never returns them.

ALTER TABLE `group` ADD COLUMN `kind`       TEXT      DEFAULT NULL;
ALTER TABLE `group` ADD COLUMN `name`       TEXT      DEFAULT NULL;
ALTER TABLE `group` ADD COLUMN `handle`     TEXT      COLLATE NOCASE DEFAULT NULL;
ALTER TABLE `group` ADD COLUMN `deleted_at` TIMESTAMP DEFAULT NULL;

-- NOCASE on both column and index, so lookups match mysql's utf8mb4_unicode_ci.
CREATE UNIQUE INDEX IF NOT EXISTS `idx_group_handle`
    ON `group` (`handle` COLLATE NOCASE);

-- mysql and postgres already index this column; sqlite does not.
CREATE INDEX IF NOT EXISTS `idx_group_owner` ON `group` (`owner_user_id`);

-- 1 = workspace-created, 0 = the workspace owner. Decides who pays, not who may read.
ALTER TABLE `jct_user_group` ADD COLUMN `org_owned` INTEGER DEFAULT NULL;

-- Covers "list this workspace's members"; the unique pair index lands in 0072.
CREATE INDEX IF NOT EXISTS `idx_jct_user_group_group`
    ON `jct_user_group` (`group_id`, `user_id`);

-- Fourth `requires_*` flag; assertVerifiedAccount will enforce it in phase 5.
ALTER TABLE `user` ADD COLUMN `requires_password_change` INTEGER NOT NULL DEFAULT 0;
