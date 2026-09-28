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

-- Resolving an origin to its app looks `apps` up by `index_url` on every
-- origin-based app token request (`AuthService#findCanonicalAppUidForOrigin`),
-- plus `AppStore.existsByIndexUrl`. With no index each lookup scans the table.

CREATE INDEX IF NOT EXISTS `idx_apps_index_url` ON `apps` (`index_url`);
