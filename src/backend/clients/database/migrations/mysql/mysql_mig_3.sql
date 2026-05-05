-- Copyright (C) 2024-present Puter Technologies Inc.
--
-- Default groups + the `system` user that issues the hardcoded driver
-- permission grants in `data/hardcoded-permissions.js`. Mirrors what the
-- SQLite migrations 0024_default-groups.sql + 0025_system-user.dbmig.js
-- do for the source-tree dev path; without these rows, MySQL self-host
-- signups land in groups that don't exist and the hc-user-group
-- permission scanner has no `system` user to resolve as the issuer ⇒
-- every `/drivers/call` 403s.
--
-- Order matters:
--   1. system user inserted first → gets id=1, owns the default apps
--      that mysql_mig_2.sql already inserted with owner_user_id=1.
--   2. groups inserted next, all owned by system (owner_user_id=1).
--   3. DefaultUserService later creates the admin user (id=2) and adds
--      them to the admin group, which now exists.
--
-- INSERT IGNORE keeps it idempotent across re-runs.
--
-- FK temporarily disabled because owner_user_id columns reference
-- user.id, and we're inserting both sides in the same transaction.

/*!40014 SET @OLD_FK = @@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;

INSERT IGNORE INTO `user` (`uuid`, `username`)
VALUES ('5d4adce0-a381-4982-9c02-6e2540026238', 'system');

INSERT IGNORE INTO `group` (`uid`, `owner_user_id`, `extra`, `metadata`) VALUES
    ('26bfb1fb-421f-45bc-9aa4-d81ea569e7a5', 1,
        '{"critical": true, "type": "default", "name": "system"}',
        '{"title": "System", "color": "#000000"}'),
    ('ca342a5e-b13d-4dee-9048-58b11a57cc55', 1,
        '{"critical": true, "type": "default", "name": "admin"}',
        '{"title": "Admin", "color": "#a83232"}'),
    ('78b1b1dd-c959-44d2-b02c-8735671f9997', 1,
        '{"critical": true, "type": "default", "name": "user"}',
        '{"title": "User", "color": "#3254a8"}'),
    ('b7220104-7905-4985-b996-649fdcdb3c8f', 1,
        '{"critical": true, "type": "default", "name": "temp"}',
        '{"title": "Temp", "color": "#888888"}'),
    ('3c2dfff7-d22a-41aa-a193-59a61dac4b64', 1,
        '{"type": "default", "name": "moderator"}',
        '{"title": "Moderator", "color": "#a432a8"}'),
    ('5e8f251d-3382-4b0d-932c-7bb82f48652f', 1,
        '{"type": "default", "name": "developer"}',
        '{"title": "Developer", "color": "#32a852"}');

-- Mirrors 0025_system-user.dbmig.js: system grants the admin group
-- unrestricted `driver` access. Hardcoded permission rules in
-- data/hardcoded-permissions.js layer additional per-group grants on
-- top, but this row is the canonical "admin can drive everything" link.
INSERT IGNORE INTO `user_to_group_permissions` (`user_id`, `group_id`, `permission`, `extra`)
SELECT u.id, g.id, 'driver', '{}'
FROM `user` u, `group` g
WHERE u.username = 'system'
  AND g.uid = 'ca342a5e-b13d-4dee-9048-58b11a57cc55';

/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FK */;
