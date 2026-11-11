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

import jQuery from './lib/jquery-3.6.1/jquery-3.6.1.min.js';
import { encode } from 'html-entities';
import { loadLocale } from './i18n/embedI18n.js';
import UIWindowAppFeedback from './UI/UIWindowAppFeedback.js';
import { embedSession } from './helpers/embedSession.js';
import { overlayGone } from './helpers/overlayGone.js';

window.$ = window.jQuery = jQuery;
window.html_encode = value => encode(String(value ?? ''), { mode: 'nonAsciiPrintable' });

const config = JSON.parse(document.querySelector('#feedback-embed-config').textContent);
window.api_origin = config.apiOrigin;
window.locale = 'en';
try {
    window.locale = JSON.parse(localStorage.getItem('user_preferences') || '{}')?.language || 'en';
} catch { /* Corrupt preferences must not prevent sending feedback. */ }
const localeReady = loadLocale(window.locale);

/** Answers only the page frame-ancestors pinned, which the feedback is for. */
const tellHost = (data) => window.parent.postMessage(data, config.hostOrigin);

/**
 * Shows the app feedback dialog for the framing page, as the signed-in user it
 * names. Without that user's session, or with an email still to confirm, the
 * host is told the embed is unavailable and uses the popup, which can sign in.
 */
async function run () {
    tellHost({ msg: 'feedbackEmbed', state: 'loading' });
    let session = null;
    try {
        session = await embedSession(config.apiOrigin, window.location.hash);
    } catch (e) {
        console.error('feedback embed: session check failed', e);
    }
    const user = session?.user;
    if ( !user || (user.requires_email_confirmation && !user.email_confirmed) ) {
        tellHost({ msg: 'feedbackEmbed', state: 'unavailable' });
        return;
    }
    window.auth_token = session.token;
    window.user = user;
    await localeReady;

    tellHost({ msg: 'feedbackEmbed', state: 'ready' });
    let sent = false;
    try {
        sent = await UIWindowAppFeedback({ origin: config.hostOrigin, source: 'web' });
        // After its success pane and exit.
        await overlayGone(document, '.app-feedback-overlay');
    } catch (e) {
        console.error('feedback embed: dialog failed', e);
    }
    tellHost({ msg: 'feedbackDialogClosed', sent: sent === true });
}

// Opened on its own, there is no page to send feedback for or answer.
if ( config.hostOrigin && window.parent !== window ) run();
