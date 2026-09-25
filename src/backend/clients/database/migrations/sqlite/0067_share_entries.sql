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

-- Grow `share` from a pending-email-invite table into the index of active
-- shares. Permissions stay the source of truth for access; this is what makes
-- shares listable and gives them a lifecycle.
--
--   - `holder_user_id` : NULL while an invite awaits signup.
--   - `fsentry_id`     : the shared node. ON DELETE CASCADE retires the share
--                        with the file, which permissions alone don't do.
--   - `mode`           : see|list|read|write|manage. Unconstrained on purpose —
--                        ACLService owns the mode set and adding one shouldn't
--                        need a three-dialect migration.
--   - `applied_at`     : set when an invite is claimed. Claiming updates the
--                        row rather than deleting it, so the share stays
--                        queryable.

ALTER TABLE `share` ADD COLUMN `holder_user_id` INTEGER DEFAULT NULL
    REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `share` ADD COLUMN `fsentry_id` INTEGER DEFAULT NULL
    REFERENCES `fsentries` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `share` ADD COLUMN `mode` TEXT DEFAULT NULL;
ALTER TABLE `share` ADD COLUMN `applied_at` TIMESTAMP DEFAULT NULL;

-- "Shared with me", keyset-paginated: ORDER BY ends in `id` as the tiebreaker.
CREATE INDEX IF NOT EXISTS `idx_share_holder`
    ON `share` (`holder_user_id`, `id`);

-- Who has access to one node — also how an owner sees a manage-delegate's
-- re-grants, which the issuer/holder permission tables can't answer.
CREATE INDEX IF NOT EXISTS `idx_share_fsentry` ON `share` (`fsentry_id`);

-- One row per (holder, node, issuer). Pending invites have a NULL
-- holder_user_id and so aren't covered here; dedup for those belongs with the
-- invite flow.
CREATE UNIQUE INDEX IF NOT EXISTS `idx_share_holder_entry_issuer`
    ON `share` (`holder_user_id`, `fsentry_id`, `issuer_user_id`);

-- Retiring a deleted node's grants looks them up by permission text
-- (`fs:<uuid>` and `fs:<uuid>:%`), and the subject only lives in that text —
-- no column, so no foreign key can cascade it. The table's primary key is
-- (issuer, holder, permission), which never puts `permission` first, so
-- without this the equality and the left-anchored LIKE both degrade to a full
-- scan on the delete path. With it, each is a range scan.
CREATE INDEX IF NOT EXISTS `idx_user_to_user_permissions_permission`
    ON `user_to_user_permissions` (`permission`);
