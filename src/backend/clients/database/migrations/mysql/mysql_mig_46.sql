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
-- Subaddressing still folds. Splits rows apart only, so it cannot collide.

UPDATE `user`
SET `clean_email` = CONCAT(
        SUBSTRING_INDEX(SUBSTRING_INDEX(LOWER(`email`), '@', 1), '+', 1),
        '@',
        SUBSTRING_INDEX(LOWER(`email`), '@', -1)
    )
WHERE `email` IS NOT NULL
  AND LOCATE('@', `email`) > 1
  AND (
        LOWER(`email`) LIKE '%@icloud.com'
     OR LOWER(`email`) LIKE '%@me.com'
     OR LOWER(`email`) LIKE '%@mac.com'
  );
