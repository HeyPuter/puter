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

-- Refresh PDF and Player to point at hosted icons and updated index_urls.
-- The Player app moves to simple-player.puter.com so the player.puter.com
-- hostname can be reused by the new Music Player entry inserted below.

UPDATE `apps`
   SET `index_url` = 'https://pdf.puter.com',
       `icon`      = 'https://puter-app-icons.puter.site/app-3920851d-bda8-479b-9407-8517293c7d44.png'
 WHERE `uid` = 'app-3920851d-bda8-479b-9407-8517293c7d44';

UPDATE `apps`
   SET `index_url` = 'https://simple-player.puter.com',
       `icon`      = 'https://api.puter.com/app-icon/app-11edfba2-1ed3-4e22-8573-47e88fb87d70?v=1778450714818'
 WHERE `uid` = 'app-11edfba2-1ed3-4e22-8573-47e88fb87d70';

INSERT OR IGNORE INTO `apps` (
    `uid`, `owner_user_id`, `icon`, `name`, `title`, `description`,
    `godmode`, `maximize_on_start`, `index_url`,
    `approved_for_listing`, `approved_for_opening_items`, `approved_for_incentive_program`,
    `timestamp`, `last_review`, `tags`, `app_owner`
) VALUES (
    'app-d7e9471f-e441-4d72-a5ab-75e96573b76b',
    60950,
    'https://puter-app-icons.puter.site/app-d7e9471f-e441-4d72-a5ab-75e96573b76b-512.png',
    'music-player', 'Music Player', 'A free music player app in the browser.',
    0, 0, 'https://player.puter.com',
    1, 0, 0,
    '2026-05-10 00:00:00', NULL, NULL, NULL
);
