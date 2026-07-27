import { describe, expect, it } from 'vitest';
import {
    APP_URL_PARAMS_MAX_COUNT,
    APP_URL_PARAMS_MAX_LENGTH,
    serializeAppURLParams,
} from './appURLParams.js';

// The URL an app's params end up on. The path is built by the caller from
// the app's own name, never from app input — these tests assert that app
// input cannot reach outside the query string it is given.
const urlFor = (query) => new URL(`/app/my-app${query ? `?${query}` : ''}`, 'https://puter.com');

describe('serializeAppURLParams', () => {
    it('serializes plain scalars', () => {
        const result = serializeAppURLParams({ doc: 'readme', line: 10, draft: true });
        expect(result.query).toBe('doc=readme&line=10&draft=true');
    });

    it('treats no params as clearing the query string', () => {
        expect(serializeAppURLParams({}).query).toBe('');
    });

    describe('cannot escape the query string', () => {
        // Each of these tries to reach the path, the fragment, or a second
        // parameter. Percent-encoding must keep them inside one value.
        const escapes = {
            'a fragment': { a: 'x#/app/bank' },
            'a path traversal': { a: '../../app/bank' },
            'a smuggled parameter': { a: 'x&auth_token=stolen' },
            'a smuggled key=value': { a: 'x=y&user=admin' },
            'CRLF': { a: 'x\r\nSet-Cookie: b=c' },
            'a separator in the key': { 'a&auth_token': 'v' },
            'a slash in the key': { 'a/../b': 'v' },
            'a backslash': { a: 'x\\..\\bank' },
        };

        for ( const [name, params] of Object.entries(escapes) ) {
            it(`contains ${name}`, () => {
                const { query } = serializeAppURLParams(params);
                const url = urlFor(query);
                expect(url.pathname).toBe('/app/my-app');
                expect(url.hash).toBe('');
                expect([...url.searchParams.keys()]).toHaveLength(1);
                expect(url.searchParams.has('auth_token')).toBe(false);
                expect(url.searchParams.has('user')).toBe(false);
            });
        }
    });

    describe('reserved names', () => {
        // Names Puter interprets on a landing. An app that could set these
        // would turn its own shareable link into a session-fixation or
        // boot-breaking link.
        const reserved = [
            'auth_token', 'token', 'user', 'api_origin', 'action', 'app',
            'path', 'c', 'readURL', 'redirectURL', 'msg_id', 'origin',
            'signin_session', 'opener_origin', 'download', 'maximized',
            'options', 'permission', 'request_auth',
            // Read outside `url_query_params`, so easy to miss: the first
            // is parsed straight off location.search during boot-mode
            // selection, the second is read by the backend that renders
            // the page.
            'embedded_in_popup', 'error_from_within_iframe',
        ];

        for ( const key of reserved ) {
            it(`rejects "${key}"`, () => {
                expect(serializeAppURLParams({ [key]: 'v' })).toMatchObject({ code: 'param_reserved' });
            });
        }

        for ( const key of ['puter.app_instance_id', 'puter.args', 'puter.auth.token'] ) {
            it(`rejects the launch-protocol param "${key}"`, () => {
                expect(serializeAppURLParams({ [key]: 'v' })).toMatchObject({ code: 'param_reserved' });
            });
        }

        it('allows posargs, which only feeds the same app its own arguments', () => {
            const { query } = serializeAppURLParams({ posargs: JSON.stringify(['a', 'b']) });
            expect(JSON.parse(urlFor(query).searchParams.get('posargs'))).toEqual(['a', 'b']);
        });
    });

    describe('limits', () => {
        const manyParams = (n) => Object.fromEntries(
            Array.from({ length: n }, (_, i) => [`k${i}`, 'v']),
        );

        it('accepts the maximum number of params', () => {
            expect(serializeAppURLParams(manyParams(APP_URL_PARAMS_MAX_COUNT)).query).toBeDefined();
        });

        it('rejects one param too many', () => {
            expect(serializeAppURLParams(manyParams(APP_URL_PARAMS_MAX_COUNT + 1)))
                .toMatchObject({ code: 'params_too_many' });
        });

        it('rejects an over-long query string', () => {
            expect(serializeAppURLParams({ a: 'x'.repeat(APP_URL_PARAMS_MAX_LENGTH + 1) }))
                .toMatchObject({ code: 'params_too_long' });
        });
    });

    describe('rejects malformed input', () => {
        it.each([
            ['an array', ['a']],
            ['null', null],
            ['a string', 'a=b'],
            ['a number', 5],
        ])('%s', (_name, input) => {
            expect(serializeAppURLParams(input)).toMatchObject({ code: 'params_invalid' });
        });

        it('an empty key', () => {
            expect(serializeAppURLParams({ '': 'v' })).toMatchObject({ code: 'params_invalid' });
        });

        it.each([
            ['an object value', { a: { b: 1 } }],
            ['an array value', { a: [1] }],
            ['a null value', { a: null }],
        ])('%s', (_name, input) => {
            expect(serializeAppURLParams(input)).toMatchObject({ code: 'value_invalid' });
        });
    });

    it('does not pollute Object.prototype', () => {
        serializeAppURLParams(JSON.parse('{"__proto__": "x"}'));
        expect({}.polluted).toBeUndefined();
        expect(Object.prototype.polluted).toBeUndefined();
    });
});
