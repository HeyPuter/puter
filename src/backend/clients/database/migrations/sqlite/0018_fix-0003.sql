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

CREATE TABLE `audit_user_to_user_permissions_new` (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,

    "issuer_user_id" INTEGER DEFAULT NULL,
    "issuer_user_id_keep" INTEGER DEFAULT NULL,

    "holder_user_id" INTEGER DEFAULT NULL,
    "holder_user_id_keep" INTEGER DEFAULT NULL,

    "permission" TEXT NOT NULL,
    "extra" JSON DEFAULT NULL,

    "action" TEXT DEFAULT NULL,
    "reason" TEXT DEFAULT NULL,

    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY("issuer_user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY("holder_user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO `audit_user_to_user_permissions_new`
(
    `id`,
    `issuer_user_id`, `issuer_user_id_keep`,
    `holder_user_id`, `holder_user_id_keep`,
    `permission`, `extra`, `action`, `reason`,
    `created_at`
)
SELECT
    `id`,
    `issuer_user_id`, `issuer_user_id_keep`,
    `holder_user_id`, `holder_user_id_keep`,
    `permission`, `extra`, `action`, `reason`,
    `created_at`
FROM `audit_user_to_user_permissions`;
DROP TABLE `audit_user_to_user_permissions`;

ALTER TABLE `audit_user_to_user_permissions_new`
RENAME TO `audit_user_to_user_permissions`;
