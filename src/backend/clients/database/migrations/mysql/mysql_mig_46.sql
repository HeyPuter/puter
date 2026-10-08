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

-- Recompute `clean_email` for Apple's domains: dots are significant there, so
-- rows written while they were stripped still collapse two mailboxes into one.
-- Only rows still holding exactly what the old rule produced, so a NULL or a
-- legacy un-lowercased value is left alone -- rewriting those would fold `+tag`
-- or case into a key another row already owns. Restores dots and nothing else.

UPDATE `user`
SET `clean_email` = CONCAT(SUBSTRING_INDEX(SUBSTRING_INDEX(LOWER(`email`), '@', 1), '+', 1), '@', SUBSTRING_INDEX(LOWER(`email`), '@', -1))
WHERE `email` IS NOT NULL
  AND LOCATE('@', `email`) > 1
  AND (
        LOWER(`email`) LIKE '%@icloud.com'
     OR LOWER(`email`) LIKE '%@me.com'
     OR LOWER(`email`) LIKE '%@mac.com'
  )
  AND `clean_email` = CONCAT(REPLACE(SUBSTRING_INDEX(SUBSTRING_INDEX(LOWER(`email`), '@', 1), '+', 1), '.', ''), '@', SUBSTRING_INDEX(LOWER(`email`), '@', -1))
  AND `clean_email` <> CONCAT(SUBSTRING_INDEX(SUBSTRING_INDEX(LOWER(`email`), '@', 1), '+', 1), '@', SUBSTRING_INDEX(LOWER(`email`), '@', -1));

-- The same collapse decided who a pending invite belongs to, so the holder
-- of the undotted address claims invites addressed to the dotted one. The
-- typed address rides along as `invitedAddress` whenever it differed.
UPDATE `share`
SET `recipient_email` = CONCAT(SUBSTRING_INDEX(SUBSTRING_INDEX(LOWER(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.invitedAddress'))), '@', 1), '+', 1), '@', SUBSTRING_INDEX(LOWER(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.invitedAddress'))), '@', -1))
WHERE JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.invitedAddress')) IS NOT NULL
  AND LOCATE('@', JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.invitedAddress'))) > 1
  AND (
        LOWER(`recipient_email`) LIKE '%@icloud.com'
     OR LOWER(`recipient_email`) LIKE '%@me.com'
     OR LOWER(`recipient_email`) LIKE '%@mac.com'
  )
  AND `recipient_email` = CONCAT(REPLACE(SUBSTRING_INDEX(SUBSTRING_INDEX(LOWER(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.invitedAddress'))), '@', 1), '+', 1), '.', ''), '@', SUBSTRING_INDEX(LOWER(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.invitedAddress'))), '@', -1))
  AND `recipient_email` <> CONCAT(SUBSTRING_INDEX(SUBSTRING_INDEX(LOWER(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.invitedAddress'))), '@', 1), '+', 1), '@', SUBSTRING_INDEX(LOWER(JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.invitedAddress'))), '@', -1));
