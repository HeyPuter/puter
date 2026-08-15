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

-- Enforce "at most one account owns an email address".
--
-- `user.email` is deliberately not UNIQUE: several rows may legitimately hold
-- the same address while unconfirmed (admin-provisioned placeholders, signups
-- that were never confirmed, temp accounts on their way to becoming real). What
-- must never happen is two rows both *owning* an address — owning meaning the
-- row is confirmed, or holds a password and so can drive password recovery for
-- that inbox.
--
-- Signup, save-account, change-email, OIDC and admin provisioning each check for
-- an owner before writing, but a check and an insert are not one operation: two
-- requests can both read "free" and both write. This index is what actually
-- holds the invariant; the application checks just produce a nicer error most of
-- the time.
--
-- Matching is on the canonical address so provider aliases
-- (`foo.bar+tag@gmail.com` vs `foobar@gmail.com`) collide. `clean_email` is
-- written on every modern write path; the COALESCE covers rows old enough to
-- predate the column.
--
-- If this CREATE fails, the DB already contains duplicate owners. Collapse them
-- first (admin → One-off Jobs → Collapse Duplicate Emails) — there is no safe
-- automatic merge of two accounts.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_owned_email
    ON user(COALESCE(clean_email, lower(email)))
    WHERE email IS NOT NULL
      AND (email_confirmed = 1 OR password IS NOT NULL);

-- One Puter account per external identity. OIDCStore.link already assumes this
-- constraint exists — it catches the unique violation to tell "re-linking the
-- same account" apart from "this sub belongs to someone else" — but the table
-- never actually had it, so two concurrent first-time logins could each create
-- an account and each link the same sub. Subsequent logins then resolved to
-- whichever row came back first.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_oidc_provider_sub
    ON user_oidc_providers(provider, provider_sub);
