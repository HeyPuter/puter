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

-- Insert-only record of what an admin did to an account, plus `share.holder_group_id`.

CREATE TABLE IF NOT EXISTS `audit_team_membership` (
    "id"            INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Nullable FK beside a NOT NULL `_keep`, as `audit_user_to_group_permissions` since 0019.
    "group_id"      INTEGER DEFAULT NULL,
    "group_id_keep" INTEGER NOT NULL,
    "user_id"       INTEGER DEFAULT NULL,
    "user_id_keep"  INTEGER NOT NULL,
    "actor_user_id" INTEGER DEFAULT NULL,

    "action"        TEXT      NOT NULL,
    "reason"        TEXT      DEFAULT NULL,
    "created_at"    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- SET NULL, never CASCADE: deleting an account must not erase what was done to it.
    FOREIGN KEY("group_id")      REFERENCES "group" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY("user_id")       REFERENCES "user"  ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY("actor_user_id") REFERENCES "user"  ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- The admin's view: one workspace, newest first.
CREATE INDEX IF NOT EXISTS `idx_audit_team_membership_group`
    ON `audit_team_membership` (`group_id_keep`, `id`);

-- The member's view; the only place a reset becomes visible to its subject.
CREATE INDEX IF NOT EXISTS `idx_audit_team_membership_user`
    ON `audit_team_membership` (`user_id_keep`, `id`);

-- Without these, SET NULL scans the audit table on every user or group delete.
CREATE INDEX IF NOT EXISTS `idx_audit_team_membership_group_fk`
    ON `audit_team_membership` (`group_id`);
CREATE INDEX IF NOT EXISTS `idx_audit_team_membership_user_fk`
    ON `audit_team_membership` (`user_id`);
CREATE INDEX IF NOT EXISTS `idx_audit_team_membership_actor_fk`
    ON `audit_team_membership` (`actor_user_id`);

-- Mirrors `holder_user_id` from 0067: a `share` row is a listing entry, not the grant.
ALTER TABLE `share` ADD COLUMN `holder_group_id` INTEGER DEFAULT NULL
    REFERENCES `group` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS `idx_share_holder_group`
    ON `share` (`holder_group_id`, `id`);

-- Team shares leave `holder_user_id` NULL, and NULLs are distinct, so the existing
-- unique index binds none of them.
CREATE UNIQUE INDEX IF NOT EXISTS `idx_share_holder_group_entry_issuer`
    ON `share` (`holder_group_id`, `fsentry_id`, `issuer_user_id`);
