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

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const SOCKET_NAME = 'dev.sock';
const WELCOME = [
    'Puter dev socket – enter a command (e.g. help) and press Enter.',
    'Close the connection with Ctrl+C or by typing exit.',
    '',
].join('\n');

function getSocketDir () {
    if ( process.env.PUTER_DEV_SOCKET_DIR ) {
        return process.env.PUTER_DEV_SOCKET_DIR;
    }
    const volatileRuntime = path.join(process.cwd(), 'volatile', 'runtime');
    if ( fs.existsSync(volatileRuntime) ) {
        return volatileRuntime;
    }
    return process.cwd();
}

extension.on('init', async () => {
    if ( process.env.DEVCONSOLE !== '1' ) {
        return;
    }

    const commands = extension.import('service:commands');
    const socketDir = getSocketDir();
    const socketPath = path.join(socketDir, SOCKET_NAME);

    try {
        if ( fs.existsSync(socketPath) ) {
            fs.unlinkSync(socketPath);
        }
        fs.mkdirSync(socketDir, { recursive: true });
    } catch ( err ) {
        console.warn('dev-socket: could not prepare socket path', socketPath, err.message);
        return;
    }

    const server = net.createServer((socket) => {
        socket.setEncoding('utf8');
        socket.write(`${WELCOME }\n> `);
        let buffer = '';
        socket.on('data', (chunk) => {
            buffer += chunk;
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? '';
            for ( const line of lines ) {
                const trimmed = line.trim();
                if ( trimmed === '' ) continue;
                if ( trimmed.toLowerCase() === 'exit' ) {
                    socket.end();
                    return;
                }
                const log = {
                    log: (msg) => {
                        socket.write(`${String(msg) }\n`);
                    },
                    error: (msg) => {
                        socket.write(`${String(msg) }\n`);
                    },
                };
                commands.executeRawCommand(trimmed, log).then(() => {
                    socket.write('> ');
                }).catch((err) => {
                    log.error(err?.message ?? err);
                    socket.write('> ');
                });
            }
        });
        socket.on('end', () => {
        });
        socket.on('error', () => {
        });
    });

    server.listen(socketPath, () => {
        console.log('dev-socket: socket listening at', socketPath);
    });
    server.on('error', (err) => {
        console.warn('dev-socket: socket error', err.message);
    });
});
