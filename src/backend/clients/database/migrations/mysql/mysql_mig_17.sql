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

-- Admin-managed blocklist of app origins. Mirrors SQLite migration 0062.
-- An app whose `index_url` host (or a request origin) matches an entry is
-- denied access to Puter resources: it cannot obtain an app token and
-- already-issued app tokens are rejected on each request. `include_subdomains
-- = 1` also blocks every subdomain of `domain`. Enforced in AuthService via
-- AppOriginBlocklistService.
--
-- Idempotent: `CREATE TABLE IF NOT EXISTS` lets the directory replay safely.

CREATE TABLE IF NOT EXISTS `blocked_app_origins` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `domain` VARCHAR(255) NOT NULL,
    `include_subdomains` TINYINT(1) NOT NULL DEFAULT 0,
    `reason` TEXT DEFAULT NULL,
    `created_by` VARCHAR(255) DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `idx_blocked_app_origins_domain` (`domain`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
