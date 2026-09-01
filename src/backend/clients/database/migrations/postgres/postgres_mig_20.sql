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

-- Deduplicate then constrain. See sqlite/0075 for why this is lossless.

-- Guarded because postgres re-runs every file on each boot; `to_regclass` follows
-- search_path, so it resolves under a test schema too.
DO $mig15$
BEGIN
    IF to_regclass('idx_jct_user_group_pair') IS NULL THEN
        DELETE FROM jct_user_group
        WHERE id NOT IN (
            SELECT MIN(id) FROM jct_user_group GROUP BY user_id, group_id
        );
    END IF;
END
$mig15$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_jct_user_group_pair
    ON jct_user_group (user_id, group_id);
