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

-- SMS phone verification. `phone` holds the E.164 number collected during
-- verification (indexed like `email`). `requires_phone_verification` gates
-- account use until verified — the abuse v2 harness sets it for low-reputation
-- signups instead of blocking them. (Not indexed, mirroring
-- `requires_email_confirmation`.)
ALTER TABLE `user` ADD COLUMN `phone` varchar(20) DEFAULT NULL;
ALTER TABLE `user` ADD COLUMN `requires_phone_verification` tinyint(1) NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_user_phone ON `user` (`phone`);
