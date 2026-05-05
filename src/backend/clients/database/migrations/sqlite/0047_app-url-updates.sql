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

-- Drop the viewer app (broken) and re-point camera/recorder/editor at
-- working third-party URLs.

DELETE FROM `apps` WHERE `uid` = 'app-7870be61-8dff-4a99-af64-e9ae6811e367';

UPDATE `apps` SET `index_url` = 'https://online-camera.com' WHERE `uid` = 'app-5584fbf7-ed69-41fc-99cd-85da21b1ef51';
UPDATE `apps` SET `index_url` = 'https://voice-recorder.com' WHERE `uid` = 'app-7bdca1a4-6373-4c98-ad97-03ff2d608ca1';
UPDATE `apps` SET `index_url` = 'https://online-notepad.com' WHERE `uid` = 'app-838dfbc4-bf8b-48c2-b47b-c4adc77fab58';
