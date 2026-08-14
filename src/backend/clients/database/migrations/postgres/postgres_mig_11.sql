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

-- Contact Us attachments. Mirrors SQLite migration 0067 / MySQL mysql_mig_22.
-- A JSON array of `{name, type, size}` recording what a submission carried,
-- NULL when it carried nothing. Metadata only — the files themselves ride the
-- support email; this column is what keeps an abusive submission attributable
-- after the mail has been dealt with.
--
-- Idempotent via IF NOT EXISTS.

ALTER TABLE feedback ADD COLUMN IF NOT EXISTS attachments text DEFAULT NULL;
