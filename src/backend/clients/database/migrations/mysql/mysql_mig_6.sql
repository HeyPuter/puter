-- Copyright (C) 2024-present Puter Technologies Inc.
--
-- Refresh PDF and Player to point at hosted icons and updated index_urls,
-- and add the new Music Player app. The Player app moves to
-- simple-player.puter.com so the player.puter.com hostname can be reused
-- by the Music Player entry inserted below. Mirrors SQLite migration 0049.
--
-- Idempotent: UPDATEs are no-ops once rows are in the target state and
-- INSERT IGNORE will skip the Music Player row if its uid/name already
-- exists, so re-running the migration directory is safe.

UPDATE `apps`
   SET `index_url` = 'https://pdf.puter.com',
       `icon`      = 'https://puter-app-icons.puter.site/app-3920851d-bda8-479b-9407-8517293c7d44.png'
 WHERE `uid` = 'app-3920851d-bda8-479b-9407-8517293c7d44';

UPDATE `apps`
   SET `index_url` = 'https://simple-player.puter.com',
       `icon`      = 'https://api.puter.com/app-icon/app-11edfba2-1ed3-4e22-8573-47e88fb87d70?v=1778450714818'
 WHERE `uid` = 'app-11edfba2-1ed3-4e22-8573-47e88fb87d70';

INSERT IGNORE INTO `apps` (
    `uid`, `owner_user_id`, `icon`, `name`, `title`, `description`,
    `index_url`, `godmode`, `maximize_on_start`, `background`,
    `approved_for_listing`, `approved_for_opening_items`, `approved_for_incentive_program`,
    `tags`, `timestamp`
) VALUES (
    'app-d7e9471f-e441-4d72-a5ab-75e96573b76b',
    1,
    'https://puter-app-icons.puter.site/app-d7e9471f-e441-4d72-a5ab-75e96573b76b-512.png',
    'music-player', 'Music Player', 'A free music player app in the browser.',
    'https://player.puter.com',
    0, 0, 0, 1, 0, 0,
    NULL, '2026-05-10 00:00:00'
);
