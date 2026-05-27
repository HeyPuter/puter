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

-- Worker session uniqueness. One active kind='worker' row per
-- (user_id, app_uid, worker_name). app_uid is allowed NULL for
-- user-scoped workers; SQLite treats two NULL values as distinct, so
-- the (NULL, worker_name) case still deduplicates correctly via the
-- worker_name component. Mirrors the MySQL `worker_unique_key`
-- approach using a partial unique index with `json_extract` on `meta`.

CREATE UNIQUE INDEX IF NOT EXISTS `idx_sessions_user_worker_active`
    ON `sessions` (`user_id`, `app_uid`, json_extract(`meta`, '$.worker_name'))
    WHERE `kind` = 'worker' AND `revoked_at` IS NULL;
