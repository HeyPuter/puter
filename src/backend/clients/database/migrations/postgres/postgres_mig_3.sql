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

-- Credit-card verification column. Mirrors SQLite migration 0059.
-- `requires_card_verification` gates account use for low-reputation signups;
-- the card itself never touches our DB, so this is the only column (not
-- indexed, mirroring `requires_phone_verification`).
-- Idempotent via IF NOT EXISTS.

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS requires_card_verification boolean NOT NULL DEFAULT FALSE;
