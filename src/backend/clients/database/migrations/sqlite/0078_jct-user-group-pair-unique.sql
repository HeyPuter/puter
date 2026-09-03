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

-- `GroupStore.addUsers` had no conflict clause, so a repeat call duplicated the pair.
-- `readUserGroupPerms` joins this table on group_id alone, so each duplicate reported
-- every group permission an extra time. The delete clears what accumulated.
-- Dropping the higher id is lossless: `addUsers` writes only the two id columns, and
-- nothing references `jct_user_group.id`.

DELETE FROM `jct_user_group`
WHERE `id` NOT IN (
    SELECT MIN(`id`) FROM `jct_user_group` GROUP BY `user_id`, `group_id`
);

CREATE UNIQUE INDEX IF NOT EXISTS `idx_jct_user_group_pair`
    ON `jct_user_group` (`user_id`, `group_id`);
