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

-- Contact Us attachments. Mirrors SQLite migration 0067 / Postgres
-- postgres_mig_11. A JSON array of `{name, type, size}` recording what a
-- submission carried, NULL when it carried nothing. Metadata only — the files
-- themselves ride the support email; this column is what keeps an abusive
-- submission attributable after the mail has been dealt with.
--
-- MySQL has no `ADD COLUMN IF NOT EXISTS`, so the guard is a throwaway
-- procedure, as in mysql_mig_21.

DROP PROCEDURE IF EXISTS _puter_add_feedback_attachments;
DELIMITER //
CREATE PROCEDURE _puter_add_feedback_attachments()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'feedback'
      AND COLUMN_NAME  = 'attachments'
  ) THEN
    ALTER TABLE `feedback` ADD COLUMN `attachments` text DEFAULT NULL;
  END IF;
END//
DELIMITER ;

CALL _puter_add_feedback_attachments();

DROP PROCEDURE IF EXISTS _puter_add_feedback_attachments;
