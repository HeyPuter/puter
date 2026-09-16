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

-- "Anyone with the link": a share row with no holder of any kind — not a
-- person, not a team, not an invite. `anyone` is 1 on such a row and NULL on
-- every other, so the unique index binds only these: one per node, whoever
-- last set it. No permission row stands behind it; ACLService reads the share
-- row itself, and honours it only while the owner's plan covers link sharing.

ALTER TABLE `share` ADD COLUMN `anyone` INTEGER DEFAULT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS `idx_share_anyone`
    ON `share` (`fsentry_id`, `anyone`);
