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

-- Store IP and request data as TEXT (for JSON strings)
ALTER TABLE `user` ADD COLUMN `signup_ip` TEXT DEFAULT NULL;
ALTER TABLE `user` ADD COLUMN `signup_ip_forwarded` TEXT DEFAULT NULL;
ALTER TABLE `user` ADD COLUMN `signup_user_agent` TEXT DEFAULT NULL;
ALTER TABLE `user` ADD COLUMN `signup_origin` TEXT DEFAULT NULL;
ALTER TABLE `user` ADD COLUMN `signup_server` TEXT DEFAULT NULL;

-- Add indexes for columns likely to be searched
CREATE INDEX idx_user_signup_ip ON user(signup_ip);
CREATE INDEX idx_user_signup_ip_forwarded ON user(signup_ip_forwarded);
CREATE INDEX idx_user_signup_user_agent ON user(signup_user_agent);
CREATE INDEX idx_user_signup_origin ON user(signup_origin);
CREATE INDEX idx_user_signup_server ON user(signup_server);
