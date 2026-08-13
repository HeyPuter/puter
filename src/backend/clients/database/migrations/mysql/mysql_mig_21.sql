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
-- migration 0066.
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
-- SQLite expresses that with a partial index. MySQL has none, so the predicate
-- lives in a generated column that evaluates to NULL for every row that does not
-- own its address — and NULLs do not collide in an InnoDB unique index, which is
-- exactly the "unlimited unconfirmed placeholders" behaviour we need.
--
-- The column is VIRTUAL, not STORED, on purpose: adding a stored generated
-- column rebuilds the table, while a virtual one is a metadata-only change and
-- the index that follows builds INPLACE. On a `user` table of any size with
-- read replicas attached, that is the difference between a routine change and an
-- outage. The ALGORITHM/LOCK clauses are spelled out so a server that cannot
-- honour them refuses the statement instead of quietly copying the table.
--
-- Matching is on the canonical address so provider aliases
-- (`foo.bar+tag@gmail.com` vs `foobar@gmail.com`) collide. `clean_email` is
-- written on every modern write path; the COALESCE covers rows old enough to
-- predate the column. Run the `clean_email` backfill before this migration or
-- alias collisions among those rows go unnoticed.
--
-- Idempotent: both steps are guarded on INFORMATION_SCHEMA so the directory
-- replays safely.
--
-- If the index creation fails with ER_DUP_ENTRY, the DB already contains
-- duplicate owners. Collapse them first (admin → One-off Jobs → Collapse
-- Duplicate Emails) — there is no safe automatic merge of two accounts.

DROP PROCEDURE IF EXISTS _puter_add_owned_email;
DELIMITER //
CREATE PROCEDURE _puter_add_owned_email()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'user'
      AND COLUMN_NAME = 'owned_email'
  ) THEN
    ALTER TABLE `user`
      ADD COLUMN `owned_email` VARCHAR(256)
        CHARACTER SET latin1 COLLATE latin1_swedish_ci
        GENERATED ALWAYS AS (
          CASE
            WHEN `email` IS NOT NULL
                 AND (`email_confirmed` = 1 OR `password` IS NOT NULL)
            THEN COALESCE(`clean_email`, LOWER(`email`))
            ELSE NULL
          END
        ) VIRTUAL,
      ALGORITHM=INSTANT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'user'
      AND INDEX_NAME = 'idx_user_owned_email'
  ) THEN
    ALTER TABLE `user`
      ADD UNIQUE KEY `idx_user_owned_email` (`owned_email`),
      ALGORITHM=INPLACE, LOCK=NONE;
  END IF;
END//
DELIMITER ;

CALL _puter_add_owned_email();

DROP PROCEDURE IF EXISTS _puter_add_owned_email;

-- One Puter account per external identity. OIDCStore.link already assumes this
-- constraint exists — it catches the unique violation to tell "re-linking the
-- same account" apart from "this sub belongs to someone else" — but the table
-- never actually had it, so two concurrent first-time logins could each create
-- an account and each link the same sub. Subsequent logins then resolved to
-- whichever row came back first.
--
-- Dedupe `user_oidc_providers` before applying this: keep the lowest `id` per
-- (provider, provider_sub) and point it at the account the collapse job kept.

DROP PROCEDURE IF EXISTS _puter_add_oidc_sub_unique;
DELIMITER //
CREATE PROCEDURE _puter_add_oidc_sub_unique()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'user_oidc_providers'
      AND INDEX_NAME = 'idx_user_oidc_provider_sub'
  ) THEN
    ALTER TABLE `user_oidc_providers`
      ADD UNIQUE KEY `idx_user_oidc_provider_sub` (`provider`, `provider_sub`);
  END IF;
END//
DELIMITER ;

CALL _puter_add_oidc_sub_unique();

DROP PROCEDURE IF EXISTS _puter_add_oidc_sub_unique;
