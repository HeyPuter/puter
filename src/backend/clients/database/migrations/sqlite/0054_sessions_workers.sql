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
-- (user_id, app_uid, worker_name).
--
-- SQLite UNIQUE indexes treat NULLs as distinct (per the SQL standard),
-- so user-scoped workers (where `app_uid` is NULL) would otherwise be
-- allowed to duplicate. IFNULL collapses NULL `app_uid` to empty
-- string in the index expression so two user-scoped workers with the
-- same worker_name correctly conflict. MySQL handles the same case
-- via the IFNULL in mig_11's generated column.

CREATE UNIQUE INDEX IF NOT EXISTS `idx_sessions_user_worker_active`
    ON `sessions` (`user_id`, IFNULL(`app_uid`, ''), json_extract(`meta`, '$.worker_name'))
    WHERE `kind` = 'worker' AND `revoked_at` IS NULL;
