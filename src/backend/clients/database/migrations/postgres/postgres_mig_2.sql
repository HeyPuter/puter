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

-- SMS phone verification columns. Mirrors SQLite migration 0058. `phone` is the
-- E.164 number collected during verification (indexed like `email`);
-- `requires_phone_verification` gates account use for low-reputation signups
-- (not indexed, mirroring `requires_email_confirmation`).
-- Idempotent via IF NOT EXISTS.

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS phone varchar(20);
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS requires_phone_verification boolean NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_user_phone ON "user" (phone);
