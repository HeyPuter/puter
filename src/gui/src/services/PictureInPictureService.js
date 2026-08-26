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

import { Service } from '../definitions.js';

/**
 * Opens Document Picture-in-Picture windows on behalf of apps.
 *
 * `documentPictureInPicture.requestWindow()` is only allowed from a
 * top-level document, and an app lives in an iframe — so an app cannot
 * float anything itself, whatever its iframe's `allow` list says (the
 * `document-picture-in-picture` token there is not a policy feature the
 * browser knows). The GUI is the top-level document, so it opens the
 * window and fills it with an iframe of a page the app names. That page
 * must come from the app's own origin: an app may float its own content
 * over the user's screen, nobody else's.
 *
 * The PiP window's `opener` is the GUI, so a page in it can reach its
 * app's frame as one of `parent.opener.frames` (same-origin access) and
 * share objects with it directly — a MediaStream, which postMessage
 * cannot carry, included. Apps that only need to talk can use
 * BroadcastChannel; both frames are the same origin.
 *
 * One window per app instance; it goes away with the app's window.
 */
export class PictureInPictureService extends Service {
    static description = `
        Opens Document Picture-in-Picture windows for apps.
    `;

    async _init ({ services }) {
        /** @type {Map<string, {pipWindow: Window}>} appInstanceID -> open window */
        this.windows_ = new Map();

        const svc_ipc = services.get('ipc');
        svc_ipc.register_ipc_handler('requestPictureInPicture', {
            handler: this.requestPictureInPicture.bind(this),
        });
        svc_ipc.register_ipc_handler('exitPictureInPicture', {
            handler: this.exitPictureInPicture.bind(this),
        });
    }

    get supported () {
        return typeof globalThis.documentPictureInPicture?.requestWindow === 'function';
    }

    /**
     * IPC: float `url` (a page of the caller's own origin) in a
     * picture-in-picture window. Must run off a user gesture in the app —
     * activation propagates from the app's frame to this window, and
     * requestWindow() insists on it.
     *
     * @param {{url?: string, width?: number, height?: number}} params
     * @returns {Promise<{ok: true} | {ok: false, error: {name: string, message: string}}>}
     */
    async requestPictureInPicture ({ url, width, height } = {}, { ipc_context } = {}) {
        const caller = ipc_context?.caller;
        const instance_id = caller?.app?.appInstanceID;
        const iframe = caller?.app?.iframe;
        if ( ! instance_id || ! iframe ) {
            return fail('InvalidStateError', 'There is no app window to float from.');
        }
        if ( ! this.supported ) {
            return fail('NotSupportedError', 'This browser has no Document Picture-in-Picture.');
        }

        let target;
        try {
            target = new URL(String(url));
        } catch {
            return fail('TypeError', '`url` must be an absolute http(s) URL.');
        }
        if ( target.protocol !== 'https:' && target.protocol !== 'http:' ) {
            return fail('TypeError', '`url` must be an absolute http(s) URL.');
        }
        // `origin` is the message's — what the frame actually is right now,
        // not what it was launched as. srcdoc apps have the opaque 'null'.
        const app_origin = caller.origin;
        if ( ! app_origin || app_origin === 'null' || target.origin !== app_origin ) {
            return fail('SecurityError', 'The page must come from the app’s own origin.');
        }

        // One per app: asking again replaces what is up.
        this.close_for_app(instance_id);

        const size = {};
        for ( const [key, value] of [['width', width], ['height', height]] ) {
            const n = Number(value);
            if ( Number.isFinite(n) && n > 0 ) size[key] = Math.round(n);
        }

        let pipWindow;
        try {
            pipWindow = await globalThis.documentPictureInPicture.requestWindow(size);
        } catch ( e ) {
            return fail(e?.name || 'NotAllowedError', e?.message || 'Could not open a picture-in-picture window.');
        }

        const doc = pipWindow.document;
        doc.documentElement.style.height = '100%';
        doc.body.style.cssText = 'margin:0;height:100%;overflow:hidden;';
        const pip_iframe = doc.createElement('iframe');
        pip_iframe.src = target.href;
        pip_iframe.setAttribute('allow', 'autoplay; encrypted-media');
        // The same box the app's own frame runs in.
        pip_iframe.setAttribute('sandbox', 'allow-forms allow-modals allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts allow-downloads');
        pip_iframe.style.cssText = 'display:block;border:0;width:100%;height:100%;';
        doc.body.append(pip_iframe);

        const entry = { pipWindow };
        this.windows_.set(instance_id, entry);
        // pagehide is the window going away for any reason. Our own close()
        // takes the entry out first, so only a close we didn't ask for —
        // the user's, typically — reaches the app.
        pipWindow.addEventListener('pagehide', () => {
            if ( this.windows_.get(instance_id) !== entry ) return;
            this.windows_.delete(instance_id);
            iframe.contentWindow?.postMessage({ msg: 'pictureInPictureClosed' }, '*');
        });

        return { ok: true };
    }

    /**
     * IPC: close the caller's picture-in-picture window, if it has one.
     *
     * @returns {Promise<{ok: true, wasOpen: boolean}>}
     */
    async exitPictureInPicture (_params, { ipc_context } = {}) {
        const instance_id = ipc_context?.caller?.app?.appInstanceID;
        return { ok: true, wasOpen: this.close_for_app(instance_id) };
    }

    /**
     * Closes the window an app instance has up, if any. Called when the
     * app's window closes, too — the floating window is the app's.
     *
     * @param {string} instance_id
     * @returns {boolean} whether there was one
     */
    close_for_app (instance_id) {
        const entry = this.windows_.get(instance_id);
        if ( ! entry ) return false;
        this.windows_.delete(instance_id);
        try {
            entry.pipWindow.close();
        } catch {
            // already gone
        }
        return true;
    }
}

const fail = (name, message) => ({ ok: false, error: { name, message } });
