/*
 * Copyright (C) 2025-present Puter Technologies Inc.
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
"use strict";

const BaseService = require("../BaseService");
const { DB_WRITE } = require("../database/consts");
const { UserActorType } = require("./Actor");
const { Actor } = require("./Actor");
const { get_user } = require("../../helpers");
const config = require("../../config");
const { generate_identifier } = require("../../util/identifier");

/**
 * @class OAuthService
 * This class is responsible for handling OAuth authentication operations
 */
class OAuthService extends BaseService {
    static MODULES = {
        passport: require('passport'),
        GoogleStrategy: require('passport-google-oauth20').Strategy,
        DiscordStrategy: require('passport-discord').Strategy,
        bcrypt: require('bcrypt'),
        uuidv4: require('uuid').v4,
    };

    async _init() {
        this.db = await this.services.get('database').get(DB_WRITE, 'auth');
        this.svc_auth = await this.services.get('auth');
        
        // Initialize passport only if OAuth is enabled
        if ( this.global_config.oauth?.enabled ) {
            this.initialize_passport();
        }
    }

    /**
     * Initialize Passport.js with OAuth strategies
     */
    initialize_passport() {
        const passport = this.modules.passport;
        
        // Set up passport serialization/deserialization
        passport.serializeUser((user, done) => {
            done(null, user.uuid);
        });

        passport.deserializeUser(async (uuid, done) => {
            try {
                const user = await get_user({ uuid });
                done(null, user);
            } catch (error) {
                done(error, null);
            }
        });

        // Configure Google OAuth strategy if enabled
        if ( this.global_config.oauth?.google?.enabled ) {
            this.configure_google_strategy();
        }

        // Configure Discord OAuth strategy if enabled
        if ( this.global_config.oauth?.discord?.enabled ) {
            this.configure_discord_strategy();
        }
    }

    /**
     * Configure Google OAuth strategy
     */
    configure_google_strategy() {
        const googleConfig = this.global_config.oauth.google;
        const GoogleStrategy = this.modules.GoogleStrategy;
        
        this.modules.passport.use(new GoogleStrategy({
            clientID: googleConfig.clientID,
            clientSecret: googleConfig.clientSecret,
            callbackURL: `${this.global_config.api_base_url}${googleConfig.callbackURL}`,
            scope: googleConfig.scope,
        }, (accessToken, refreshToken, profile, done) => {
            this.verify_oauth_user('google', profile, done);
        }));
    }

    /**
     * Configure Discord OAuth strategy
     */
    configure_discord_strategy() {
        const discordConfig = this.global_config.oauth.discord;
        const DiscordStrategy = this.modules.DiscordStrategy;
        
        this.modules.passport.use(new DiscordStrategy({
            clientID: discordConfig.clientID,
            clientSecret: discordConfig.clientSecret,
            callbackURL: `${this.global_config.api_base_url}${discordConfig.callbackURL}`,
            scope: discordConfig.scope,
        }, (accessToken, refreshToken, profile, done) => {
            this.verify_oauth_user('discord', profile, done);
        }));
    }

    /**
     * Extract email from OAuth profile
     * @param {string} provider - OAuth provider name
     * @param {Object} profile - User profile from OAuth provider
     * @returns {string|null} Email address or null if not available
     */
    extractEmailFromProfile(provider, profile) {
        if (!profile) return null;
        
        switch (provider) {
            case 'google':
                return profile.emails && profile.emails[0] ? profile.emails[0].value : null;
            case 'discord':
                return profile.email || null;
            default:
                return null;
        }
    }
    
    /**
     * Extract display name from OAuth profile
     * @param {string} provider - OAuth provider name
     * @param {Object} profile - User profile from OAuth provider
     * @returns {string|null} Display name or null if not available
     */
    extractDisplayNameFromProfile(provider, profile) {
        if (!profile) return null;
        
        switch (provider) {
            case 'google':
                return profile.displayName || (profile.name ? profile.name.givenName : null);
            case 'discord':
                return profile.username || profile.global_name || null;
            default:
                return null;
        }
    }
    
