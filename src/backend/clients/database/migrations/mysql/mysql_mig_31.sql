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

-- Named handlers an app deploys once. See sqlite/0076_event-handlers.sql for
-- the column rationale.
--
-- Idempotent: `CREATE TABLE IF NOT EXISTS` with the indexes declared inline,
-- as mig_29. There is no per-file applied-state tracking, so a replay has to
-- be a no-op.

CREATE TABLE IF NOT EXISTS `event_handlers` (
    `id` bigint unsigned NOT NULL AUTO_INCREMENT,
    -- Matches `apps`.`uid` exactly, charset included, so an equality against
    -- one never falls back to a conversion.
    `app_uid` char(40) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL,
    `name` varchar(128) NOT NULL,
    `source` mediumtext NOT NULL,
    `source_hash` char(64) NOT NULL,
    `created_at` bigint NOT NULL,
    `updated_at` bigint NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `idx_event_handlers_app_name` (`app_uid`, `name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
