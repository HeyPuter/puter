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
SET `clean_email` = (CASE WHEN instr(substr(lower(`email`), 1, instr(`email`, '@') - 1), '+') > 0
             THEN substr(substr(lower(`email`), 1, instr(`email`, '@') - 1), 1,
                         instr(substr(lower(`email`), 1, instr(`email`, '@') - 1), '+') - 1)
             ELSE substr(lower(`email`), 1, instr(`email`, '@') - 1)
        END || substr(lower(`email`), instr(`email`, '@')))
WHERE `email` IS NOT NULL
  AND instr(`email`, '@') > 1
  AND (
        lower(`email`) LIKE '%@icloud.com'
     OR lower(`email`) LIKE '%@me.com'
     OR lower(`email`) LIKE '%@mac.com'
  )
  AND `clean_email` = (replace(CASE WHEN instr(substr(lower(`email`), 1, instr(`email`, '@') - 1), '+') > 0
             THEN substr(substr(lower(`email`), 1, instr(`email`, '@') - 1), 1,
                         instr(substr(lower(`email`), 1, instr(`email`, '@') - 1), '+') - 1)
             ELSE substr(lower(`email`), 1, instr(`email`, '@') - 1)
        END, '.', '') || substr(lower(`email`), instr(`email`, '@')))
  AND `clean_email` <> (CASE WHEN instr(substr(lower(`email`), 1, instr(`email`, '@') - 1), '+') > 0
             THEN substr(substr(lower(`email`), 1, instr(`email`, '@') - 1), 1,
                         instr(substr(lower(`email`), 1, instr(`email`, '@') - 1), '+') - 1)
             ELSE substr(lower(`email`), 1, instr(`email`, '@') - 1)
        END || substr(lower(`email`), instr(`email`, '@')));

-- The same collapse decided who a pending invite belongs to, so the holder
-- of the undotted address claims invites addressed to the dotted one. The
-- typed address rides along as `invitedAddress` whenever it differed.
UPDATE `share`
SET `recipient_email` = (CASE WHEN instr(substr(lower(json_extract(`data`, '$.invitedAddress')), 1, instr(json_extract(`data`, '$.invitedAddress'), '@') - 1), '+') > 0
             THEN substr(substr(lower(json_extract(`data`, '$.invitedAddress')), 1, instr(json_extract(`data`, '$.invitedAddress'), '@') - 1), 1,
                         instr(substr(lower(json_extract(`data`, '$.invitedAddress')), 1, instr(json_extract(`data`, '$.invitedAddress'), '@') - 1), '+') - 1)
             ELSE substr(lower(json_extract(`data`, '$.invitedAddress')), 1, instr(json_extract(`data`, '$.invitedAddress'), '@') - 1)
        END || substr(lower(json_extract(`data`, '$.invitedAddress')), instr(json_extract(`data`, '$.invitedAddress'), '@')))
WHERE json_extract(`data`, '$.invitedAddress') IS NOT NULL
  AND instr(json_extract(`data`, '$.invitedAddress'), '@') > 1
  AND (
        lower(`recipient_email`) LIKE '%@icloud.com'
     OR lower(`recipient_email`) LIKE '%@me.com'
     OR lower(`recipient_email`) LIKE '%@mac.com'
  )
  AND `recipient_email` = (replace(CASE WHEN instr(substr(lower(json_extract(`data`, '$.invitedAddress')), 1, instr(json_extract(`data`, '$.invitedAddress'), '@') - 1), '+') > 0
             THEN substr(substr(lower(json_extract(`data`, '$.invitedAddress')), 1, instr(json_extract(`data`, '$.invitedAddress'), '@') - 1), 1,
                         instr(substr(lower(json_extract(`data`, '$.invitedAddress')), 1, instr(json_extract(`data`, '$.invitedAddress'), '@') - 1), '+') - 1)
             ELSE substr(lower(json_extract(`data`, '$.invitedAddress')), 1, instr(json_extract(`data`, '$.invitedAddress'), '@') - 1)
        END, '.', '') || substr(lower(json_extract(`data`, '$.invitedAddress')), instr(json_extract(`data`, '$.invitedAddress'), '@')))
  AND `recipient_email` <> (CASE WHEN instr(substr(lower(json_extract(`data`, '$.invitedAddress')), 1, instr(json_extract(`data`, '$.invitedAddress'), '@') - 1), '+') > 0
             THEN substr(substr(lower(json_extract(`data`, '$.invitedAddress')), 1, instr(json_extract(`data`, '$.invitedAddress'), '@') - 1), 1,
                         instr(substr(lower(json_extract(`data`, '$.invitedAddress')), 1, instr(json_extract(`data`, '$.invitedAddress'), '@') - 1), '+') - 1)
             ELSE substr(lower(json_extract(`data`, '$.invitedAddress')), 1, instr(json_extract(`data`, '$.invitedAddress'), '@') - 1)
        END || substr(lower(json_extract(`data`, '$.invitedAddress')), instr(json_extract(`data`, '$.invitedAddress'), '@')));
