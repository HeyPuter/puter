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

-- Mirrors SQLite migration 0086: `subdomains.app_owner` cascades on app
-- delete instead of nulling. The existing constraint is found by column, not
-- by name. Idempotent: there is no per-file applied-state tracking, and a
-- replay sees the cascade already in place and does nothing.

DO $$
DECLARE
  fk_name text;
BEGIN
  SELECT c.conname INTO fk_name
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum   = ANY (c.conkey)
   WHERE c.conrelid  = 'subdomains'::regclass
     AND c.contype   = 'f'
     AND c.confrelid = 'apps'::regclass
     AND a.attname   = 'app_owner'
     AND c.confdeltype <> 'c'
   LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE subdomains DROP CONSTRAINT %I', fk_name);
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid
       AND a.attnum   = ANY (c.conkey)
     WHERE c.conrelid  = 'subdomains'::regclass
       AND c.contype   = 'f'
       AND c.confrelid = 'apps'::regclass
       AND a.attname   = 'app_owner'
       AND c.confdeltype = 'c'
  ) THEN
    ALTER TABLE subdomains ADD CONSTRAINT subdomains_app_owner_fkey
      FOREIGN KEY (app_owner) REFERENCES apps (id)
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
