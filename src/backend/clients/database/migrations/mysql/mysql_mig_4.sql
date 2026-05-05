-- Copyright (C) 2024-present Puter Technologies Inc.
--
-- Drop the viewer app (broken) and re-point camera/recorder/editor at
-- working third-party URLs. Mirrors SQLite migration 0047.
--
-- Idempotent: DELETE/UPDATE are no-ops if the rows are already in the
-- target state, so re-running the migration directory is safe.

DELETE FROM `apps` WHERE `uid` = 'app-7870be61-8dff-4a99-af64-e9ae6811e367';

UPDATE `apps` SET `index_url` = 'https://online-camera.com' WHERE `uid` = 'app-5584fbf7-ed69-41fc-99cd-85da21b1ef51';
UPDATE `apps` SET `index_url` = 'https://voice-recorder.com' WHERE `uid` = 'app-7bdca1a4-6373-4c98-ad97-03ff2d608ca1';
UPDATE `apps` SET `index_url` = 'https://online-notepad.com' WHERE `uid` = 'app-838dfbc4-bf8b-48c2-b47b-c4adc77fab58';
