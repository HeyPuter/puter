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

-- Admin-managed blocklist of app origins. Mirrors SQLite migration 0062 /
-- MySQL mysql_mig_17 (which Postgres was originally missed for). An app whose
-- `index_url` host (or a request origin) matches an entry is denied access to
-- Puter resources. `include_subdomains = 1` also blocks every subdomain of
-- `domain`. Enforced in AuthService via AppOriginBlocklistService.
--
-- Idempotent via IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS blocked_app_origins (
    id SERIAL PRIMARY KEY,
    domain VARCHAR(255) NOT NULL,
    include_subdomains SMALLINT NOT NULL DEFAULT 0,
    reason TEXT DEFAULT NULL,
    created_by VARCHAR(255) DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_blocked_app_origins_domain
    ON blocked_app_origins (domain);
