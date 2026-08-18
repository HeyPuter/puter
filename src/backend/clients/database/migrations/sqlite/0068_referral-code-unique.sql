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

-- One referral code, one account. The mysql and postgres baselines have
-- declared `user.referral_code` UNIQUE since the column was introduced; the
-- sqlite baseline only declared the column, so the invariant held on hosted
-- deployments and not on self-hosted ones.
--
-- Codes are minted by picking at random and writing, so this index is not a
-- nicety: it is what makes "did anyone already take this code" a decision the
-- database makes once, instead of a read the next mint can race. A caller that
-- loses the race sees a unique violation and picks again.
--
-- NULL is distinct from NULL in a sqlite unique index, so accounts that have
-- never asked for a code (the majority) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_referral_code
    ON user(referral_code)
    WHERE referral_code IS NOT NULL;
