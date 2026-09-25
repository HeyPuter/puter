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

-- Drops three groups that no code has ever read: `freeai`, `experimental` and
-- `dangerous`. No migration creates them — they were added by hand back when
-- hardcoded permissions were keyed by group name. That map is now a flat
-- per-user floor (`default_user_permissions` in data/hardcoded-permissions.js),
-- so a group nothing looks up grants nothing, and the rows are dead weight.
--
-- Guarded, and deliberately so: `user_to_group_permissions.group_id` and
-- `jct_user_group.group_id` both cascade on delete, so removing a group that
-- still carries permissions or members would silently revoke them from every
-- member. Only a group with neither is dropped. A group that survives this
-- migration has dependents and needs a deliberate decision, not a sweep --
-- query `user_to_group_permissions` by `group_id` to see what it holds.
DELETE FROM `group`
WHERE json_extract(`extra`, '$.name') IN ('freeai', 'experimental', 'dangerous')
  AND `id` NOT IN (SELECT `group_id` FROM `user_to_group_permissions`)
  AND `id` NOT IN (SELECT `group_id` FROM `jct_user_group`);
