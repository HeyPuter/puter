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

-- One user refusing contact from another. See sqlite/0068_user-block.sql for
-- the rationale. `created_at` is unix seconds.
--
-- Idempotent: `CREATE TABLE IF NOT EXISTS` with the indexes declared inline,
-- so the directory can replay safely.

CREATE TABLE IF NOT EXISTS `user_block` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `blocker_user_id` INT UNSIGNED NOT NULL,
    `blocked_user_id` INT UNSIGNED NOT NULL,
    `created_at` BIGINT NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `idx_user_block_pair` (`blocker_user_id`, `blocked_user_id`),
    CONSTRAINT `fk_user_block_blocker` FOREIGN KEY (`blocker_user_id`)
        REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_user_block_blocked` FOREIGN KEY (`blocked_user_id`)
        REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
