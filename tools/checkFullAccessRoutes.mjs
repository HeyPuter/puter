#!/usr/bin/env node
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

/**
 * Probe which routes a credential reaches, so the same sweep can be run against
 * a deployment before and after a gate change.
 *
 * Usage:
 *   node tools/checkFullAccessRoutes.mjs --token <jwt> \
 *     [--api https://api.puter.com] [--origin https://puter.com] [--json]
 *
 * Reads PUTER_API_ORIGIN / PUTER_ORIGIN / PUTER_TOKEN when the flags are
 * omitted. Every probe is a read or an idempotent write; nothing is deleted.
 */

import { io as ioClient } from 'socket.io-client';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
    const at = argv.indexOf(`--${name}`);
    return at === -1 ? fallback : argv[at + 1];
};

const token = flag('token', process.env.PUTER_TOKEN);
const apiOrigin = (
    flag('api', process.env.PUTER_API_ORIGIN) ?? 'https://api.puter.com'
).replace(/\/$/, '');
const origin = (
    flag('origin', process.env.PUTER_ORIGIN) ?? apiOrigin.replace('://api.', '://')
).replace(/\/$/, '');
const asJson = argv.includes('--json');

if (!token) {
    console.error(
        'Missing token. Pass --token <jwt> or set PUTER_TOKEN.\n' +
            'Mint one at Settings -> Account -> API Token, or read a session\n' +
            "token from localStorage['auth_token_v2'].",
    );
    process.exit(2);
}

/**
 * `expect` is what the credential under test should get once the change ships.
 * `was` records the behavior before it, so a run against an un-upgraded
 * deployment is still readable rather than a wall of failures.
 */
const PROBES = [
    // -- Routes a privileged app needs -------------------------------
    { group: 'app surface', method: 'GET', path: '/get-dev-profile', expect: 200, was: 403 },
    { group: 'app surface', method: 'GET', path: '/auth/list-permissions', expect: 200, was: 403 },
    { group: 'app surface', method: 'GET', path: '/share/shared-by-me', expect: 200, was: 200 },
    { group: 'app surface', method: 'GET', path: '/share/shared-by-me/apps', expect: 200, was: 403 },
    { group: 'app surface', method: 'GET', path: '/share/audit', expect: 200, was: 403 },
    { group: 'app surface', method: 'GET', path: '/profile', expect: 200, was: 200 },
    {
        group: 'app surface',
        method: 'POST',
        path: '/profile',
        // Writes the bio back as-is, read from GET /profile first.
        body: 'echo-bio',
        expect: 200,
        was: 403,
    },
    {
        group: 'app surface',
        method: 'POST',
        path: '/rao',
        body: { app_uid: flag('app-uid', 'app-0b37f054-07d4-4627-8765-11bd23e889d4') },
        expect: 200,
        was: 403,
    },

    // -- Routes the SDK uses on every launch -------------------------
    { group: 'sdk baseline', method: 'GET', path: '/whoami', expect: 200, was: 200 },
    { group: 'sdk baseline', method: 'POST', path: '/stat', body: { path: '~/' }, expect: 200, was: 200 },
    { group: 'sdk baseline', method: 'GET', path: '/apps', expect: 200, was: 200 },
    { group: 'sdk baseline', method: 'GET', path: '/cache/last-change-timestamp', expect: 200, was: 200 },

    // -- Account and security management: stays shut -----------------
    { group: 'stays shut', method: 'GET', path: '/share/blocks', expect: 403, was: 403 },
    { group: 'stays shut', method: 'GET', path: '/app-feedback/target?app=dev-center', expect: 403, was: 403 },
    { group: 'stays shut', method: 'GET', path: '/auth/list-sessions', expect: 403, was: 403 },
    {
        group: 'stays shut',
        method: 'POST',
        path: '/auth/get-user-app-token',
        body: { origin: 'https://probe.invalid' },
        expect: 403,
        was: 403,
    },
    {
        group: 'stays shut',
        method: 'POST',
        path: '/auth/grant-user-app',
        body: { app_uid: 'app-probe', permission: 'probe' },
        expect: 403,
        was: 403,
    },
];

const call = async (probe, bio) => {
    let body = probe.body;
    if (body === 'echo-bio') body = { bio };
    const res = await fetch(new URL(probe.path, apiOrigin), {
        method: probe.method,
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return res.status;
};

/** Resolves the handshake verdict without holding the connection open. */
const probeSocket = () =>
    new Promise((resolve) => {
        const socket = ioClient(origin, {
            auth: { auth_token: token },
            transports: ['websocket'],
            reconnection: false,
            timeout: 15_000,
        });
        const settle = (verdict) => {
            socket.disconnect();
            resolve(verdict);
        };
        socket.on('connect', () => settle({ ok: true, detail: 'connected' }));
        socket.on('connect_error', (err) =>
            settle({ ok: false, detail: err?.message ?? 'connect_error' }),
        );
        setTimeout(() => settle({ ok: false, detail: 'timed out' }), 20_000);
    });

const run = async () => {
    const results = [];

    // The profile write echoes the current bio back, so a sweep leaves the
    // account exactly as it found it.
    let bio = '';
    try {
        const res = await fetch(new URL('/profile', apiOrigin), {
            headers: { authorization: `Bearer ${token}` },
        });
        if (res.ok) bio = (await res.json())?.bio ?? '';
    } catch {
        // Leave it empty; the probe reports whatever status it gets.
    }

    for (const probe of PROBES) {
        let status;
        try {
            status = await call(probe, bio);
        } catch (err) {
            status = `ERR ${err?.message ?? err}`;
        }
        results.push({
            ...probe,
            status,
            pass: status === probe.expect,
            unchanged: status === probe.was && probe.was !== probe.expect,
        });
    }

    const socket = await probeSocket();
    results.push({
        group: 'app surface',
        method: 'WS',
        path: '/socket.io',
        expect: 200,
        was: 403,
        status: socket.ok ? 200 : 403,
        detail: socket.detail,
        pass: socket.ok,
        unchanged: !socket.ok,
    });

    if (asJson) {
        console.log(JSON.stringify({ apiOrigin, origin, results }, null, 2));
    } else {
        console.log(`api=${apiOrigin}  gui=${origin}\n`);
        let group = '';
        for (const r of results) {
            if (r.group !== group) {
                group = r.group;
                console.log(`-- ${group} --`);
            }
            const mark = r.pass ? 'PASS' : r.unchanged ? 'OLD ' : 'FAIL';
            const want = r.pass ? '' : `  (want ${r.expect})`;
            const note = r.detail ? `  ${r.detail}` : '';
            console.log(
                `  ${mark}  ${String(r.method).padEnd(5)} ${r.path.padEnd(42)} ${r.status}${want}${note}`,
            );
        }
        const failed = results.filter((r) => !r.pass);
        const old = failed.filter((r) => r.unchanged);
        console.log(
            `\n${results.length - failed.length}/${results.length} as expected` +
                (old.length ? `; ${old.length} still on the old behavior` : '') +
                (failed.length - old.length
                    ? `; ${failed.length - old.length} unexplained`
                    : ''),
        );
    }

    process.exit(results.some((r) => !r.pass && !r.unchanged) ? 1 : 0);
};

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
