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

-- fixing owner IDs for default apps;
-- they should all be owned by 'default_user'

UPDATE `apps` SET `owner_user_id`=1 WHERE `uid` IN
(
    'app-7870be61-8dff-4a99-af64-e9ae6811e367',
    'app-3920851d-bda8-479b-9407-8517293c7d44',
    'app-5584fbf7-ed69-41fc-99cd-85da21b1ef51',
    'app-11edfba2-1ed3-4e22-8573-47e88fb87d70',
    'app-7bdca1a4-6373-4c98-ad97-03ff2d608ca1'
);
