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

-- Registers the three OnlyOffice-backed apps (word-processor, spreadsheet,
-- presentation) that integrations/onlyoffice-bridge/ talks to, and their
-- file-type associations. index_url points at localhost:8083, the local
-- self-host default -- update it to wherever the bridge is actually
-- reachable before deploying (see integrations/onlyoffice-bridge/README.md).
-- godmode is set because the bridge needs the full user auth token (not a
-- scoped app token) to create new files via /batch.

INSERT IGNORE INTO `apps` (
    `uid`, `owner_user_id`, `icon`, `name`, `title`, `description`, `index_url`,
    `godmode`, `maximize_on_start`, `approved_for_listing`, `approved_for_opening_items`, `timestamp`
) VALUES (
    'app-oo-word-0001', 1, 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCIgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0Ij4KPHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTAiIGZpbGw9IiMyQjU3OUEiLz4KPHJlY3QgeD0iMTYiIHk9IjE0IiB3aWR0aD0iMzIiIGhlaWdodD0iNDAiIHJ4PSIyIiBmaWxsPSIjZmZmZmZmIi8+CjxyZWN0IHg9IjIwIiB5PSIyMiIgd2lkdGg9IjI0IiBoZWlnaHQ9IjMiIGZpbGw9IiMyQjU3OUEiLz4KPHJlY3QgeD0iMjAiIHk9IjI5IiB3aWR0aD0iMjQiIGhlaWdodD0iMyIgZmlsbD0iIzJCNTc5QSIvPgo8cmVjdCB4PSIyMCIgeT0iMzYiIHdpZHRoPSIxNiIgaGVpZ2h0PSIzIiBmaWxsPSIjMkI1NzlBIi8+Cjwvc3ZnPg==', 'word-processor', 'Documentos', 'Editor de documentos de texto (OnlyOffice)',
    'http://localhost:8083/editor.html', 1, 1, 1, 1, NOW()
);

INSERT IGNORE INTO `app_filetype_association` (`app_id`, `type`) SELECT `id`, 'doc' FROM `apps` WHERE `uid` = 'app-oo-word-0001';
INSERT IGNORE INTO `app_filetype_association` (`app_id`, `type`) SELECT `id`, 'docx' FROM `apps` WHERE `uid` = 'app-oo-word-0001';
INSERT IGNORE INTO `app_filetype_association` (`app_id`, `type`) SELECT `id`, 'odt' FROM `apps` WHERE `uid` = 'app-oo-word-0001';
INSERT IGNORE INTO `app_filetype_association` (`app_id`, `type`) SELECT `id`, 'rtf' FROM `apps` WHERE `uid` = 'app-oo-word-0001';
INSERT IGNORE INTO `app_filetype_association` (`app_id`, `type`) SELECT `id`, 'txt' FROM `apps` WHERE `uid` = 'app-oo-word-0001';

INSERT IGNORE INTO `apps` (
    `uid`, `owner_user_id`, `icon`, `name`, `title`, `description`, `index_url`,
    `godmode`, `maximize_on_start`, `approved_for_listing`, `approved_for_opening_items`, `timestamp`
) VALUES (
    'app-oo-excel-0001', 1, 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCIgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0Ij4KPHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTAiIGZpbGw9IiMyMTczNDYiLz4KPHJlY3QgeD0iMTQiIHk9IjE0IiB3aWR0aD0iMzYiIGhlaWdodD0iMzYiIHJ4PSIyIiBmaWxsPSIjZmZmZmZmIi8+CjxsaW5lIHgxPSIxNCIgeTE9IjI2IiB4Mj0iNTAiIHkyPSIyNiIgc3Ryb2tlPSIjMjE3MzQ2IiBzdHJva2Utd2lkdGg9IjMiLz4KPGxpbmUgeDE9IjE0IiB5MT0iMzgiIHgyPSI1MCIgeTI9IjM4IiBzdHJva2U9IiMyMTczNDYiIHN0cm9rZS13aWR0aD0iMyIvPgo8bGluZSB4MT0iMjYiIHkxPSIxNCIgeDI9IjI2IiB5Mj0iNTAiIHN0cm9rZT0iIzIxNzM0NiIgc3Ryb2tlLXdpZHRoPSIzIi8+CjxsaW5lIHgxPSIzOCIgeTE9IjE0IiB4Mj0iMzgiIHkyPSI1MCIgc3Ryb2tlPSIjMjE3MzQ2IiBzdHJva2Utd2lkdGg9IjMiLz4KPC9zdmc+', 'spreadsheet', 'Planilhas', 'Editor de planilhas (OnlyOffice)',
    'http://localhost:8083/editor.html', 1, 1, 1, 1, NOW()
);

INSERT IGNORE INTO `app_filetype_association` (`app_id`, `type`) SELECT `id`, 'xls' FROM `apps` WHERE `uid` = 'app-oo-excel-0001';
INSERT IGNORE INTO `app_filetype_association` (`app_id`, `type`) SELECT `id`, 'xlsx' FROM `apps` WHERE `uid` = 'app-oo-excel-0001';
INSERT IGNORE INTO `app_filetype_association` (`app_id`, `type`) SELECT `id`, 'ods' FROM `apps` WHERE `uid` = 'app-oo-excel-0001';
INSERT IGNORE INTO `app_filetype_association` (`app_id`, `type`) SELECT `id`, 'csv' FROM `apps` WHERE `uid` = 'app-oo-excel-0001';

INSERT IGNORE INTO `apps` (
    `uid`, `owner_user_id`, `icon`, `name`, `title`, `description`, `index_url`,
    `godmode`, `maximize_on_start`, `approved_for_listing`, `approved_for_opening_items`, `timestamp`
) VALUES (
    'app-oo-slide-0001', 1, 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCIgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0Ij4KPHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTAiIGZpbGw9IiNEMjQ3MjYiLz4KPHJlY3QgeD0iMTQiIHk9IjE4IiB3aWR0aD0iMzYiIGhlaWdodD0iMjgiIHJ4PSIyIiBmaWxsPSIjZmZmZmZmIi8+CjxjaXJjbGUgY3g9IjI2IiBjeT0iMzIiIHI9IjciIGZpbGw9IiNEMjQ3MjYiLz4KPHJlY3QgeD0iMzYiIHk9IjI3IiB3aWR0aD0iMTAiIGhlaWdodD0iMyIgZmlsbD0iI0QyNDcyNiIvPgo8cmVjdCB4PSIzNiIgeT0iMzMiIHdpZHRoPSIxMCIgaGVpZ2h0PSIzIiBmaWxsPSIjRDI0NzI2Ii8+Cjwvc3ZnPg==', 'presentation', 'Apresentações', 'Editor de apresentacoes (OnlyOffice)',
    'http://localhost:8083/editor.html', 1, 1, 1, 1, NOW()
);

INSERT IGNORE INTO `app_filetype_association` (`app_id`, `type`) SELECT `id`, 'ppt' FROM `apps` WHERE `uid` = 'app-oo-slide-0001';
INSERT IGNORE INTO `app_filetype_association` (`app_id`, `type`) SELECT `id`, 'pptx' FROM `apps` WHERE `uid` = 'app-oo-slide-0001';
INSERT IGNORE INTO `app_filetype_association` (`app_id`, `type`) SELECT `id`, 'odp' FROM `apps` WHERE `uid` = 'app-oo-slide-0001';