    /**
     * Extract and sanitize profile data for storage
     * @param {string} provider - OAuth provider name
     * @param {Object} profile - User profile from OAuth provider
     * @returns {Object} Sanitized profile data
     */
    sanitizeProfileData(provider, profile) {
        // Create a safe copy with only needed fields
        const safeProfile = {
            id: profile.id,
            provider: provider,
            displayName: this.extractDisplayNameFromProfile(provider, profile),
            email: this.extractEmailFromProfile(provider, profile),
            createdAt: new Date().toISOString()
        };
        
        return safeProfile;
    }
    
    /**
     * Verify or create a user from OAuth profile
     * @param {string} provider - OAuth provider (google, discord)
     * @param {Object} profile - User profile from OAuth provider
     * @param {Function} done - Passport callback
     */
    async verify_oauth_user(provider, profile, done) {
        try {
            // Validate inputs
            if (!provider || !profile || !profile.id) {
                return done(new Error('Invalid OAuth profile data'), null);
            }
            
            // Find existing user by OAuth provider and ID
            // First check the oauth_providers table (new approach)
            const existingOAuthUsers = await this.db.read(
                'SELECT user_id FROM oauth_providers WHERE provider = ? AND provider_user_id = ? LIMIT 1',
                [provider, profile.id]
            );
            
            if (existingOAuthUsers.length > 0) {
                // User exists, return the user
                const user = await get_user({ id: existingOAuthUsers[0].user_id });
                return done(null, user);
            }
            
            // Fallback to checking the user table directly (legacy approach)
            const existingLegacyUsers = await this.db.read(
                'SELECT id FROM user WHERE oauth_provider = ? AND oauth_id = ? LIMIT 1',
                [provider, profile.id]
            );

            if (existingLegacyUsers.length > 0) {
                // User exists in legacy format, return the user
                const user = await get_user({ id: existingLegacyUsers[0].id });
                
                // Migrate this user to the new table structure
                await this.migrateUserToOAuthProvidersTable(existingLegacyUsers[0].id, provider, profile.id);
                
                return done(null, user);
            }

            // Check if user exists with the same email
            const email = this.extractEmailFromProfile(provider, profile);

            if (email) {
                const usersWithEmail = await this.db.read(
                    'SELECT id FROM user WHERE email = ? AND email_confirmed = 1 LIMIT 1',
                    [email]
                );

                if (usersWithEmail.length > 0) {
                    // Link OAuth to existing account
                    const safeProfileData = this.sanitizeProfileData(provider, profile);
                    
                    // Check if this provider is already linked to this user
                    const existingProvider = await this.db.read(
                        'SELECT id FROM oauth_providers WHERE user_id = ? AND provider = ? LIMIT 1',
                        [usersWithEmail[0].id, provider]
                    );
                    
                    if (existingProvider.length === 0) {
                        // Add new OAuth provider to the user
                        await this.db.write(
                            'INSERT INTO oauth_providers (user_id, provider, provider_user_id, provider_data) VALUES (?, ?, ?, ?)',
                            [usersWithEmail[0].id, provider, profile.id, JSON.stringify(safeProfileData)]
                        );
                        
                        // For backward compatibility, also update the user table
                        await this.db.write(
                            'UPDATE user SET oauth_provider = ?, oauth_id = ?, oauth_data = ? WHERE id = ?',
                            [provider, profile.id, JSON.stringify(safeProfileData), usersWithEmail[0].id]
                        );
                    } else {
                        // Update existing provider data
                        await this.db.write(
                            'UPDATE oauth_providers SET provider_user_id = ?, provider_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                            [profile.id, JSON.stringify(safeProfileData), existingProvider[0].id]
                        );
                        
                        // For backward compatibility, also update the user table
                        await this.db.write(
                            'UPDATE user SET oauth_provider = ?, oauth_id = ?, oauth_data = ? WHERE id = ?',
                            [provider, profile.id, JSON.stringify(safeProfileData), usersWithEmail[0].id]
                        );
                    }
                    
                    const user = await get_user({ id: usersWithEmail[0].id });
                    return done(null, user);
                }
            }

            // Create a new user
            const newUser = await this.create_oauth_user(provider, profile);
            return done(null, newUser);
        } catch (error) {
            // Log error without exposing sensitive data
            this.log.error(`OAuth verification error for provider ${provider}: ${error.message}`);
            return done(new Error('Authentication failed'), null);
        }
    }

