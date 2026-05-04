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

CREATE TABLE `new_kv` (
    `id` INTEGER PRIMARY KEY,
    `app` char(40) DEFAULT NULL,
    `user_id` int(10) NOT NULL,
    `kkey_hash` bigint(20) NOT NULL,
    `kkey` text NOT NULL,
    `value` JSON,
    `migrated` tinyint(1) DEFAULT '0',
    UNIQUE (user_id, app, kkey_hash)
);

INSERT INTO `new_kv`
(
    `app`,
    `user_id`,
    `kkey_hash`,
    `kkey`,
    `value`
)
SELECT
    `app`,
    `user_id`,
    `kkey_hash`,
    `kkey`,
    json_quote(value)
FROM `kv`;

DROP TABLE `kv`;

ALTER TABLE `new_kv`
RENAME TO `kv`;
