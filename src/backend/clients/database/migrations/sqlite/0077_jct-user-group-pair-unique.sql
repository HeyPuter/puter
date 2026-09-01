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

-- `GroupStore.addUsers` is an INSERT ... SELECT with no conflict clause, so a
-- repeated call inserts a second row for the same (user_id, group_id).
--
-- Each duplicate multiplies every row `readUserGroupPerms` returns, because it
-- joins this table on group_id alone -- two membership rows means every group
-- permission is reported twice. The index below stops that recurring; the
-- delete clears what already accumulated.
--
-- Dropping the higher-id row discards nothing: `addUsers` writes only the two
-- id columns, so `extra` and `metadata` are NULL on every row here, nothing has
-- a foreign key to `jct_user_group.id`, and no code reads it.

DELETE FROM `jct_user_group`
WHERE `id` NOT IN (
    SELECT MIN(`id`) FROM `jct_user_group` GROUP BY `user_id`, `group_id`
);

CREATE UNIQUE INDEX IF NOT EXISTS `idx_jct_user_group_pair`
    ON `jct_user_group` (`user_id`, `group_id`);
