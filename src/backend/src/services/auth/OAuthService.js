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
"use strict";

const BaseService = require("../BaseService");
const { get_user } = require("../../helpers");
const { DB_WRITE } = require("../database/consts");
const { UserActorType } = require("./Actor");
const { Actor } = require("./Actor");
const { generate_identifier } = require("../../util/identifier");
const config = require("../../config");

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
        if (this.global_config.oauth?.enabled) {
            this.initializePassport();
        }
    }

    /**
     * Initialize Passport.js with OAuth strategies
     */
    initializePassport() {
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
        if (this.global_config.oauth?.google?.enabled) {
            this.configureGoogleStrategy();
        }

        // Configure Discord OAuth strategy if enabled
        if (this.global_config.oauth?.discord?.enabled) {
            this.configureDiscordStrategy();
        }
    }

    /**
     * Configure Google OAuth strategy
     */
    configureGoogleStrategy() {
        const googleConfig = this.global_config.oauth.google;
        const GoogleStrategy = this.modules.GoogleStrategy;
        
        this.modules.passport.use(new GoogleStrategy({
            clientID: googleConfig.clientID,
            clientSecret: googleConfig.clientSecret,
            callbackURL: `${this.global_config.api_base_url}${googleConfig.callbackURL}`,
            scope: googleConfig.scope
        }, (accessToken, refreshToken, profile, done) => {
            this.verifyOAuthUser('google', profile, done);
        }));
    }

    /**
     * Configure Discord OAuth strategy
     */
    configureDiscordStrategy() {
        const discordConfig = this.global_config.oauth.discord;
        const DiscordStrategy = this.modules.DiscordStrategy;
        
        this.modules.passport.use(new DiscordStrategy({
            clientID: discordConfig.clientID,
            clientSecret: discordConfig.clientSecret,
            callbackURL: `${this.global_config.api_base_url}${discordConfig.callbackURL}`,
            scope: discordConfig.scope
        }, (accessToken, refreshToken, profile, done) => {
            this.verifyOAuthUser('discord', profile, done);
        }));
    }

    /**
     * Verify or create a user from OAuth profile
     * @param {string} provider - OAuth provider (google, discord)
     * @param {Object} profile - User profile from OAuth provider
     * @param {Function} done - Passport callback
     */
    async verifyOAuthUser(provider, profile, done) {
        try {
            // Find existing user by OAuth provider and ID
            const existingUsers = await this.db.read(
                'SELECT * FROM user WHERE oauth_provider = ? AND oauth_id = ? LIMIT 1',
                [provider, profile.id]
            );

            if (existingUsers.length > 0) {
                // User exists, return the user
                const user = await get_user({ id: existingUsers[0].id });
                return done(null, user);
            }

            // Check if user exists with the same email
            let email = null;
            
            if (provider === 'google') {
                email = profile.emails[0]?.value;
            } else if (provider === 'discord') {
                email = profile.email;
            }

            if (email) {
                const usersWithEmail = await this.db.read(
                    'SELECT * FROM user WHERE email = ? AND email_confirmed = 1 LIMIT 1',
                    [email]
                );

                if (usersWithEmail.length > 0) {
                    // Link OAuth to existing account
                    await this.db.write(
                        'UPDATE user SET oauth_provider = ?, oauth_id = ?, oauth_data = ? WHERE id = ?',
                        [provider, profile.id, JSON.stringify(profile), usersWithEmail[0].id]
                    );
                    
                    const user = await get_user({ id: usersWithEmail[0].id });
                    return done(null, user);
                }
            }

            // Create a new user
            const newUser = await this.createOAuthUser(provider, profile);
            return done(null, newUser);
        } catch (error) {
            this.log.error('OAuth verification error', error);
            return done(error, null);
        }
    }

    /**
     * Create a new user from OAuth profile
     * @param {string} provider - OAuth provider (google, discord)
     * @param {Object} profile - User profile from OAuth provider
     * @returns {Object} Newly created user
     */
    async createOAuthUser(provider, profile) {
        // Extract email and name from profile
        let email = null;
        let displayName = null;
        
        if (provider === 'google') {
            email = profile.emails[0]?.value;
            displayName = profile.displayName || profile.name?.givenName;
        } else if (provider === 'discord') {
            email = profile.email;
            displayName = profile.username || profile.global_name;
        }

        // Generate a username based on display name or a random identifier
        let username = displayName ? displayName.replace(/[^a-zA-Z0-9_]/g, '') : null;
        
        // If username is empty or null, generate a random one
        if (!username) {
            username = await this.generateUniqueUsername();
        } else {
            // Check if username exists
            const usernameExists = await this.db.read(
                'SELECT EXISTS(SELECT 1 FROM user WHERE username = ?) AS username_exists',
                [username]
            );
            
            if (usernameExists[0].username_exists) {
                username = await this.generateUniqueUsername();
            }
        }

        // Create user record
        const userUuid = this.modules.uuidv4();
        const emailConfirmToken = this.modules.uuidv4();
        const emailConfirmCode = Math.floor(100000 + Math.random() * 900000);
        
        // Audit metadata
        const auditMetadata = {
            provider,
            profile_id: profile.id,
            oauth_signup: true
        };

        const insertResult = await this.db.write(
            `INSERT INTO user
            (
                username, email, clean_email, password, uuid, 
                email_confirm_code, email_confirm_token, free_storage, 
                email_confirmed, oauth_provider, oauth_id, oauth_data,
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
                1, // email_confirmed is true for OAuth users
                provider,
                profile.id,
                JSON.stringify(profile),
                JSON.stringify(auditMetadata)
            ]
        );

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
    }

    /**
     * Generate a unique username
     * @returns {string} Unique username
     */
    async generateUniqueUsername() {
        let username;
        let usernameExists;
        
        do {
            username = generate_identifier();
            
            const result = await this.db.read(
                'SELECT EXISTS(SELECT 1 FROM user WHERE username = ?) AS username_exists',
                [username]
            );
            
            usernameExists = result[0].username_exists;
        } while (usernameExists);
        
        return username;
    }

    /**
     * Create a session for an OAuth authenticated user
     * @param {Object} user - User object
     * @param {Object} meta - Metadata for the session
     * @returns {Object} Session token
     */
    async createOAuthSession(user, meta = {}) {
        const { token } = await this.svc_auth.create_session_token(user, meta);
        return { token, user };
    }

    /**
     * Create an Actor for the authenticated OAuth user
     * @param {Object} user - User object
     * @param {string} sessionUuid - Session UUID
     * @returns {Actor} Actor object
     */
    createOAuthActor(user, sessionUuid) {
        const actorType = new UserActorType({
            user,
            session: sessionUuid
        });

        return new Actor({
            user_uid: user.uuid,
            type: actorType
        });
    }
}

module.exports = OAuthService;