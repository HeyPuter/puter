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

const express = require('express');
const passport = require('passport');
const crypto = require('crypto');

const config = require('../../config');
const { get_taskbar_items } = require('../../helpers');
const { Context } = require('../../util/context');

const router = new express.Router();

// Helper function to generate a random state parameter for CSRF protection
const generateStateParameter = () => {
    return crypto.randomBytes(32).toString('hex');
};

// Helper function to verify state parameter
const verifyStateParameter = (req, res, next) => {
    const { state } = req.query;
    const savedState = req.session?.oauth?.state;

    if (!state || !savedState || state !== savedState) {
        return res.redirect('/login?error=oauth_state_mismatch');
    }
    
    // Clean up the state to prevent replay attacks
    delete req.session.oauth.state;
    
    next();
};

// Helper function to handle OAuth callback
const handle_oauth_callback = async (req, res) => {
    if ( !req.user ) {
        return res.redirect('/login?error=oauth_failed');
    }

    try {
        const svc_oauth = req.services.get('oauth');
        const { token, user } = await svc_oauth.create_oauth_session(req.user, { req });

        // Set cookie with appropriate security settings
        const cookieOptions = {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'lax' : 'none',
            maxAge: config.session_expiry || 30 * 24 * 60 * 60 * 1000 // Default to 30 days
        };
        
        res.cookie(config.cookie_name, token, cookieOptions);

        // Redirect to success page or main app
        return res.redirect('/');
    } catch (error) {
        // Log error with sensitive information redacted
        console.error('OAuth callback error:', error.message || 'Unknown error');
        return res.redirect('/login?error=oauth_session_failed');
    }
};

// Only enable OAuth routes if OAuth is enabled in config
if ( config.oauth?.enabled ) {
    // Google OAuth routes
    if ( config.oauth?.google?.enabled ) {
        router.get('/auth/google', (req, res, next) => {
            // Generate and store state parameter for CSRF protection
            const state = generateStateParameter();
            
            // Initialize session structure if needed
            req.session = req.session || {};
            req.session.oauth = req.session.oauth || {};
            req.session.oauth.state = state;
            
            passport.authenticate('google', {
                scope: config.oauth.google.scope,
                state: state
            })(req, res, next);
        });

        router.get('/auth/google/callback', 
            verifyStateParameter,
            passport.authenticate('google', { 
                failureRedirect: '/login?error=google_auth_failed',
                session: false,
            }),
            handle_oauth_callback
        );
    }

    // Discord OAuth routes
    if ( config.oauth?.discord?.enabled ) {
        router.get('/auth/discord', (req, res, next) => {
            // Generate and store state parameter for CSRF protection
            const state = generateStateParameter();
            
            // Initialize session structure if needed
            req.session = req.session || {};
            req.session.oauth = req.session.oauth || {};
            req.session.oauth.state = state;
            
            passport.authenticate('discord', {
                scope: config.oauth.discord.scope,
                state: state
            })(req, res, next);
        });

        router.get('/auth/discord/callback',
            verifyStateParameter,
            passport.authenticate('discord', {
                failureRedirect: '/login?error=discord_auth_failed',
                session: false,
            }),
            handle_oauth_callback
        );
    }

    // Route to get current OAuth providers status
    router.get('/oauth/providers', (req, res) => {
        const providers = {};

        if ( config.oauth?.google?.enabled ) {
            providers.google = true;
        }

        if ( config.oauth?.discord?.enabled ) {
            providers.discord = true;
        }

        if ( config.oauth?.github?.enabled ) {
            providers.github = true;
        }

        return res.json({ providers });
    });
}

module.exports = router;