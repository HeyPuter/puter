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

-- A deleted app takes the subdomain rows it owns (its hosted sites and its
-- workers) with it. `SET NULL` left them behind as unowned rows, and an
-- unowned worker row is redeployed with the account's own credential.
-- SQLite cannot alter a constraint, so the table is rebuilt as 0043 does.

PRAGMA foreign_keys = OFF;

CREATE TABLE `subdomains_new` (
  `id` INTEGER PRIMARY KEY,
  `uuid` varchar(40) DEFAULT NULL,
  `subdomain` varchar(64) NOT NULL,
  `user_id` int(10) NOT NULL,
  `root_dir_id` int(10) DEFAULT NULL,
  `associated_app_id` int(10) DEFAULT NULL,
  `ts` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `app_owner` int(10) DEFAULT NULL,
  `protected` tinyint(1) DEFAULT '0',
  `domain` varchar(256) DEFAULT NULL,
  `database_id` varchar(40) DEFAULT NULL,
  `preamble_version` varchar(64) DEFAULT NULL,
  FOREIGN KEY (`app_owner`) REFERENCES `apps` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO `subdomains_new`
  (`id`, `uuid`, `subdomain`, `user_id`, `root_dir_id`, `associated_app_id`, `ts`,
   `app_owner`, `protected`, `domain`, `database_id`, `preamble_version`)
SELECT
   `id`, `uuid`, `subdomain`, `user_id`, `root_dir_id`, `associated_app_id`, `ts`,
   `app_owner`, `protected`, `domain`, `database_id`, `preamble_version`
FROM `subdomains`;

DROP TABLE `subdomains`;
ALTER TABLE `subdomains_new` RENAME TO `subdomains`;

PRAGMA foreign_keys = ON;
