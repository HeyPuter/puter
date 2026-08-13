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

-- Enforce "at most one account owns an email address". Mirrors SQLite
-- migration 0066 and MySQL migration 21; see those for the full rationale.
--
-- In short: `user.email` is deliberately not UNIQUE because several rows may
-- hold the same address while unconfirmed. What must not happen is two rows
-- both owning it — confirmed, or holding a password and so able to drive
-- password recovery for that inbox. The application checks for an owner before
-- every write, but a check and a write are not one operation.
--
-- If this fails, the DB already contains duplicate owners; collapse them first
-- (admin → One-off Jobs → Collapse Duplicate Emails).

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_owned_email
    ON "user" (COALESCE(clean_email, LOWER(email)))
    WHERE email IS NOT NULL
      AND (email_confirmed = TRUE OR password IS NOT NULL);

-- One Puter account per external identity. OIDCStore.link already assumes this
-- constraint exists — it catches the unique violation to tell "re-linking the
-- same account" apart from "this sub belongs to someone else" — but the table
-- never actually had it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_oidc_provider_sub
    ON user_oidc_providers (provider, provider_sub);
