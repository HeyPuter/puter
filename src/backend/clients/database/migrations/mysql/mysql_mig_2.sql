-- Copyright (C) 2024-present Puter Technologies Inc.
--
-- Default apps (git, dev-center, puter-linux). viewer, pdf, camera,
-- player, and recorder were intentionally dropped: their index_url
-- pointed at *.puter.com, routing files through Puter Technologies
-- Inc.'s servers instead of this instance. Folds the equivalent SQLite migrations'
-- final state (subsequent godmode / maximize_on_start UPDATEs baked in,
-- all owners set to user.id=1 = admin).
--
-- INSERT IGNORE makes it safe to re-run; uid has a UNIQUE constraint.
--
-- FK temporarily disabled because apps.owner_user_id references user.id,
-- and the `system` user (id=1) is created by mysql_mig_3.sql which
-- runs after this one. Once mig 3 inserts that row, the references
-- resolve. Matches the SQLite ordering: 0002 (apps) → 0025 (system user).

/*!40014 SET @OLD_FK = @@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;

-- TEMP: editor app insert removed — broken, will fix later






INSERT IGNORE INTO `apps` (`uid`, `owner_user_id`, `icon`, `name`, `title`, `description`, `index_url`, `godmode`, `maximize_on_start`, `background`, `approved_for_listing`, `approved_for_opening_items`, `approved_for_incentive_program`, `tags`, `timestamp`) VALUES ('app-e3ac5486-da8c-42ad-8377-8728086e0980', 1, 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI5MnB0IiBoZWlnaHQ9IjkycHQiIHZpZXdCb3g9IjAgMCA5MiA5MiI+PGRlZnM+PGNsaXBQYXRoIGlkPSJhIj48cGF0aCBkPSJNMCAuMTEzaDkxLjg4N1Y5MkgwWm0wIDAiLz48L2NsaXBQYXRoPjwvZGVmcz48ZyBjbGlwLXBhdGg9InVybCgjYSkiPjxwYXRoIHN0eWxlPSJzdHJva2U6bm9uZTtmaWxsLXJ1bGU6bm9uemVybztmaWxsOiNmMDNjMmU7ZmlsbC1vcGFjaXR5OjEiIGQ9Ik05MC4xNTYgNDEuOTY1IDUwLjAzNiAxLjg0OGE1LjkxOCA1LjkxOCAwIDAgMC04LjM3MiAwbC04LjMyOCA4LjMzMiAxMC41NjYgMTAuNTY2YTcuMDMgNy4wMyAwIDAgMSA3LjIzIDEuNjg0IDcuMDM0IDcuMDM0IDAgMCAxIDEuNjY5IDcuMjc3bDEwLjE4NyAxMC4xODRhNy4wMjggNy4wMjggMCAwIDEgNy4yNzggMS42NzIgNy4wNCA3LjA0IDAgMCAxIDAgOS45NTcgNy4wNSA3LjA1IDAgMCAxLTkuOTY1IDAgNy4wNDQgNy4wNDQgMCAwIDEtMS41MjgtNy42NmwtOS41LTkuNDk3VjU5LjM2YTcuMDQgNy4wNCAwIDAgMSAxLjg2IDExLjI5IDcuMDQgNy4wNCAwIDAgMS05Ljk1NyAwIDcuMDQgNy4wNCAwIDAgMSAwLTkuOTU4IDcuMDYgNy4wNiAwIDAgMSAyLjMwNC0xLjUzOVYzMy45MjZhNy4wNDkgNy4wNDkgMCAwIDEtMy44Mi05LjIzNEwyOS4yNDIgMTQuMjcyIDEuNzMgNDEuNzc3YTUuOTI1IDUuOTI1IDAgMCAwIDAgOC4zNzFMNDEuODUyIDkwLjI3YTUuOTI1IDUuOTI1IDAgMCAwIDguMzcgMGwzOS45MzQtMzkuOTM0YTUuOTI1IDUuOTI1IDAgMCAwIDAtOC4zNzEiLz48L2c+PC9zdmc+', 'git', 'Git', 'Puter Git client', 'https://builtins.namespaces.puter.com/git', 0, 0, 1, 1, 0, 0, 'productivity', '2020-01-01 00:00:00');

INSERT IGNORE INTO `apps` (`uid`, `owner_user_id`, `icon`, `name`, `title`, `description`, `index_url`, `godmode`, `maximize_on_start`, `background`, `approved_for_listing`, `approved_for_opening_items`, `approved_for_incentive_program`, `tags`, `timestamp`) VALUES ('app-0b37f054-07d4-4627-8765-11bd23e889d4', 1, 'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz4KPHN2ZyB3aWR0aD0iMTE2IiBoZWlnaHQ9IjEzNiIgdmlld0JveD0iMCAwIDExNiAxMTYiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CiAgPHBhdGggZD0iTSAwLjEyOSA2Mi4wODYgTCAyOC4xMjkgNzQuMDg1IEwgMjguMTI5IDEwOC4wODUgTCAwLjEyOSA5Ni42NDQgTCAwLjEyOSA2Mi4wODYgWiIgc3R5bGU9ImZpbGw6IHJnYigxNjQsIDczLCA3MSk7Ii8+CiAgPHBhdGggZD0iTSAyOS4xMjkgMTA4LjA4NSBMIDU3LjEyOSA5Ni4wODUgTCA1Ny4xMjkgNjIuMDg2IEwgMjkuMTI5IDc0LjA4NSBMIDI5LjEyOSAxMDguMDg1IFoiIHN0eWxlPSJmaWxsOiByZ2IoMTM1LCA1OCwgNTgpOyIvPgogIDxwYXRoIGQ9Ik0gMC4xMjkgNjEuMTc5IEwgMjguNjI5IDczLjA4NSBMIDU3LjI3NiA2MS4xNzkgTCAyOS4xMjkgNTAuMDg2IEwgMC4xMjkgNjEuMTc5IFoiIHN0eWxlPSJmaWxsOiByZ2IoMTk2LCA4NSwgODUpOyIvPgogIDxwYXRoIGQ9Ik0gMjkuMTI5IDE0LjA4NiBMIDU3LjEyOSAyNi4wODYgTCA1Ny4xMjkgNTkuMDg2IEwgMjkuMTI5IDQ4LjA4NiBMIDI5LjEyOSAxNC4wODYgWiIgc3R5bGU9ImZpbGw6IHJnYig0MSwgMTE1LCAyMDIpOyIvPgogIDxwYXRoIGQ9Ik0gNTguMTI5IDU5LjA4NiBMIDg3LjEyOSA0OC4wODYgTCA4Ny4xMjkgMTQuMDg2IEwgNTguMTI5IDI2LjA4NiBMIDU4LjEyOSA1OS4wODYgWiIgc3R5bGU9ImZpbGw6IHJnYigzMiwgODksIDE1OCk7Ii8+CiAgPHBhdGggZD0iTSAyOS4xMjkgMTMuMDg2IEwgNTguMTI5IDI1LjA4NiBMIDg3LjEyOSAxMy4wODYgTCA1OC4xMjkgMS4wODYgTCAyOS4xMjkgMTMuMDg2IFoiIHN0eWxlPSJmaWxsOiByZ2IoNDcsIDEzNCwgMjM2KTsiLz4KICA8cGF0aCBkPSJNIDU5LjEyOSA2Mi4wODYgTCA4Ny4xMjkgNzQuMDg1IEwgODcuMTI5IDEwOC4wODUgTCA1OS4xMjkgOTYuMDg1IEwgNTkuMTI5IDYyLjA4NiBaIiBzdHlsZT0iZmlsbDogcmdiKDM0LCAxNzksIDApOyIvPgogIDxwYXRoIGQ9Ik0gODguMTI5IDEwOC4wODUgTCAxMTYuMTI5IDk2LjE1MSBMIDExNi4xMjkgNjIuMDg2IEwgODguMTI5IDc0LjA4NSBMIDg4LjEyOSAxMDguMDg1IFoiIHN0eWxlPSJmaWxsOiByZ2IoMjYsIDEzNiwgMCk7Ii8+CiAgPHBhdGggZD0iTSA1OS4xMjkgNjEuMDg2IEwgODcuNjI5IDczLjA4NSBMIDExNi4xMjkgNjEuMDg2IEwgODcuMTI5IDUwLjA4NiBMIDU5LjEyOSA2MS4wODYgWiIgc3R5bGU9ImZpbGw6IHJnYig0MCwgMjEzLCAwKTsiLz4KICA8ZGVmcy8+Cjwvc3ZnPg==', 'dev-center', 'Dev Center', 'This is the app that makes apps', 'https://builtins.namespaces.puter.com/dev-center', 1, 1, 0, 1, 1, 0, NULL, '2020-01-01 00:00:00');

INSERT IGNORE INTO `apps` (`uid`, `owner_user_id`, `icon`, `name`, `title`, `description`, `index_url`, `godmode`, `maximize_on_start`, `background`, `approved_for_listing`, `approved_for_opening_items`, `approved_for_incentive_program`, `tags`, `timestamp`) VALUES ('app-fbbdb72b-ad08-4cb4-86a1-de0f27cf2e1e', 1, NULL, 'puter-linux', 'Puter Linux', 'Linux emulator for Puter', 'https://builtins.namespaces.puter.com/emulator', 1, 0, 0, 1, 1, 0, NULL, '2020-01-01 00:00:00');

/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FK */;
