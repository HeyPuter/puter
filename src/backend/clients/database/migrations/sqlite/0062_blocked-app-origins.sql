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

-- Admin-managed blocklist of app origins. An app whose `index_url` host (or
-- a request origin) matches an entry is denied access to Puter resources:
-- it cannot obtain an app token and already-issued app tokens are rejected
-- on each request. `include_subdomains = 1` also blocks every subdomain of
-- `domain`. Enforced in AuthService via AppOriginBlocklistService.

CREATE TABLE IF NOT EXISTS `blocked_app_origins` (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "domain" TEXT NOT NULL,
    "include_subdomains" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT DEFAULT NULL,
    "created_by" TEXT DEFAULT NULL,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS `idx_blocked_app_origins_domain`
    ON `blocked_app_origins` (`domain`);
