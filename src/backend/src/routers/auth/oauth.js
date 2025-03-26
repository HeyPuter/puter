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

const config = require('../../config');
const { get_taskbar_items } = require('../../helpers');
const { Context } = require('../../util/context');

const router = new express.Router();

// Helper function to handle OAuth callback
const handle_oauth_callback = async (req, res) => {
    if ( !req.user ) {
        return res.redirect('/login?error=oauth_failed');
    }

    try {
        const svc_oauth = req.services.get('oauth');
        const { token, user } = await svc_oauth.create_oauth_session(req.user, { req });

        // Set cookie
        res.cookie(config.cookie_name, token, {
            sameSite: 'none',
            secure: true,
            httpOnly: true,
        });

        // Redirect to success page or main app
        return res.redirect('/');
    } catch (error) {
        console.error('OAuth callback error:', error);
        return res.redirect('/login?error=oauth_session_failed');
    }
};

// Only enable OAuth routes if OAuth is enabled in config
if ( config.oauth?.enabled ) {
    // Google OAuth routes
    if ( config.oauth?.google?.enabled ) {
        router.get('/auth/google', passport.authenticate('google', {
            scope: config.oauth.google.scope,
        }));

        router.get('/auth/google/callback', 
            passport.authenticate('google', { 
                failureRedirect: '/login?error=google_auth_failed',
                session: false,
            }),
            handle_oauth_callback
        );
    }

    // Discord OAuth routes
    if ( config.oauth?.discord?.enabled ) {
        router.get('/auth/discord', passport.authenticate('discord', {
            scope: config.oauth.discord.scope,
        }));

        router.get('/auth/discord/callback',
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