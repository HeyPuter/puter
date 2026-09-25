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

-- Grow share from a pending-email-invite table into the index of active
-- shares. See sqlite/0067_share_entries.sql for the column rationale.

ALTER TABLE share
  ADD COLUMN IF NOT EXISTS holder_user_id integer
      REFERENCES "user" (id) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD COLUMN IF NOT EXISTS fsentry_id integer
      REFERENCES fsentries (id) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD COLUMN IF NOT EXISTS mode varchar(20),
  ADD COLUMN IF NOT EXISTS applied_at timestamp;

CREATE INDEX IF NOT EXISTS idx_share_holder
    ON share (holder_user_id, id);
CREATE INDEX IF NOT EXISTS idx_share_fsentry
    ON share (fsentry_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_share_holder_entry_issuer
    ON share (holder_user_id, fsentry_id, issuer_user_id);

-- Retiring a deleted node's grants looks them up by permission text, and the
-- primary key is (issuer, holder, permission) — `permission` is never the
-- leading column, so the delete path would otherwise scan the table. The
-- text_pattern_ops class is what makes the left-anchored LIKE a range scan
-- under a non-C collation; plain equality still uses it.
CREATE INDEX IF NOT EXISTS idx_user_to_user_permissions_permission
    ON user_to_user_permissions (permission text_pattern_ops);
