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

-- Card fingerprint column. Mirrors SQLite migration 0060. `card_fingerprint`
-- is the Stripe card fingerprint (stable per card number) recorded when a user
-- clears card verification — the card sibling of `phone`, indexed like it so
-- admin tooling can find the accounts that verified with a given card. The card
-- itself never touches our DB, only Stripe's fingerprint for it.
-- Idempotent via IF NOT EXISTS.

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS card_fingerprint varchar(128);
CREATE INDEX IF NOT EXISTS idx_user_card_fingerprint ON "user" (card_fingerprint);
