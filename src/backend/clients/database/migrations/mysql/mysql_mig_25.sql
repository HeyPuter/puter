-- Drops three groups that no code has ever read: `freeai`, `experimental` and
-- `dangerous`. No migration creates them — they were added by hand back when
-- hardcoded permissions were keyed by group name. That map is now a flat
-- per-user floor (`default_user_permissions` in data/hardcoded-permissions.js),
-- so a group nothing looks up grants nothing, and the rows are dead weight.
--
-- Guarded, and deliberately so: `user_to_group_permissions.group_id` and
-- `jct_user_group.group_id` both cascade on delete, so removing a group that
-- still carries permissions or members would silently revoke them from every
-- member. Only a group with neither is dropped. A group that survives this
-- migration has dependents and needs a deliberate decision, not a sweep --
-- query `user_to_group_permissions` by `group_id` to see what it holds.
--
-- The joins rather than `NOT IN` subqueries: MySQL will not read from the table
-- it is deleting from inside a subquery on the same statement.
DELETE g FROM `group` g
LEFT JOIN `user_to_group_permissions` p ON p.`group_id` = g.`id`
LEFT JOIN `jct_user_group` j ON j.`group_id` = g.`id`
WHERE JSON_UNQUOTE(JSON_EXTRACT(g.`extra`, '$.name'))
        IN ('freeai', 'experimental', 'dangerous')
  AND p.`group_id` IS NULL
  AND j.`group_id` IS NULL;
