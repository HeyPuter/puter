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

-- The Contact Us form accepts screenshots and screen recordings. The files
-- themselves ride the support email; this column records what was sent —
-- a JSON array of `{name, type, size}`, NULL when the submission carried
-- nothing. Metadata only, deliberately: the row exists so an abusive
-- submission is still attributable after the mail has been dealt with, which
-- names and sizes answer and megabytes of payload in the database would not.

ALTER TABLE `feedback` ADD COLUMN "attachments" TEXT DEFAULT NULL;
