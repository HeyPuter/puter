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

INSERT INTO `apps`
    (`uid`, `owner_user_id`, `icon`, `name`, `title`, `description`, `godmode`, `background`, `maximize_on_start`, `index_url`, `approved_for_listing`, `approved_for_opening_items`, `approved_for_incentive_program`, `timestamp`, `last_review`, `tags`, `app_owner`)
VALUES
    ('app-e3ac5486-da8c-42ad-8377-8728086e0980', 1, 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI5MnB0IiBoZWlnaHQ9IjkycHQiIHZpZXdCb3g9IjAgMCA5MiA5MiI+PGRlZnM+PGNsaXBQYXRoIGlkPSJhIj48cGF0aCBkPSJNMCAuMTEzaDkxLjg4N1Y5MkgwWm0wIDAiLz48L2NsaXBQYXRoPjwvZGVmcz48ZyBjbGlwLXBhdGg9InVybCgjYSkiPjxwYXRoIHN0eWxlPSJzdHJva2U6bm9uZTtmaWxsLXJ1bGU6bm9uemVybztmaWxsOiNmMDNjMmU7ZmlsbC1vcGFjaXR5OjEiIGQ9Ik05MC4xNTYgNDEuOTY1IDUwLjAzNiAxLjg0OGE1LjkxOCA1LjkxOCAwIDAgMC04LjM3MiAwbC04LjMyOCA4LjMzMiAxMC41NjYgMTAuNTY2YTcuMDMgNy4wMyAwIDAgMSA3LjIzIDEuNjg0IDcuMDM0IDcuMDM0IDAgMCAxIDEuNjY5IDcuMjc3bDEwLjE4NyAxMC4xODRhNy4wMjggNy4wMjggMCAwIDEgNy4yNzggMS42NzIgNy4wNCA3LjA0IDAgMCAxIDAgOS45NTcgNy4wNSA3LjA1IDAgMCAxLTkuOTY1IDAgNy4wNDQgNy4wNDQgMCAwIDEtMS41MjgtNy42NmwtOS41LTkuNDk3VjU5LjM2YTcuMDQgNy4wNCAwIDAgMSAxLjg2IDExLjI5IDcuMDQgNy4wNCAwIDAgMS05Ljk1NyAwIDcuMDQgNy4wNCAwIDAgMSAwLTkuOTU4IDcuMDYgNy4wNiAwIDAgMSAyLjMwNC0xLjUzOVYzMy45MjZhNy4wNDkgNy4wNDkgMCAwIDEtMy44Mi05LjIzNEwyOS4yNDIgMTQuMjcyIDEuNzMgNDEuNzc3YTUuOTI1IDUuOTI1IDAgMCAwIDAgOC4zNzFMNDEuODUyIDkwLjI3YTUuOTI1IDUuOTI1IDAgMCAwIDguMzcgMGwzOS45MzQtMzkuOTM0YTUuOTI1IDUuOTI1IDAgMCAwIDAtOC4zNzEiLz48L2c+PC9zdmc+', 'git', 'Git', 'Puter Git client', 0, 1, 0, 'https://builtins.namespaces.puter.com/git', 1, 0, 0, '2024-05-15 10:33:00', NULL, 'productivity', NULL);