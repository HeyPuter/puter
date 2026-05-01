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

CREATE TABLE `user_to_group_permissions` (
    "user_id" INTEGER NOT NULL,
    "group_id" INTEGER NOT NULL,
    "permission" TEXT NOT NULL,
    "extra" JSON DEFAULT NULL,

    FOREIGN KEY("user_id") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY("group_id") REFERENCES "group" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY ("user_id", "group_id", "permission")
);

CREATE TABLE "audit_user_to_group_permissions" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,

    "user_id" INTEGER NOT NULL,
    "user_id_keep" INTEGER DEFAULT NULL,

    "group_id" INTEGER NOT NULL,
    "group_id_keep" INTEGER DEFAULT NULL,

    "permission" TEXT NOT NULL,
    "extra" JSON DEFAULT NULL,

    "action" TEXT DEFAULT NULL,
    "reason" TEXT DEFAULT NULL,

    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY("user_id") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY("group_id") REFERENCES "group" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
