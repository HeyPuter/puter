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

const FIRST_DELAY_MS = 1000;
const MAX_DELAY_MS = 60_000;

/**
 * Reopens `socket` after the server closed it, which socket.io never does on
 * its own. The handshake re-authenticates with the current token, so a revoked
 * session is refused there. Reconnects back off while the server keeps
 * closing fresh connections.
 * @param {import('socket.io-client').Socket} socket
 * @param {() => string} currentToken
 */
export const reconnectAfterServerDisconnect = (socket, currentToken) => {
    let delay = FIRST_DELAY_MS;
    let connectedAt = 0;
    socket.on('connect', () => {
        connectedAt = Date.now();
    });
    socket.on('disconnect', (reason) => {
        if ( reason !== 'io server disconnect' ) return;
        if ( Date.now() - connectedAt > MAX_DELAY_MS ) delay = FIRST_DELAY_MS;
        setTimeout(() => {
            if ( socket.connected ) return;
            socket.auth = { ...socket.auth, auth_token: currentToken() };
            socket.connect();
        }, delay);
        delay = Math.min(delay * 2, MAX_DELAY_MS);
    });
};
