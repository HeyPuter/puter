/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Migration to add OAuth-related fields to the user table
 */
module.exports = {
    /**
     * Apply the migration
     * @param {Object} db - Database connection
     */
    async up(db) {
        await db.write(`
            ALTER TABLE user
            ADD COLUMN oauth_provider VARCHAR(50) NULL,
            ADD COLUMN oauth_id VARCHAR(255) NULL,
            ADD COLUMN oauth_data TEXT NULL,
            ADD INDEX idx_oauth_provider_id (oauth_provider, oauth_id)
        `);
    },

    /**
     * Undo the migration
     * @param {Object} db - Database connection
     */
    async down(db) {
        await db.write(`
            ALTER TABLE user
            DROP COLUMN oauth_provider,
            DROP COLUMN oauth_id,
            DROP COLUMN oauth_data,
            DROP INDEX idx_oauth_provider_id
        `);
    }
};