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

UPDATE "user"
SET clean_email = (split_part(split_part(lower(email), '@', 1), '+', 1) || '@' || split_part(lower(email), '@', 2))
WHERE email IS NOT NULL
  AND position('@' in email) > 1
  AND (
        lower(email) LIKE '%@icloud.com'
     OR lower(email) LIKE '%@me.com'
     OR lower(email) LIKE '%@mac.com'
  )
  AND clean_email = (replace(split_part(split_part(lower(email), '@', 1), '+', 1), '.', '') || '@' || split_part(lower(email), '@', 2))
  AND clean_email IS DISTINCT FROM (split_part(split_part(lower(email), '@', 1), '+', 1) || '@' || split_part(lower(email), '@', 2));

-- The same collapse decided who a pending invite belongs to, so the holder
-- of the undotted address claims invites addressed to the dotted one. The
-- typed address rides along as `invitedAddress` whenever it differed.
UPDATE "share"
SET recipient_email = (split_part(split_part(lower((data->>'invitedAddress')), '@', 1), '+', 1) || '@' || split_part(lower((data->>'invitedAddress')), '@', 2))
WHERE (data->>'invitedAddress') IS NOT NULL
  AND position('@' in (data->>'invitedAddress')) > 1
  AND (
        lower(recipient_email) LIKE '%@icloud.com'
     OR lower(recipient_email) LIKE '%@me.com'
     OR lower(recipient_email) LIKE '%@mac.com'
  )
  AND recipient_email = (replace(split_part(split_part(lower((data->>'invitedAddress')), '@', 1), '+', 1), '.', '') || '@' || split_part(lower((data->>'invitedAddress')), '@', 2))
  AND recipient_email IS DISTINCT FROM (split_part(split_part(lower((data->>'invitedAddress')), '@', 1), '+', 1) || '@' || split_part(lower((data->>'invitedAddress')), '@', 2));
