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

-- Replace UNIQUE(name) on old_app_names with UNIQUE(app_uid, name).
-- The original constraint blocked the same name from cycling through
-- multiple apps over time and made it impossible for AppStore to use
-- ON CONFLICT(app_uid, name) DO UPDATE to refresh the timestamp when
-- an app re-records its previous name. SQLite has no ALTER TABLE
-- DROP CONSTRAINT, so we recreate the table.

CREATE TABLE `old_app_names_new` (
    `id` INTEGER PRIMARY KEY AUTOINCREMENT,
    `app_uid` char(40) NOT NULL,
    `name` varchar(100) NOT NULL,
    `timestamp` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (`app_uid`, `name`),
    FOREIGN KEY (`app_uid`) REFERENCES `apps`(`uid`) ON DELETE CASCADE
);

INSERT INTO `old_app_names_new` (`id`, `app_uid`, `name`, `timestamp`)
    SELECT `id`, `app_uid`, `name`, `timestamp` FROM `old_app_names`;

DROP TABLE `old_app_names`;

ALTER TABLE `old_app_names_new` RENAME TO `old_app_names`;

CREATE INDEX `idx_old_app_names_name` ON `old_app_names` (`name`);
