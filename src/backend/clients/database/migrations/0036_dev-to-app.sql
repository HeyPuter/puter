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

CREATE TABLE `dev_to_app_permissions` (
    `user_id` int(10) NOT NULL,
    `app_id` int(10) NOT NULL,
    `permission` varchar(255) NOT NULL,
    `extra` JSON DEFAULT NULL,

    FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (`app_id`) REFERENCES `apps` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY (`user_id`, `app_id`, `permission`)
);

CREATE TABLE `audit_dev_to_app_permissions` (
    `id` INTEGER PRIMARY KEY,

    `user_id` int(10) DEFAULT NULL,
    `user_id_keep` int(10) NOT NULL,

    `app_id` int(10) DEFAULT NULL,
    `app_id_keep` int(10) NOT NULL,

    `permission` varchar(255) NOT NULL,
    `extra` JSON DEFAULT NULL,

    `action` VARCHAR(16) DEFAULT NULL, -- "granted" or "revoked"
    `reason` VARCHAR(255) DEFAULT NULL,

    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    FOREIGN KEY (`app_id`) REFERENCES `apps` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
);