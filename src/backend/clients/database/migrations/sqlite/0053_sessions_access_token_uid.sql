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

-- Let `kind='access_token'` rows be reverse-looked-up
-- from the `token_uid` claim that lives only in `access_token_permissions`.
-- Required so `POST /auth/revoke-access-token` with a raw token_uid input
-- (no JWT) can find and soft-revoke the session row, matching the JWT
-- input path's coverage. Without it, raw-uuid revoke would only drop the
-- permissions row, leaving the session-row kill switch un-flipped.

ALTER TABLE `sessions` ADD COLUMN `access_token_uid` TEXT;

CREATE INDEX IF NOT EXISTS `idx_sessions_access_token_uid`
    ON `sessions` (`access_token_uid`)
    WHERE `access_token_uid` IS NOT NULL;
