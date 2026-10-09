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

-- The owner of the shared entry, recorded on the share row.
--
-- The outbound listings answer "shares on things I own that someone else
-- issued" by joining `share` to `fsentries` and filtering on the owner there.
-- Neither side of that join bounds the work: driven from `fsentries` it walks
-- every file the user owns, driven from `share` it walks every share until it
-- has a page. `#outboundAppsSql` has no LIMIT at all.
--
-- Written with the row, and re-pointed when a move re-owns the subtree it
-- names; `FSService.move` does that whenever the destination is someone
-- else's tree.

ALTER TABLE `share` ADD COLUMN `entry_owner_user_id` INTEGER DEFAULT NULL;

CREATE INDEX IF NOT EXISTS `idx_share_entry_owner`
    ON `share` (`entry_owner_user_id`, `id`);

UPDATE `share`
SET `entry_owner_user_id` = (
        SELECT `user_id` FROM `fsentries` WHERE `fsentries`.`id` = `share`.`fsentry_id`
    )
WHERE `fsentry_id` IS NOT NULL
  AND `entry_owner_user_id` IS NULL;