    /**
     * Create a new user from OAuth profile
     * @param {string} provider - OAuth provider (google, discord)
     * @param {Object} profile - User profile from OAuth provider
     * @returns {Object} Newly created user
     */
    async create_oauth_user(provider, profile) {
        try {
            // Extract email and display name using our helper methods
            const email = this.extractEmailFromProfile(provider, profile);
            const displayName = this.extractDisplayNameFromProfile(provider, profile);
    
            // Generate a username based on display name or a random identifier
            let username = null;
            
            if (displayName) {
                // Sanitize display name to create a valid username
                const sanitizedName = displayName.replace(/[^a-zA-Z0-9_]/g, '');
                
                // Only use display name if it results in a valid username
                if (sanitizedName && sanitizedName.length >= 3) {
                    username = sanitizedName;
                }
            }
            
            // If no valid username was created, generate a random one
            if (!username) {
                username = await this.generate_unique_username();
            } else {
                // Check if username exists
                const usernameExists = await this.db.read(
                    'SELECT EXISTS(SELECT 1 FROM user WHERE username = ?) AS username_exists',
                    [username]
                );
                
                if (usernameExists[0].username_exists) {
                    username = await this.generate_unique_username();
                }
            }
    
            // Create user record with safe values
            const userUuid = this.modules.uuidv4();
            const emailConfirmToken = this.modules.uuidv4();
            const emailConfirmCode = Math.floor(100000 + Math.random() * 900000);
            
            // Create sanitized profile data for storage
            const safeProfileData = this.sanitizeProfileData(provider, profile);
            
            // Audit metadata - only store necessary information
            const auditMetadata = {
                provider,
                profile_id: profile.id,
                oauth_signup: true,
                created_at: new Date().toISOString()
            };
    
            // Start a transaction for creating user and OAuth provider
            await this.db.write('BEGIN TRANSACTION');
            
            try {
                // Create the user record first
                const insertResult = await this.db.write(
                    `INSERT INTO user
                    (
                        username, email, clean_email, password, uuid, 
                        email_confirm_code, email_confirm_token, free_storage, 
                        email_confirmed, oauth_provider, oauth_id, oauth_data, // Keep legacy fields for compatibility
                        audit_metadata
                    ) 
                    VALUES 
                    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        username,
                        email,
                        email, // clean_email (we assume OAuth providers give clean emails)
                        null, // password is null for OAuth users
                        userUuid,
                        emailConfirmCode,
                        emailConfirmToken,
                        config.storage_capacity,
                        email ? 1 : 0, // email_confirmed is true only if we have an email
                        provider, // Keep legacy field
                        profile.id, // Keep legacy field
                        JSON.stringify(safeProfileData), // Keep legacy field
                        JSON.stringify(auditMetadata)
                    ]
                );
                
                // Now create the OAuth provider record
                await this.db.write(
                    `INSERT INTO oauth_providers
                    (user_id, provider, provider_user_id, provider_data)
                    VALUES (?, ?, ?, ?)`,
                    [
                        insertResult.insertId,
                        provider,
                        profile.id,
                        JSON.stringify(safeProfileData)
                    ]
                );
                
                // Commit the transaction
                await this.db.write('COMMIT');
            } catch (error) {
                // Rollback in case of error
                await this.db.write('ROLLBACK');
                throw error;
            }
    
            // Add user to default user group
            const svc_group = await this.services.get('group');
            await svc_group.add_users({
                uid: config.default_user_group,
                users: [username]
            });
    
            // Generate default file system entries
            const svc_user = await this.services.get('user');
            const user = await get_user({ id: insertResult.insertId });
            await svc_user.generate_default_fsentries({ user });
    
            // Add to mailchimp or other services
            const svc_event = await this.services.get('event');
            svc_event.emit('user.save_account', { user });
    
            return user;
        } catch (error) {
            this.log.error(`Error creating OAuth user: ${error.message}`);
            throw new Error('Failed to create user account');
        }
    }

    /**
     * Generate a unique username
     * @returns {string} Unique username
     */
    async generate_unique_username() {
        let username;
        let usernameExists;
        
        do {
            username = generate_identifier();
            
            const result = await this.db.read(
                'SELECT EXISTS(SELECT 1 FROM user WHERE username = ?) AS username_exists',
                [username]
            );
            
            usernameExists = result[0].username_exists;
        } while ( usernameExists );
        
        return username;
    }

    /**
     * Create a session for an OAuth authenticated user
     * @param {Object} user - User object
     * @param {Object} meta - Metadata for the session
     * @returns {Object} Session token
     */
    async create_oauth_session(user, meta = {}) {
        const { token } = await this.svc_auth.create_session_token(user, meta);
        return { token, user };
    }

    /**
     * Create an Actor for the authenticated OAuth user
     * @param {Object} user - User object
     * @param {string} sessionUuid - Session UUID
     * @returns {Actor} Actor object
     */
    create_oauth_actor(user, sessionUuid) {
        const actorType = new UserActorType({
            user,
            session: sessionUuid,
        });

        return new Actor({
            user_uid: user.uuid,
            type: actorType,
        });
    }
    
    /**
     * Migrate a user from the legacy OAuth format to the new oauth_providers table
     * @param {number} userId - User ID
     * @param {string} provider - OAuth provider name
     * @param {string} providerId - Provider-specific user ID
     * @returns {Promise<void>}
     */
    async migrateUserToOAuthProvidersTable(userId, provider, providerId) {
        try {
            // Get the user's OAuth data from the legacy format
            const userData = await this.db.read(
                'SELECT oauth_data FROM user WHERE id = ? LIMIT 1',
                [userId]
            );
            
            if (userData.length === 0 || !userData[0].oauth_data) {
                return;
            }
            
            // Check if this provider is already in the oauth_providers table
            const existingProvider = await this.db.read(
                'SELECT id FROM oauth_providers WHERE user_id = ? AND provider = ? LIMIT 1',
                [userId, provider]
            );
            
            if (existingProvider.length === 0) {
                // Add to the oauth_providers table
                await this.db.write(
                    'INSERT INTO oauth_providers (user_id, provider, provider_user_id, provider_data) VALUES (?, ?, ?, ?)',
                    [userId, provider, providerId, userData[0].oauth_data]
                );
                
                this.log.info(`Migrated OAuth data for user ${userId} to oauth_providers table`);
            }
        } catch (error) {
            this.log.error(`Error migrating OAuth data for user ${userId}: ${error.message}`);
        }
    }
    
    /**
     * Get all OAuth providers for a user
     * @param {number} userId - User ID
     * @returns {Promise<Array>} - Array of OAuth providers
     */
    async getUserOAuthProviders(userId) {
        try {
            return await this.db.read(
                'SELECT id, provider, provider_user_id, created_at, updated_at FROM oauth_providers WHERE user_id = ?',
                [userId]
            );
        } catch (error) {
            this.log.error(`Error getting OAuth providers for user ${userId}: ${error.message}`);
            return [];
        }
    }
    
    /**
     * Remove an OAuth provider from a user
     * @param {number} userId - User ID
     * @param {string} provider - Provider name
     * @returns {Promise<boolean>} - Success status
     */
    async removeOAuthProvider(userId, provider) {
        try {
            await this.db.write(
                'DELETE FROM oauth_providers WHERE user_id = ? AND provider = ?',
                [userId, provider]
            );
            
            // Check if this was the user's primary provider (in legacy table)
            const userData = await this.db.read(
                'SELECT oauth_provider FROM user WHERE id = ? LIMIT 1',
                [userId]
            );
            
            if (userData.length > 0 && userData[0].oauth_provider === provider) {
                // Clear the legacy fields if this was the primary provider
                await this.db.write(
                    'UPDATE user SET oauth_provider = NULL, oauth_id = NULL, oauth_data = NULL WHERE id = ?',
                    [userId]
                );
            }
            
            return true;
        } catch (error) {
            this.log.error(`Error removing OAuth provider ${provider} for user ${userId}: ${error.message}`);
            return false;
        }
    }
}

module.exports = { OAuthService };