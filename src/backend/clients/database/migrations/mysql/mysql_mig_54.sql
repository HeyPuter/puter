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

-- System jobs: one row per (deployment namespace, job name). See
-- sqlite/0100_scheduled-jobs.sql for the columns. Idempotent via IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS `scheduled_jobs` (
    `namespace` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `name` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `next_run_at` bigint NOT NULL,
    `lease_until` bigint DEFAULT NULL,
    `lease_token` varchar(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
    `lease_owner` varchar(128) DEFAULT NULL,
    `state` mediumtext,
    `last_run_at` bigint DEFAULT NULL,
    `last_duration_ms` int DEFAULT NULL,
    `last_error` varchar(1024) DEFAULT NULL,
    `failures` int NOT NULL DEFAULT 0,
    `updated_at` bigint NOT NULL,
    PRIMARY KEY (`namespace`, `name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
