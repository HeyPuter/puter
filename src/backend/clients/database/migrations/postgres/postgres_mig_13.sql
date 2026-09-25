-- Drops three groups that no code has ever read: `freeai`, `experimental` and
-- `dangerous`. No migration creates them — they were added by hand back when
-- hardcoded permissions were keyed by group name. That map is now a flat
-- per-user floor (`default_user_permissions` in data/hardcoded-permissions.js),
-- so a group nothing looks up grants nothing, and the rows are dead weight.
--
-- Guarded, and deliberately so: user_to_group_permissions.group_id and
-- jct_user_group.group_id both cascade on delete, so removing a group that
-- still carries permissions or members would silently revoke them from every
-- member. Only a group with neither is dropped. A group that survives this
-- migration has dependents and needs a deliberate decision, not a sweep --
-- query user_to_group_permissions by group_id to see what it holds.
DELETE FROM "group" g
WHERE g.extra ->> 'name' IN ('freeai', 'experimental', 'dangerous')
  AND NOT EXISTS (
      SELECT 1 FROM user_to_group_permissions p WHERE p.group_id = g.id
  )
  AND NOT EXISTS (
      SELECT 1 FROM jct_user_group j WHERE j.group_id = g.id
  );
