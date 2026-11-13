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

-- `user`.`signup_tls_fingerprint`: the TLS fingerprint of the request that
-- created the account, when a fronting proxy supplies one. Indexed so the
-- accounts created from one TLS stack can be listed.
ALTER TABLE `user` ADD COLUMN `signup_tls_fingerprint` varchar(64) DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_user_signup_tls_fingerprint ON `user` (`signup_tls_fingerprint`);
