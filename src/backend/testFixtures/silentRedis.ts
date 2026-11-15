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

import { createServer, type Server, type Socket } from 'node:net';

/** Split complete RESP arrays off the front of `buf`, as lowercased words. */
const takeCommands = (buf: string): { commands: string[][]; rest: string } => {
    const commands: string[][] = [];
    const pattern = /^\*(\d+)\r\n/;
    let rest = buf;
    for (;;) {
        const head = pattern.exec(rest);
        if (!head) break;
        let at = head[0].length;
        const words: string[] = [];
        for (let i = 0; i < Number(head[1]); i++) {
            const len = /^\$(\d+)\r\n/.exec(rest.slice(at));
            if (!len || rest.length < at + len[0].length + +len[1] + 2) break;
            at += len[0].length;
            words.push(rest.slice(at, at + +len[1]).toLowerCase());
            at += +len[1] + 2;
        }
        if (words.length !== Number(head[1])) break;
        commands.push(words);
        rest = rest.slice(at);
    }
    return { commands, rest };
};

const replyTo = (name: string) =>
    name === 'get' ? '$-1\r\n' : name === 'eval' ? ':1\r\n' : '+OK\r\n';

/**
 * Accepts and never replies; `clusterReady` answers only the handshake. Other
 * commands land in `seen`, and are answered in order once `answer()` is
 * called.
 */
export const startSilentRedis = async (clusterReady = false) => {
    const sockets = new Set<Socket>();
    const seen: string[] = [];
    const unanswered: Array<{ socket: Socket; name: string }> = [];
    let answering = false;
    const server: Server = createServer((socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.on('error', () => {});
        if (!clusterReady) return;
        let buf = '';
        socket.on('data', (chunk) => {
            const { commands, rest } = takeCommands(buf + chunk.toString());
            buf = rest;
            for (const [name, sub] of commands) {
                if (name === 'client') {
                    socket.write('+OK\r\n');
                } else if (name === 'cluster' && sub === 'slots') {
                    const host = '127.0.0.1';
                    socket.write(
                        `*1\r\n*3\r\n:0\r\n:16383\r\n*2\r\n` +
                            `$${host.length}\r\n${host}\r\n:${port}\r\n`,
                    );
                } else if (name === 'cluster' && sub === 'info') {
                    const info = 'cluster_state:ok\r\n';
                    socket.write(`$${info.length}\r\n${info}\r\n`);
                } else if (name === 'info') {
                    const info = 'loading:0\r\n';
                    socket.write(`$${info.length}\r\n${info}\r\n`);
                } else {
                    seen.push(name);
                    if (answering) socket.write(replyTo(name));
                    else unanswered.push({ socket, name });
                }
            }
        });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    const close = () =>
        new Promise<void>((r) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => r());
        });
    const answer = () => {
        answering = true;
        for (const { socket, name } of unanswered.splice(0)) {
            socket.write(replyTo(name));
        }
    };
    return { port, close, seen, answer };
};
