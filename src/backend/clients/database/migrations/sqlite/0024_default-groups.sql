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

INSERT INTO `group` (
    `uid`,
    `owner_user_id`,
    `extra`,
    `metadata`
) VALUES
    ('26bfb1fb-421f-45bc-9aa4-d81ea569e7a5', 1,
        '{"critical": true, "type": "default", "name": "system"}',
        '{"title": "System", "color": "#000000"}'),
    ('ca342a5e-b13d-4dee-9048-58b11a57cc55', 1,
        '{"critical": true, "type": "default", "name": "admin"}',
        '{"title": "Admin", "color": "#a83232"}'),
    ('78b1b1dd-c959-44d2-b02c-8735671f9997', 1,
        '{"critical": true, "type": "default", "name": "user"}',
        '{"title": "User", "color": "#3254a8"}'),
    ('3c2dfff7-d22a-41aa-a193-59a61dac4b64', 1,
        '{"type": "default", "name": "moderator"}',
        '{"title": "Moderator", "color": "#a432a8"}'),
    ('5e8f251d-3382-4b0d-932c-7bb82f48652f', 1,
        '{"type": "default", "name": "developer"}',
        '{"title": "Developer", "color": "#32a852"}')
    ;
