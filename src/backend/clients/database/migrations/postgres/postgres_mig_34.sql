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

-- Mirrors SQLite migration 0090, as postgres_mig_11 did for user_to_user.
-- text_pattern_ops is what makes the left-anchored LIKE a range scan under a
-- non-C collation -- the plain index dev_to_app already has does not.
CREATE INDEX IF NOT EXISTS idx_user_to_app_permissions_permission
    ON user_to_app_permissions (permission text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_dev_to_app_permissions_permission_pattern
    ON dev_to_app_permissions (permission text_pattern_ops);
