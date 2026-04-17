-- Add UNIQUE constraint to user.uuid column to support foreign key references
-- This is required for the foreign key in _extension_purchased_items table
-- which references "user"."uuid"

-- SQLite supports adding UNIQUE constraints via CREATE UNIQUE INDEX
-- This is much simpler and safer than recreating the entire table
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_uuid ON user(uuid);