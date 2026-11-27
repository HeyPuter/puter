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

import {
    createServer as createHttpServer,
    type IncomingMessage,
    type ServerResponse,
} from 'node:http';
import {
    createServer as createHttp2Server,
    type IncomingHttpHeaders,
    type ServerHttp2Stream,
} from 'node:http2';
import type { AddressInfo, Server, Socket } from 'node:net';

/**
 * A local stand-in for a vendor API. It takes every request and writes nothing
 * back until a test scripts an answer.
 */
export interface ScriptedUpstream<Handler> {
    url: string;
    /** How requests arriving from here on are answered. */
    answer(handler: Handler): void;
    /** Requests received so far. */
    requests(): number;
    /** Requests the client closed before the upstream ended its answer. */
    abandoned(): number;
    /** Stops listening and drops the connections still open. */
    close(): Promise<void>;
}

export type HttpAnswer = (req: IncomingMessage, res: ServerResponse) => void;
export type Http2Answer = (
    stream: ServerHttp2Stream,
    headers: IncomingHttpHeaders,
) => void;

const listen = async (server: Server) => {
    const sockets = new Set<Socket>();
    server.on('connection', (socket: Socket) => {
        sockets.add(socket);
        socket.on('error', () => {});
        socket.once('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
    );
    return {
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        close: () =>
            new Promise<void>((resolve) => {
                for (const socket of sockets) socket.destroy();
                server.close(() => resolve());
            }),
    };
};

/** An HTTP/1.1 upstream. Unscripted, it reads each request and never answers. */
export const scriptedHttpUpstream = async (): Promise<
    ScriptedUpstream<HttpAnswer>
> => {
    let handler: HttpAnswer = (req) => req.resume();
    let requests = 0;
    let abandoned = 0;
    const server = createHttpServer((req, res) => {
        requests += 1;
        res.once('close', () => {
            if (!res.writableEnded) abandoned += 1;
        });
        handler(req, res);
    });
    return {
        ...(await listen(server)),
        answer: (next) => {
            handler = next;
        },
        requests: () => requests,
        abandoned: () => abandoned,
    };
};

/**
 * The same over cleartext HTTP/2, which is what an SDK client on the HTTP/2
 * handler speaks to an `http://` endpoint.
 */
export const scriptedHttp2Upstream = async (): Promise<
    ScriptedUpstream<Http2Answer>
> => {
    let handler: Http2Answer = () => {};
    let requests = 0;
    let abandoned = 0;
    const server = createHttp2Server();
    server.on('stream', (stream, headers) => {
        requests += 1;
        stream.on('error', () => {});
        // A reset ends the writable side too, so `writableEnded` can't tell.
        stream.once('aborted', () => {
            abandoned += 1;
        });
        handler(stream, headers);
    });
    return {
        ...(await listen(server)),
        answer: (next) => {
            handler = next;
        },
        requests: () => requests,
        abandoned: () => abandoned,
    };
};
