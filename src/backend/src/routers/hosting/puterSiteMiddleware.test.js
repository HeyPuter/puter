/*
 * Copyright (C) 2026-present Puter Technologies Inc.
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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { puterSiteMiddleware } from './puterSiteMiddleware';
import config from '../../config.js';
import { Context } from '../../util/context.js';

// Mocks to test middleware logic with minimal integration complexity
// (I added region markers, so this can be collapsed for readability)

// #region: mocks
let getUserMockImpl = async () => null;
let getAppMockImpl = async () => null;

vi.mock('../../config.js', () => ({
    default: {
        static_hosting_domain: 'site.puter.localhost',
        static_hosting_base_domain_redirect: 'https://developer.puter.com/static-hosting/',
        private_app_hosting_domain: 'puter.dev',
        private_app_hosting_domain_alt: 'puter.dev',
        enable_private_app_access_gate: true,
        origin: 'https://puter.com',
        cookie_name: 'puter.session.token',
        username_regex: /^[a-z0-9_]+$/,
    },
    static_hosting_domain: 'site.puter.localhost',
    static_hosting_base_domain_redirect: 'https://developer.puter.com/static-hosting/',
    private_app_hosting_domain: 'puter.dev',
    private_app_hosting_domain_alt: 'puter.dev',
    enable_private_app_access_gate: true,
    origin: 'https://puter.com',
    cookie_name: 'puter.session.token',
    username_regex: /^[a-z0-9_]+$/,
}));

vi.mock('../../modules/web/lib/api_error_handler.js', () => ({
    default: vi.fn(),
}));

vi.mock('../../helpers.js', () => ({
    get_user: vi.fn((...args) => getUserMockImpl(...args)),
    get_app: vi.fn((...args) => getAppMockImpl(...args)),
}));

vi.mock('../../util/context.js', () => ({
    Context: {
        get: vi.fn(),
        set: vi.fn(),
    },
}));

// Mock Context to allow arun passthrough
const mockContextInstance = {
    get: vi.fn(),
    arun: vi.fn().mockImplementation(async (fn) => await fn()),
};

vi.mock('../../filesystem/node/selectors.js', () => ({
    default: {
        NodeInternalIDSelector: class {
        },
        NodePathSelector: class {
        },
    },
    NodeInternalIDSelector: class {
    },
    NodePathSelector: class {
    },
}));

vi.mock('../../filesystem/FSNodeContext.js', () => ({
    default: {
        TYPE_DIRECTORY: 'directory',
    },
    TYPE_DIRECTORY: 'directory',
}));

vi.mock('../../filesystem/ll_operations/ll_read.js', () => ({
    default: {
        LLRead: class {
        },
    },
    LLRead: class {
    },
}));

vi.mock('../../services/auth/Actor.js', () => {
    const adapt = vi.fn();
    const create = vi.fn();
    class UserActorType {
        constructor ({ user, session, hasHttpOnlyCookie } = {}) {
            this.user = user;
            this.session = session;
            this.hasHttpOnlyCookie = hasHttpOnlyCookie;
        }
    }
    class SiteActorType {
    }
    class Actor {
        constructor ({ user_uid, app_uid, type } = {}) {
            this.user_uid = user_uid;
            this.app_uid = app_uid;
            this.type = type;
        }

        get_related_actor (actorType) {
            if ( this.type instanceof actorType ) {
                return this;
            }
            throw new Error('related_actor_not_found');
        }
    }
    Actor.adapt = adapt;
    Actor.create = create;
    return {
        Actor,
        UserActorType,
        SiteActorType,
    };
});

vi.mock('../../api/APIError.js', () => ({
    default: class APIError {
        static create () {
            return new this();
        }
    },
}));

vi.mock('../../services/auth/permissionUtils.mjs', () => ({
    PermissionUtil: {
        reading_to_options: vi.fn().mockReturnValue([]),
    },
}));

vi.mock('dedent', () => ({
    default: (str) => str,
}));
// #endregion

// Now import the module under test - this will use our mocks
describe('PuterSiteMiddleware', () => {
    describe('base domain redirect', () => {
        let capturedMiddleware;

        beforeEach(() => {
            vi.clearAllMocks();
            config.enable_private_app_access_gate = true;
            config.private_app_hosting_domain = 'puter.dev';
            config.private_app_hosting_domain_alt = 'puter.dev';
            Context.get = vi.fn().mockImplementation((key) => {
                if ( key === 'actor' ) return undefined;
                return mockContextInstance;
            });
            Context.set = vi.fn();
            getUserMockImpl = async () => null;
            getAppMockImpl = async () => null;
            capturedMiddleware = puterSiteMiddleware;
        });

        /**
         * Creates a mock request for static hosting domain
         */
        const createMockRequest = (subdomain) => {
            const hostname = subdomain
                ? `${subdomain}.${config.static_hosting_domain}`
                : config.static_hosting_domain;

            return {
                hostname,
                subdomains: subdomain ? [subdomain] : [],
                is_custom_domain: false,
                baseUrl: '',
                path: '/',
                ctx: mockContextInstance,
            };
        };

        it('should redirect to info page when subdomain is empty (bare domain)', async () => {
            const mockReq = createMockRequest('');
            const mockRes = {
                redirect: vi.fn(),
                setHeader: vi.fn(),
            };
            const mockNext = vi.fn();

            await capturedMiddleware(mockReq, mockRes, mockNext);

            expect(mockRes.redirect).toHaveBeenCalledWith('https://developer.puter.com/static-hosting/');
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('should redirect to info page when subdomain is www', async () => {
            const mockReq = createMockRequest('www');
            const mockRes = {
                redirect: vi.fn(),
                setHeader: vi.fn(),
            };
            const mockNext = vi.fn();

            await capturedMiddleware(mockReq, mockRes, mockNext);

            expect(mockRes.redirect).toHaveBeenCalledWith('https://developer.puter.com/static-hosting/');
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('should NOT redirect when subdomain is a valid site name', async () => {
            // Setup mock services for the "site not found" path
            const mockServices = {
                get: vi.fn().mockImplementation((svc) => {
                    if ( svc === 'puter-site' ) {
                        return {
                            get_subdomain: vi.fn().mockResolvedValue(null),
                        };
                    }
                    if ( svc === 'filesystem' ) {
                        return {
                            node: vi.fn().mockResolvedValue({
                                exists: vi.fn().mockResolvedValue(false),
                            }),
                        };
                    }
                    return {};
                }),
            };

            mockContextInstance.get.mockImplementation((key) => {
                if ( key === 'services' ) return mockServices;
                return null;
            });

            const mockReq = createMockRequest('mysite');
            const mockRes = {
                redirect: vi.fn(),
                setHeader: vi.fn(),
                status: vi.fn().mockReturnThis(),
                send: vi.fn(),
            };
            const mockNext = vi.fn();

            // The middleware will error out further down (due to incomplete mocks)
            // but the important thing is: did it try to redirect to the info page?
            try {
                await capturedMiddleware(mockReq, mockRes, mockNext);
            } catch (e) {
                // Expected - incomplete mocks cause errors after the redirect check
            }

            // The key assertion: it should NOT have redirected to the info page
            // because 'mysite' is a valid subdomain, not '' or 'www'
            expect(mockRes.redirect).not.toHaveBeenCalledWith('https://developer.puter.com/static-hosting/');
        });

        it('should use exactly the URL from config (not hardcoded)', async () => {
            // This test verifies the middleware reads from config.static_hosting_base_domain_redirect
            // If someone hardcodes a different URL, this assertion will catch that the
            // redirect URL matches what is in the mocked config.
            const mockReq = createMockRequest('');
            const mockRes = {
                redirect: vi.fn(),
                setHeader: vi.fn(),
            };
            const mockNext = vi.fn();

            await capturedMiddleware(mockReq, mockRes, mockNext);

            // Verify it uses the exact URL from the mocked config
            expect(mockRes.redirect).toHaveBeenCalledWith(config.static_hosting_base_domain_redirect);
        });
    });

    describe('private app access gate', () => {
        let capturedMiddleware;

        beforeEach(() => {
            vi.clearAllMocks();
            config.enable_private_app_access_gate = true;
            Context.get = vi.fn().mockImplementation((key) => {
                if ( key === 'actor' ) return undefined;
                return mockContextInstance;
            });
            Context.set = vi.fn();
            getUserMockImpl = async () => null;
            getAppMockImpl = async () => null;
            capturedMiddleware = puterSiteMiddleware;
        });

        it('redirects private app assets to puter.dev host even before index_url migration', async () => {
            const mockServices = {
                get: vi.fn().mockImplementation((serviceName) => {
                    if ( serviceName === 'puter-site' ) {
                        return {
                            get_subdomain: vi.fn().mockResolvedValue({
                                user_id: 101,
                                associated_app_id: 202,
                                root_dir_id: null,
                            }),
                        };
                    }
                    return {};
                }),
            };
            mockContextInstance.get.mockImplementation((key) => {
                if ( key === 'services' ) return mockServices;
                return null;
            });
            getUserMockImpl = async () => ({ id: 101, suspended: false });
            getAppMockImpl = async () => ({
                uid: 'app-11111111-1111-1111-1111-111111111111',
                name: 'paid-app',
                is_private: 1,
                index_url: 'https://paid.site.puter.localhost/',
            });

            const mockReq = {
                hostname: 'paid.site.puter.localhost',
                subdomains: ['paid'],
                is_custom_domain: false,
                baseUrl: '',
                path: '/asset.js',
                originalUrl: '/asset.js?foo=1',
                query: {},
                cookies: {},
                headers: {},
                ctx: mockContextInstance,
            };
            const mockRes = {
                redirect: vi.fn(),
                setHeader: vi.fn(),
                status: vi.fn().mockReturnThis(),
                send: vi.fn(),
            };
            const mockNext = vi.fn();

            await capturedMiddleware(mockReq, mockRes, mockNext);

            expect(mockRes.redirect).toHaveBeenCalledWith('https://paid.puter.dev/asset.js?foo=1');
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('accepts private app host matching the configured alt private domain', async () => {
            config.private_app_hosting_domain = 'app.puter.localhost:4100';
            config.private_app_hosting_domain_alt = 'puter.dev';

            const authService = {
                getPrivateAssetCookieName: vi.fn().mockReturnValue('puter.private.asset.token'),
                verifyPrivateAssetToken: vi.fn().mockImplementation(() => {
                    throw new Error('invalid');
                }),
                authenticate_from_token: vi.fn().mockImplementation(() => {
                    throw new Error('invalid');
                }),
                createPrivateAssetToken: vi.fn().mockReturnValue('private-token'),
                getPrivateAssetCookieOptions: vi.fn().mockReturnValue({}),
            };
            const mockServices = {
                get: vi.fn().mockImplementation((serviceName) => {
                    if ( serviceName === 'puter-site' ) {
                        return {
                            get_subdomain: vi.fn().mockResolvedValue({
                                user_id: 101,
                                associated_app_id: 202,
                                root_dir_id: 303,
                            }),
                        };
                    }
                    if ( serviceName === 'filesystem' ) {
                        return {
                            node: vi.fn().mockResolvedValue({
                                exists: vi.fn().mockResolvedValue(true),
                                get: vi.fn().mockImplementation(async (fieldName) => {
                                    if ( fieldName === 'type' ) return 'directory';
                                    if ( fieldName === 'path' ) return '/alice/Public';
                                    return null;
                                }),
                            }),
                        };
                    }
                    if ( serviceName === 'acl' ) {
                        return {
                            check: vi.fn().mockResolvedValue(true),
                        };
                    }
                    if ( serviceName === 'auth' ) return authService;
                    return {};
                }),
            };
            mockContextInstance.get.mockImplementation((key) => {
                if ( key === 'services' ) return mockServices;
                return null;
            });
            getUserMockImpl = async () => ({ id: 101, suspended: false });
            getAppMockImpl = async () => ({
                uid: 'app-11111111-1111-1111-1111-111111111111',
                name: 'paid-app',
                is_private: 1,
                index_url: 'https://paid.puter.dev/',
            });

            const mockReq = {
                hostname: 'paid.puter.dev',
                subdomains: ['paid'],
                is_custom_domain: false,
                baseUrl: '',
                path: '/index.html',
                originalUrl: '/index.html',
                query: {},
                cookies: {},
                headers: {},
                ctx: mockContextInstance,
            };
            const mockRes = {
                redirect: vi.fn(),
                set: vi.fn().mockReturnThis(),
                setHeader: vi.fn(),
                status: vi.fn().mockReturnThis(),
                send: vi.fn(),
            };
            const mockNext = vi.fn();

            await capturedMiddleware(mockReq, mockRes, mockNext);

            expect(mockRes.redirect).not.toHaveBeenCalledWith(
                expect.stringContaining('app.puter.localhost:4100'),
            );
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.send).toHaveBeenCalledWith(expect.stringContaining('Sign in required'));
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('serves login bootstrap html when private app identity is missing', async () => {
            const eventEmit = vi.fn().mockImplementation(async (_eventName, event) => {
                event.result.allowed = false;
                event.result.redirectUrl = 'https://puter.com/app/app-center/?item=app-11111111-1111-1111-1111-111111111111';
            });
            const dbRead = vi.fn().mockResolvedValue([
                {
                    uid: 'app-11111111-1111-1111-1111-111111111111',
                    name: 'paid-app',
                    is_private: 1,
                    index_url: 'https://paid.puter.dev/',
                    owner_user_id: 101,
                },
            ]);
            const authService = {
                getPrivateAssetCookieName: vi.fn().mockReturnValue('puter.private.asset.token'),
                verifyPrivateAssetToken: vi.fn().mockImplementation(() => {
                    throw new Error('invalid');
                }),
                authenticate_from_token: vi.fn().mockImplementation(() => {
                    throw new Error('invalid');
                }),
                createPrivateAssetToken: vi.fn().mockReturnValue('private-token'),
                getPrivateAssetCookieOptions: vi.fn().mockReturnValue({}),
            };
            const mockServices = {
                get: vi.fn().mockImplementation((serviceName) => {
                    if ( serviceName === 'puter-site' ) {
                        return {
                            get_subdomain: vi.fn().mockResolvedValue({
                                user_id: 101,
                                associated_app_id: null,
                                root_dir_id: 303,
                            }),
                        };
                    }
                    if ( serviceName === 'filesystem' ) {
                        return {
                            node: vi.fn().mockResolvedValue({
                                exists: vi.fn().mockResolvedValue(true),
                                get: vi.fn().mockImplementation(async (fieldName) => {
                                    if ( fieldName === 'type' ) return 'directory';
                                    if ( fieldName === 'path' ) return '/alice/Public';
                                    return null;
                                }),
                            }),
                        };
                    }
                    if ( serviceName === 'acl' ) {
                        return {
                            check: vi.fn().mockResolvedValue(true),
                        };
                    }
                    if ( serviceName === 'database' ) {
                        return {
                            get: vi.fn().mockReturnValue({
                                read: dbRead,
                            }),
                        };
                    }
                    if ( serviceName === 'event' ) return { emit: eventEmit };
                    if ( serviceName === 'auth' ) return authService;
                    return {};
                }),
            };
            mockContextInstance.get.mockImplementation((key) => {
                if ( key === 'services' ) return mockServices;
                return null;
            });
            getUserMockImpl = async () => ({ id: 101, suspended: false });
            getAppMockImpl = async () => ({
                uid: 'app-11111111-1111-1111-1111-111111111111',
                name: 'paid-app',
                is_private: 1,
                index_url: 'https://paid.puter.dev/',
            });

            const mockReq = {
                hostname: 'paid.puter.dev',
                subdomains: [],
                is_custom_domain: false,
                baseUrl: '',
                path: '/index.html',
                originalUrl: '/index.html',
                cookies: {},
                headers: {},
                query: {},
                ctx: mockContextInstance,
            };
            const mockRes = {
                redirect: vi.fn(),
                cookie: vi.fn(),
                set: vi.fn().mockReturnThis(),
                setHeader: vi.fn(),
                status: vi.fn().mockReturnThis(),
                send: vi.fn(),
            };
            const mockNext = vi.fn();

            await capturedMiddleware(mockReq, mockRes, mockNext);

            expect(eventEmit).not.toHaveBeenCalled();
            expect(dbRead).toHaveBeenCalledWith(
                expect.stringContaining('index_url IN'),
                expect.arrayContaining([
                    101,
                    'https://paid.puter.dev',
                    'https://paid.puter.dev/',
                    'https://paid.puter.dev/index.html',
                    'https://paid.site.puter.localhost',
                    'https://paid.site.puter.localhost/',
                    'https://paid.site.puter.localhost/index.html',
                ]),
            );
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.send).toHaveBeenCalledWith(expect.stringContaining('https://js.puter.com/v2/'));
            expect(mockRes.send).toHaveBeenCalledWith(expect.stringContaining('puter.auth.signIn()'));
            expect(mockRes.send).toHaveBeenCalledWith(expect.stringContaining('localStorage.getItem(\'auth_token\')'));
            expect(mockRes.send).toHaveBeenCalledWith(expect.stringContaining('tryStoredTokenBootstrap'));
            expect(mockRes.set).toHaveBeenCalledWith('Referrer-Policy', 'no-referrer');
            expect(mockRes.redirect).not.toHaveBeenCalled();
            expect(mockRes.cookie).not.toHaveBeenCalled();
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('does not redirect private root requests to puter.com app route before access bootstrap', async () => {
            const eventEmit = vi.fn().mockImplementation(async (_eventName, event) => {
                event.result.allowed = false;
                event.result.redirectUrl = 'https://puter.com/app/app-center/?item=app-11111111-1111-1111-1111-111111111111';
            });
            const authService = {
                getPrivateAssetCookieName: vi.fn().mockReturnValue('puter.private.asset.token'),
                verifyPrivateAssetToken: vi.fn().mockImplementation(() => {
                    throw new Error('invalid');
                }),
                authenticate_from_token: vi.fn().mockImplementation(() => {
                    throw new Error('invalid');
                }),
                createPrivateAssetToken: vi.fn().mockReturnValue('private-token'),
                getPrivateAssetCookieOptions: vi.fn().mockReturnValue({}),
            };
            const mockServices = {
                get: vi.fn().mockImplementation((serviceName) => {
                    if ( serviceName === 'puter-site' ) {
                        return {
                            get_subdomain: vi.fn().mockResolvedValue({
                                user_id: 101,
                                associated_app_id: 202,
                                root_dir_id: 303,
                            }),
                        };
                    }
                    if ( serviceName === 'filesystem' ) {
                        return {
                            node: vi.fn().mockResolvedValue({
                                exists: vi.fn().mockResolvedValue(true),
                                get: vi.fn().mockImplementation(async (fieldName) => {
                                    if ( fieldName === 'type' ) return 'directory';
                                    if ( fieldName === 'path' ) return '/alice/Public';
                                    return null;
                                }),
                            }),
                        };
                    }
                    if ( serviceName === 'acl' ) {
                        return {
                            check: vi.fn().mockResolvedValue(true),
                        };
                    }
                    if ( serviceName === 'event' ) return { emit: eventEmit };
                    if ( serviceName === 'auth' ) return authService;
                    return {};
                }),
            };
            mockContextInstance.get.mockImplementation((key) => {
                if ( key === 'services' ) return mockServices;
                return null;
            });
            getUserMockImpl = async () => ({ id: 101, suspended: false });
            getAppMockImpl = async () => ({
                uid: 'app-11111111-1111-1111-1111-111111111111',
                name: 'paid-app',
                is_private: 1,
                index_url: 'https://paid.site.puter.localhost/',
            });

            const mockReq = {
                hostname: 'paid.puter.dev',
                subdomains: [],
                is_custom_domain: false,
                baseUrl: '',
                path: '/',
                originalUrl: '/?puter.auth.token=abc',
                cookies: {},
                headers: {},
                query: {
                    'puter.auth.token': 'abc',
                },
                ctx: mockContextInstance,
            };
            const mockRes = {
                redirect: vi.fn(),
                cookie: vi.fn(),
                set: vi.fn().mockReturnThis(),
                setHeader: vi.fn(),
                status: vi.fn().mockReturnThis(),
                send: vi.fn(),
            };
            const mockNext = vi.fn();

            await capturedMiddleware(mockReq, mockRes, mockNext);

            expect(mockRes.redirect).not.toHaveBeenCalledWith('https://puter.com/app/paid-app/');
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.send).toHaveBeenCalledWith(expect.stringContaining('https://js.puter.com/v2/'));
            expect(mockRes.send).toHaveBeenCalledWith(expect.stringContaining('puter.auth.signIn()'));
            expect(mockRes.send).toHaveBeenCalledWith(expect.stringContaining('meta property="og:title"'));
            expect(mockRes.send).toHaveBeenCalledWith(expect.stringContaining('/app/paid-app/'));
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('denies private app access and redirects using entitlement response', async () => {
            const eventEmit = vi.fn().mockImplementation(async (_eventName, event) => {
                event.result.allowed = false;
                event.result.redirectUrl = 'https://puter.com/app/app-center/?item=app-11111111-1111-1111-1111-111111111111';
            });
            const authService = {
                getPrivateAssetCookieName: vi.fn().mockReturnValue('puter.private.asset.token'),
                app_uid_from_origin: vi.fn().mockResolvedValue('app-origin-111'),
                verifyPrivateAssetToken: vi.fn().mockImplementation(() => {
                    throw new Error('invalid');
                }),
                authenticate_from_token: vi.fn().mockResolvedValue({
                    type: {},
                    get_related_actor: vi.fn().mockReturnValue({
                        type: {
                            user: { uuid: 'user-111' },
                            session: 'session-111',
                        },
                    }),
                }),
                createPrivateAssetToken: vi.fn().mockReturnValue('private-token'),
                getPrivateAssetCookieOptions: vi.fn().mockReturnValue({}),
            };
            const mockServices = {
                get: vi.fn().mockImplementation((serviceName) => {
                    if ( serviceName === 'puter-site' ) {
                        return {
                            get_subdomain: vi.fn().mockResolvedValue({
                                user_id: 101,
                                associated_app_id: 202,
                                root_dir_id: 303,
                            }),
                        };
                    }
                    if ( serviceName === 'filesystem' ) {
                        return {
                            node: vi.fn().mockResolvedValue({
                                exists: vi.fn().mockResolvedValue(true),
                                get: vi.fn().mockImplementation(async (fieldName) => {
                                    if ( fieldName === 'type' ) return 'directory';
                                    if ( fieldName === 'path' ) return '/alice/Public';
                                    return null;
                                }),
                            }),
                        };
                    }
                    if ( serviceName === 'acl' ) {
                        return {
                            check: vi.fn().mockResolvedValue(true),
                        };
                    }
                    if ( serviceName === 'event' ) return { emit: eventEmit };
                    if ( serviceName === 'auth' ) return authService;
                    return {};
                }),
            };
            mockContextInstance.get.mockImplementation((key) => {
                if ( key === 'services' ) return mockServices;
                return null;
            });
            getUserMockImpl = async () => ({ id: 101, suspended: false });
            getAppMockImpl = async () => ({
                uid: 'app-11111111-1111-1111-1111-111111111111',
                name: 'paid-app',
                is_private: 1,
                index_url: 'https://paid.puter.dev/',
            });

            const mockReq = {
                hostname: 'paid.puter.dev',
                subdomains: [],
                is_custom_domain: false,
                baseUrl: '',
                path: '/index.html',
                originalUrl: '/index.html',
                cookies: {
                    'puter.session.token': 'session-token',
                },
                headers: {},
                query: {},
                ctx: mockContextInstance,
            };
            const mockRes = {
                redirect: vi.fn(),
                cookie: vi.fn(),
                setHeader: vi.fn(),
                status: vi.fn().mockReturnThis(),
                send: vi.fn(),
            };
            const mockNext = vi.fn();

            await capturedMiddleware(mockReq, mockRes, mockNext);

            expect(eventEmit).toHaveBeenCalledWith(
                'app.privateAccess.check',
                expect.objectContaining({
                    appUid: 'app-11111111-1111-1111-1111-111111111111',
                    userUid: 'user-111',
                }),
            );
            expect(mockRes.redirect).toHaveBeenCalledWith('https://puter.com/app/app-center/?item=app-11111111-1111-1111-1111-111111111111');
            expect(mockRes.cookie).not.toHaveBeenCalled();
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('uses bootstrap fallback identity when strict bootstrap auth fails', async () => {
            const eventEmit = vi.fn().mockImplementation(async (_eventName, event) => {
                event.result.allowed = false;
                event.result.redirectUrl = 'https://apps.puter.com/app/paid-app';
            });
            const authService = {
                getPrivateAssetCookieName: vi.fn().mockReturnValue('puter.private.asset.token'),
                verifyPrivateAssetToken: vi.fn().mockImplementation(() => {
                    throw new Error('invalid');
                }),
                authenticate_from_token: vi.fn().mockImplementation(() => {
                    throw new Error('token_auth_failed');
                }),
                resolvePrivateBootstrapIdentityFromToken: vi.fn().mockResolvedValue({
                    userUid: 'user-111',
                    sessionUuid: 'session-111',
                }),
                createPrivateAssetToken: vi.fn().mockReturnValue('private-token'),
                getPrivateAssetCookieOptions: vi.fn().mockReturnValue({}),
            };
            const mockServices = {
                get: vi.fn().mockImplementation((serviceName) => {
                    if ( serviceName === 'puter-site' ) {
                        return {
                            get_subdomain: vi.fn().mockResolvedValue({
                                user_id: 101,
                                associated_app_id: 202,
                                root_dir_id: 303,
                            }),
                        };
                    }
                    if ( serviceName === 'filesystem' ) {
                        return {
                            node: vi.fn().mockResolvedValue({
                                exists: vi.fn().mockResolvedValue(true),
                                get: vi.fn().mockImplementation(async (fieldName) => {
                                    if ( fieldName === 'type' ) return 'directory';
                                    if ( fieldName === 'path' ) return '/alice/Public';
                                    return null;
                                }),
                            }),
                        };
                    }
                    if ( serviceName === 'acl' ) {
                        return {
                            check: vi.fn().mockResolvedValue(true),
                        };
                    }
                    if ( serviceName === 'event' ) return { emit: eventEmit };
                    if ( serviceName === 'auth' ) return authService;
                    return {};
                }),
            };
            mockContextInstance.get.mockImplementation((key) => {
                if ( key === 'services' ) return mockServices;
                return null;
            });
            getUserMockImpl = async () => ({ id: 101, suspended: false });
            getAppMockImpl = async () => ({
                uid: 'app-11111111-1111-1111-1111-111111111111',
                name: 'paid-app',
                is_private: 1,
                index_url: 'https://paid.puter.dev/',
            });

            const mockReq = {
                hostname: 'paid.puter.dev',
                subdomains: [],
                is_custom_domain: false,
                baseUrl: '',
                path: '/index.html',
                originalUrl: '/index.html?puter.auth.token=bootstrap-token',
                cookies: {},
                headers: {},
                query: {
                    'puter.auth.token': 'bootstrap-token',
                },
                ctx: mockContextInstance,
            };
            const mockRes = {
                redirect: vi.fn(),
                cookie: vi.fn(),
                setHeader: vi.fn(),
                status: vi.fn().mockReturnThis(),
                send: vi.fn(),
            };
            const mockNext = vi.fn();

            await capturedMiddleware(mockReq, mockRes, mockNext);

            expect(authService.authenticate_from_token).toHaveBeenCalledWith('bootstrap-token');
            expect(authService.resolvePrivateBootstrapIdentityFromToken)
                .toHaveBeenCalledWith('bootstrap-token', {
                    expectedAppUids: ['app-11111111-1111-1111-1111-111111111111'],
                });
            expect(eventEmit).toHaveBeenCalledWith(
                'app.privateAccess.check',
                expect.objectContaining({
                    appUid: 'app-11111111-1111-1111-1111-111111111111',
                    userUid: 'user-111',
                }),
            );
            expect(mockRes.redirect).toHaveBeenCalledWith('https://apps.puter.com/app/paid-app');
            expect(mockRes.send).not.toHaveBeenCalled();
            expect(mockRes.cookie).not.toHaveBeenCalled();
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('passes request hostname to private asset cookie options on allow', async () => {
            const eventEmit = vi.fn().mockImplementation(async (_eventName, event) => {
                event.result.allowed = true;
            });
            const rootDirectoryNode = {
                fetchEntry: vi.fn().mockResolvedValue(undefined),
                exists: vi.fn().mockResolvedValue(true),
                get: vi.fn().mockImplementation(async (fieldName) => {
                    if ( fieldName === 'type' ) return 'directory';
                    if ( fieldName === 'path' ) return '/alice/Public';
                    return null;
                }),
            };
            const missingFileNode = {
                fetchEntry: vi.fn().mockResolvedValue(undefined),
                exists: vi.fn().mockResolvedValue(false),
                get: vi.fn().mockResolvedValue(null),
            };
            let filesystemNodeCallCount = 0;
            const authService = {
                getPrivateAssetCookieName: vi.fn().mockReturnValue('puter.private.asset.token'),
                app_uid_from_origin: vi.fn().mockResolvedValue('app-origin-111'),
                verifyPrivateAssetToken: vi.fn().mockImplementation(() => {
                    throw new Error('invalid');
                }),
                authenticate_from_token: vi.fn().mockResolvedValue({
                    type: {},
                    get_related_actor: vi.fn().mockReturnValue({
                        type: {
                            user: { uuid: 'user-allow-111' },
                            session: 'session-allow-111',
                        },
                    }),
                }),
                createPrivateAssetToken: vi.fn().mockReturnValue('private-token'),
                getPrivateAssetCookieOptions: vi.fn().mockReturnValue({ sameSite: 'none' }),
            };
            const mockServices = {
                get: vi.fn().mockImplementation((serviceName) => {
                    if ( serviceName === 'puter-site' ) {
                        return {
                            get_subdomain: vi.fn().mockResolvedValue({
                                user_id: 101,
                                associated_app_id: 202,
                                root_dir_id: 303,
                            }),
                        };
                    }
                    if ( serviceName === 'filesystem' ) {
                        return {
                            node: vi.fn().mockImplementation(async () => {
                                filesystemNodeCallCount += 1;
                                return filesystemNodeCallCount === 1
                                    ? rootDirectoryNode
                                    : missingFileNode;
                            }),
                        };
                    }
                    if ( serviceName === 'acl' ) {
                        return {
                            check: vi.fn().mockResolvedValue(true),
                        };
                    }
                    if ( serviceName === 'event' ) return { emit: eventEmit };
                    if ( serviceName === 'auth' ) return authService;
                    return {};
                }),
            };
            mockContextInstance.get.mockImplementation((key) => {
                if ( key === 'services' ) return mockServices;
                return null;
            });
            getUserMockImpl = async () => ({ id: 101, suspended: false });
            getAppMockImpl = async () => ({
                uid: 'app-11111111-1111-1111-1111-111111111111',
                name: 'paid-app',
                is_private: 1,
                index_url: 'https://paid.puter.dev/',
            });

            const mockReq = {
                hostname: 'paid.puter.dev',
                subdomains: [],
                is_custom_domain: false,
                baseUrl: '',
                path: '/asset.js',
                originalUrl: '/asset.js',
                cookies: {
                    'puter.session.token': 'session-token',
                },
                headers: {},
                query: {},
                ctx: mockContextInstance,
            };
            const mockRes = {
                redirect: vi.fn(),
                cookie: vi.fn(),
                setHeader: vi.fn(),
                set: vi.fn().mockReturnThis(),
                status: vi.fn().mockReturnThis(),
                send: vi.fn(),
                write: vi.fn(),
                end: vi.fn(),
            };
            const mockNext = vi.fn();

            await capturedMiddleware(mockReq, mockRes, mockNext);

            expect(authService.getPrivateAssetCookieOptions).toHaveBeenCalledWith({
                requestHostname: 'paid.puter.dev',
            });
            expect(authService.createPrivateAssetToken).toHaveBeenCalledWith({
                appUid: 'app-origin-111',
                userUid: 'user-allow-111',
                sessionUuid: 'session-allow-111',
                subdomain: 'paid',
                privateHost: 'paid.puter.dev',
            });
            expect(mockRes.cookie).toHaveBeenCalledWith(
                'puter.private.asset.token',
                'private-token',
                { sameSite: 'none' },
            );
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('includes subdomain and private host when strict bootstrap token auth succeeds', async () => {
            const eventEmit = vi.fn().mockImplementation(async (_eventName, event) => {
                event.result.allowed = true;
            });
            const rootDirectoryNode = {
                fetchEntry: vi.fn().mockResolvedValue(undefined),
                exists: vi.fn().mockResolvedValue(true),
                get: vi.fn().mockImplementation(async (fieldName) => {
                    if ( fieldName === 'type' ) return 'directory';
                    if ( fieldName === 'path' ) return '/alice/Public';
                    return null;
                }),
            };
            const missingFileNode = {
                fetchEntry: vi.fn().mockResolvedValue(undefined),
                exists: vi.fn().mockResolvedValue(false),
                get: vi.fn().mockResolvedValue(null),
            };
            let filesystemNodeCallCount = 0;
            const authService = {
                getPrivateAssetCookieName: vi.fn().mockReturnValue('puter.private.asset.token'),
                verifyPrivateAssetToken: vi.fn().mockImplementation(() => {
                    throw new Error('invalid');
                }),
                authenticate_from_token: vi.fn().mockResolvedValue({
                    type: {},
                    get_related_actor: vi.fn().mockReturnValue({
                        type: {
                            user: { uuid: 'user-bootstrap-111' },
                            session: 'session-bootstrap-111',
                        },
                    }),
                }),
                resolvePrivateBootstrapIdentityFromToken: vi.fn().mockResolvedValue({
                    userUid: 'user-bootstrap-111',
                    sessionUuid: 'session-bootstrap-111',
                }),
                createPrivateAssetToken: vi.fn().mockReturnValue('private-token'),
                getPrivateAssetCookieOptions: vi.fn().mockReturnValue({ sameSite: 'none' }),
            };
            const mockServices = {
                get: vi.fn().mockImplementation((serviceName) => {
                    if ( serviceName === 'puter-site' ) {
                        return {
                            get_subdomain: vi.fn().mockResolvedValue({
                                user_id: 101,
                                associated_app_id: 202,
                                root_dir_id: 303,
                            }),
                        };
                    }
                    if ( serviceName === 'filesystem' ) {
                        return {
                            node: vi.fn().mockImplementation(async () => {
                                filesystemNodeCallCount += 1;
                                return filesystemNodeCallCount === 1
                                    ? rootDirectoryNode
                                    : missingFileNode;
                            }),
                        };
                    }
                    if ( serviceName === 'acl' ) {
                        return {
                            check: vi.fn().mockResolvedValue(true),
                        };
                    }
                    if ( serviceName === 'event' ) return { emit: eventEmit };
                    if ( serviceName === 'auth' ) return authService;
                    return {};
                }),
            };
            mockContextInstance.get.mockImplementation((key) => {
                if ( key === 'services' ) return mockServices;
                return null;
            });
            getUserMockImpl = async () => ({ id: 101, suspended: false });
            getAppMockImpl = async () => ({
                uid: 'app-11111111-1111-1111-1111-111111111111',
                name: 'paid-app',
                is_private: 1,
                index_url: 'https://paid.puter.dev/',
            });

            const mockReq = {
                hostname: 'paid.puter.dev',
                subdomains: [],
                is_custom_domain: false,
                baseUrl: '',
                path: '/asset.js',
                originalUrl: '/asset.js?puter.auth.token=bootstrap-token&foo=bar',
                cookies: {},
                headers: {},
                query: {
                    'puter.auth.token': 'bootstrap-token',
                    foo: 'bar',
                },
                ctx: mockContextInstance,
            };
            const mockRes = {
                redirect: vi.fn(),
                cookie: vi.fn(),
                setHeader: vi.fn(),
                set: vi.fn().mockReturnThis(),
                status: vi.fn().mockReturnThis(),
                send: vi.fn(),
                write: vi.fn(),
                end: vi.fn(),
            };
            const mockNext = vi.fn();

            await capturedMiddleware(mockReq, mockRes, mockNext);

            expect(authService.authenticate_from_token).toHaveBeenCalledWith('bootstrap-token');
            expect(authService.resolvePrivateBootstrapIdentityFromToken).toHaveBeenCalledWith('bootstrap-token', {
                expectedAppUids: ['app-11111111-1111-1111-1111-111111111111'],
            });
            expect(authService.createPrivateAssetToken).toHaveBeenCalledWith({
                appUid: 'app-11111111-1111-1111-1111-111111111111',
                userUid: 'user-bootstrap-111',
                sessionUuid: 'session-bootstrap-111',
                subdomain: 'paid',
                privateHost: 'paid.puter.dev',
            });
            expect(authService.getPrivateAssetCookieOptions).toHaveBeenCalledWith({
                requestHostname: 'paid.puter.dev',
            });
            expect(mockRes.cookie).toHaveBeenCalledWith(
                'puter.private.asset.token',
                'private-token',
                { sameSite: 'none' },
            );
            expect(mockRes.redirect).toHaveBeenCalledWith('/asset.js?foo=bar');
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('does not server-redirect bootstrap token for iframe app instance requests', async () => {
            const eventEmit = vi.fn().mockImplementation(async (_eventName, event) => {
                event.result.allowed = true;
            });
            const rootDirectoryNode = {
                fetchEntry: vi.fn().mockResolvedValue(undefined),
                exists: vi.fn().mockResolvedValue(true),
                get: vi.fn().mockImplementation(async (fieldName) => {
                    if ( fieldName === 'type' ) return 'directory';
                    if ( fieldName === 'path' ) return '/alice/Public';
                    return null;
                }),
            };
            const missingFileNode = {
                fetchEntry: vi.fn().mockResolvedValue(undefined),
                exists: vi.fn().mockResolvedValue(false),
                get: vi.fn().mockResolvedValue(null),
            };
            let filesystemNodeCallCount = 0;
            const authService = {
                getPrivateAssetCookieName: vi.fn().mockReturnValue('puter.private.asset.token'),
                verifyPrivateAssetToken: vi.fn().mockImplementation(() => {
                    throw new Error('invalid');
                }),
                authenticate_from_token: vi.fn().mockResolvedValue({
                    type: {},
                    get_related_actor: vi.fn().mockReturnValue({
                        type: {
                            user: { uuid: 'user-bootstrap-111' },
                            session: 'session-bootstrap-111',
                        },
                    }),
                }),
                resolvePrivateBootstrapIdentityFromToken: vi.fn().mockResolvedValue({
                    userUid: 'user-bootstrap-111',
                    sessionUuid: 'session-bootstrap-111',
                }),
                createPrivateAssetToken: vi.fn().mockReturnValue('private-token'),
                getPrivateAssetCookieOptions: vi.fn().mockReturnValue({ sameSite: 'none' }),
            };
            const mockServices = {
                get: vi.fn().mockImplementation((serviceName) => {
                    if ( serviceName === 'puter-site' ) {
                        return {
                            get_subdomain: vi.fn().mockResolvedValue({
                                user_id: 101,
                                associated_app_id: 202,
                                root_dir_id: 303,
                            }),
                        };
                    }
                    if ( serviceName === 'filesystem' ) {
                        return {
                            node: vi.fn().mockImplementation(async () => {
                                filesystemNodeCallCount += 1;
                                return filesystemNodeCallCount === 1
                                    ? rootDirectoryNode
                                    : missingFileNode;
                            }),
                        };
                    }
                    if ( serviceName === 'acl' ) {
                        return {
                            check: vi.fn().mockResolvedValue(true),
                        };
                    }
                    if ( serviceName === 'event' ) return { emit: eventEmit };
                    if ( serviceName === 'auth' ) return authService;
                    return {};
                }),
            };
            mockContextInstance.get.mockImplementation((key) => {
                if ( key === 'services' ) return mockServices;
                return null;
            });
            getUserMockImpl = async () => ({ id: 101, suspended: false });
            getAppMockImpl = async () => ({
                uid: 'app-11111111-1111-1111-1111-111111111111',
                name: 'paid-app',
                is_private: 1,
                index_url: 'https://paid.puter.dev/',
            });

            const mockReq = {
                hostname: 'paid.puter.dev',
                subdomains: [],
                is_custom_domain: false,
                baseUrl: '',
                path: '/asset.js',
                originalUrl: '/asset.js?puter.auth.token=bootstrap-token&puter.app_instance_id=instance-111&foo=bar',
                cookies: {},
                headers: {},
                query: {
                    'puter.auth.token': 'bootstrap-token',
                    'puter.app_instance_id': 'instance-111',
                    foo: 'bar',
                },
                ctx: mockContextInstance,
            };
            const mockRes = {
                redirect: vi.fn(),
                cookie: vi.fn(),
                setHeader: vi.fn(),
                set: vi.fn().mockReturnThis(),
                status: vi.fn().mockReturnThis(),
                send: vi.fn(),
                write: vi.fn(),
                end: vi.fn(),
            };
            const mockNext = vi.fn();

            await capturedMiddleware(mockReq, mockRes, mockNext);

            expect(authService.authenticate_from_token).toHaveBeenCalledWith('bootstrap-token');
            expect(authService.createPrivateAssetToken).toHaveBeenCalledWith({
                appUid: 'app-11111111-1111-1111-1111-111111111111',
                userUid: 'user-bootstrap-111',
                sessionUuid: 'session-bootstrap-111',
                subdomain: 'paid',
                privateHost: 'paid.puter.dev',
            });
            expect(mockRes.cookie).toHaveBeenCalledWith(
                'puter.private.asset.token',
                'private-token',
                { sameSite: 'none' },
            );
            expect(mockRes.redirect).not.toHaveBeenCalled();
            expect(filesystemNodeCallCount).toBeGreaterThanOrEqual(2);
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('accepts nested query token key for bootstrap auth', async () => {
            const eventEmit = vi.fn().mockImplementation(async (_eventName, event) => {
                event.result.allowed = false;
                event.result.redirectUrl = 'https://apps.puter.com/app/paid-app';
            });
            const authService = {
                getPrivateAssetCookieName: vi.fn().mockReturnValue('puter.private.asset.token'),
                verifyPrivateAssetToken: vi.fn().mockImplementation(() => {
                    throw new Error('invalid');
                }),
                authenticate_from_token: vi.fn().mockImplementation(() => {
                    throw new Error('token_auth_failed');
                }),
                resolvePrivateBootstrapIdentityFromToken: vi.fn().mockResolvedValue({
                    userUid: 'user-111',
                    sessionUuid: 'session-111',
                }),
                createPrivateAssetToken: vi.fn().mockReturnValue('private-token'),
                getPrivateAssetCookieOptions: vi.fn().mockReturnValue({}),
            };
            const mockServices = {
                get: vi.fn().mockImplementation((serviceName) => {
                    if ( serviceName === 'puter-site' ) {
                        return {
                            get_subdomain: vi.fn().mockResolvedValue({
                                user_id: 101,
                                associated_app_id: 202,
                                root_dir_id: 303,
                            }),
                        };
                    }
                    if ( serviceName === 'filesystem' ) {
                        return {
                            node: vi.fn().mockResolvedValue({
                                exists: vi.fn().mockResolvedValue(true),
                                get: vi.fn().mockImplementation(async (fieldName) => {
                                    if ( fieldName === 'type' ) return 'directory';
                                    if ( fieldName === 'path' ) return '/alice/Public';
                                    return null;
                                }),
                            }),
                        };
                    }
                    if ( serviceName === 'acl' ) {
                        return {
                            check: vi.fn().mockResolvedValue(true),
                        };
                    }
                    if ( serviceName === 'event' ) return { emit: eventEmit };
                    if ( serviceName === 'auth' ) return authService;
                    return {};
                }),
            };
            mockContextInstance.get.mockImplementation((key) => {
                if ( key === 'services' ) return mockServices;
                return null;
            });
            getUserMockImpl = async () => ({ id: 101, suspended: false });
            getAppMockImpl = async () => ({
                uid: 'app-11111111-1111-1111-1111-111111111111',
                name: 'paid-app',
                is_private: 1,
                index_url: 'https://paid.puter.dev/',
            });

            const mockReq = {
                hostname: 'paid.puter.dev',
                subdomains: [],
                is_custom_domain: false,
                baseUrl: '',
                path: '/index.html',
                originalUrl: '/index.html?puter.auth.token=bootstrap-token',
                cookies: {},
                headers: {},
                query: {
                    puter: {
                        auth: {
                            token: 'bootstrap-token',
                        },
                    },
                },
                ctx: mockContextInstance,
            };
            const mockRes = {
                redirect: vi.fn(),
                cookie: vi.fn(),
                setHeader: vi.fn(),
                status: vi.fn().mockReturnThis(),
                send: vi.fn(),
            };
            const mockNext = vi.fn();

            await capturedMiddleware(mockReq, mockRes, mockNext);

            expect(authService.authenticate_from_token).toHaveBeenCalledWith('bootstrap-token');
            expect(authService.resolvePrivateBootstrapIdentityFromToken)
                .toHaveBeenCalledWith('bootstrap-token', {
                    expectedAppUids: ['app-11111111-1111-1111-1111-111111111111'],
                });
            expect(mockRes.redirect).toHaveBeenCalledWith('https://apps.puter.com/app/paid-app');
            expect(mockRes.send).not.toHaveBeenCalled();
            expect(mockRes.cookie).not.toHaveBeenCalled();
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('skips private app gate when feature flag is disabled', async () => {
            config.enable_private_app_access_gate = false;

            const eventEmit = vi.fn();
            const rootDirectoryNode = {
                fetchEntry: vi.fn().mockResolvedValue(undefined),
                exists: vi.fn().mockResolvedValue(true),
                get: vi.fn().mockImplementation(async (fieldName) => {
                    if ( fieldName === 'type' ) return 'directory';
                    if ( fieldName === 'path' ) return '/alice/Public';
                    return null;
                }),
            };
            const missingFileNode = {
                fetchEntry: vi.fn().mockResolvedValue(undefined),
                exists: vi.fn().mockResolvedValue(false),
                get: vi.fn().mockResolvedValue(null),
            };

            let filesystemNodeCallCount = 0;
            const mockServices = {
                get: vi.fn().mockImplementation((serviceName) => {
                    if ( serviceName === 'puter-site' ) {
                        return {
                            get_subdomain: vi.fn().mockResolvedValue({
                                user_id: 101,
                                associated_app_id: 202,
                                root_dir_id: 303,
                            }),
                        };
                    }
                    if ( serviceName === 'filesystem' ) {
                        return {
                            node: vi.fn().mockImplementation(async () => {
                                filesystemNodeCallCount += 1;
                                return filesystemNodeCallCount === 1
                                    ? rootDirectoryNode
                                    : missingFileNode;
                            }),
                        };
                    }
                    if ( serviceName === 'acl' ) {
                        return {
                            check: vi.fn().mockResolvedValue(true),
                        };
                    }
                    if ( serviceName === 'event' ) return { emit: eventEmit };
                    return {};
                }),
            };
            mockContextInstance.get.mockImplementation((key) => {
                if ( key === 'services' ) return mockServices;
                return null;
            });
            getUserMockImpl = async () => ({ id: 101, suspended: false });
            getAppMockImpl = async () => ({
                uid: 'app-11111111-1111-1111-1111-111111111111',
                name: 'paid-app',
                is_private: 1,
                index_url: 'https://paid.puter.dev/',
            });

            const mockReq = {
                hostname: 'paid.site.puter.localhost',
                subdomains: ['paid'],
                is_custom_domain: false,
                baseUrl: '',
                path: '/asset.js',
                originalUrl: '/asset.js',
                query: {},
                cookies: {},
                headers: {},
                on: vi.fn(),
                ctx: mockContextInstance,
            };
            const mockRes = {
                redirect: vi.fn(),
                cookie: vi.fn(),
                setHeader: vi.fn(),
                set: vi.fn().mockReturnThis(),
                status: vi.fn().mockReturnThis(),
                send: vi.fn(),
                write: vi.fn(),
                end: vi.fn(),
            };
            const mockNext = vi.fn();

            await capturedMiddleware(mockReq, mockRes, mockNext);

            expect(mockRes.redirect).not.toHaveBeenCalled();
            expect(eventEmit).not.toHaveBeenCalled();
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockNext).not.toHaveBeenCalled();
        });
    });

    describe('public hosted actor bootstrap', () => {
        let capturedMiddleware;

        const createRootAndMissingNodes = () => {
            const rootDirectoryNode = {
                fetchEntry: vi.fn().mockResolvedValue(undefined),
                exists: vi.fn().mockResolvedValue(true),
                get: vi.fn().mockImplementation(async (fieldName) => {
                    if ( fieldName === 'type' ) return 'directory';
                    if ( fieldName === 'path' ) return '/alice/Public';
                    return null;
                }),
            };
            const missingFileNode = {
                fetchEntry: vi.fn().mockResolvedValue(undefined),
                exists: vi.fn().mockResolvedValue(false),
                get: vi.fn().mockResolvedValue(null),
            };
            return { rootDirectoryNode, missingFileNode };
        };

        beforeEach(() => {
            vi.clearAllMocks();
            config.enable_private_app_access_gate = true;
            Context.get = vi.fn().mockImplementation((key) => {
                if ( key === 'actor' ) return undefined;
                return mockContextInstance;
            });
            Context.set = vi.fn();
            getUserMockImpl = async () => null;
            getAppMockImpl = async () => null;
            capturedMiddleware = puterSiteMiddleware;
        });

        it('mints public hosted actor cookie from session identity on non-private app', async () => {
            const { rootDirectoryNode, missingFileNode } = createRootAndMissingNodes();
            let filesystemNodeCallCount = 0;
            const authService = {
                getPublicHostedActorCookieName: vi.fn().mockReturnValue('puter.public.hosted.actor.token'),
                verifyPublicHostedActorToken: vi.fn().mockImplementation(() => {
                    throw new Error('invalid');
                }),
                authenticate_from_token: vi.fn().mockResolvedValue({
                    type: {},
                    get_related_actor: vi.fn().mockReturnValue({
                        type: {
                            user: { uuid: 'user-public-111' },
                            session: 'session-public-111',
                        },
                    }),
                }),
                createPublicHostedActorToken: vi.fn().mockReturnValue('public-hosted-token'),
                getPublicHostedActorCookieOptions: vi.fn().mockReturnValue({ sameSite: 'none' }),
                app_uid_from_origin: vi.fn().mockResolvedValue('app-origin-fallback-111'),
            };
            const mockServices = {
                get: vi.fn().mockImplementation((serviceName) => {
                    if ( serviceName === 'puter-site' ) {
                        return {
                            get_subdomain: vi.fn().mockResolvedValue({
                                user_id: 101,
                                associated_app_id: 202,
                                root_dir_id: 303,
                            }),
                        };
                    }
                    if ( serviceName === 'filesystem' ) {
                        return {
                            node: vi.fn().mockImplementation(async () => {
                                filesystemNodeCallCount += 1;
                                return filesystemNodeCallCount === 1
                                    ? rootDirectoryNode
                                    : missingFileNode;
                            }),
                        };
                    }
                    if ( serviceName === 'acl' ) {
                        return {
                            check: vi.fn().mockResolvedValue(true),
                        };
                    }
                    if ( serviceName === 'auth' ) return authService;
                    return {};
                }),
            };
            mockContextInstance.get.mockImplementation((key) => {
                if ( key === 'services' ) return mockServices;
                return null;
            });
            getUserMockImpl = async () => ({ id: 101, suspended: false });
            getAppMockImpl = async () => ({
                uid: 'app-public-11111111-1111-1111-1111-111111111111',
                name: 'public-app',
                is_private: 0,
                index_url: 'https://paid.site.puter.localhost/',
            });

            const mockReq = {
                hostname: 'paid.site.puter.localhost',
                subdomains: ['paid'],
                is_custom_domain: false,
                baseUrl: '',
                path: '/asset.js',
                originalUrl: '/asset.js',
                query: {},
                cookies: {
                    'puter.session.token': 'session-token',
                },
                headers: {},
                on: vi.fn(),
                ctx: mockContextInstance,
            };
            const mockRes = {
                redirect: vi.fn(),
                cookie: vi.fn(),
                setHeader: vi.fn(),
                set: vi.fn().mockReturnThis(),
                status: vi.fn().mockReturnThis(),
                send: vi.fn(),
                write: vi.fn(),
                end: vi.fn(),
            };
            const mockNext = vi.fn();

            await capturedMiddleware(mockReq, mockRes, mockNext);

            expect(authService.verifyPublicHostedActorToken).not.toHaveBeenCalled();
            expect(authService.authenticate_from_token).toHaveBeenCalledWith('session-token');
            expect(authService.createPublicHostedActorToken).toHaveBeenCalledWith({
                appUid: 'app-public-11111111-1111-1111-1111-111111111111',
                userUid: 'user-public-111',
                sessionUuid: 'session-public-111',
                subdomain: 'paid',
                host: 'paid.site.puter.localhost',
            });
            expect(authService.app_uid_from_origin).not.toHaveBeenCalled();
            expect(authService.getPublicHostedActorCookieOptions).toHaveBeenCalledWith({
                requestHostname: 'paid.site.puter.localhost',
            });
            expect(mockRes.cookie).toHaveBeenCalledWith(
                'puter.public.hosted.actor.token',
                'public-hosted-token',
                { sameSite: 'none' },
            );
            expect(Context.set).toHaveBeenCalledWith('actor', expect.any(Object));
            expect(mockRes.redirect).not.toHaveBeenCalled();
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('uses valid public hosted actor cookie without re-authenticating', async () => {
            const { rootDirectoryNode, missingFileNode } = createRootAndMissingNodes();
            let filesystemNodeCallCount = 0;
            const authService = {
                getPublicHostedActorCookieName: vi.fn().mockReturnValue('puter.public.hosted.actor.token'),
                verifyPublicHostedActorToken: vi.fn().mockReturnValue({
                    appUid: 'app-public-22222222-2222-2222-2222-222222222222',
                    userUid: 'user-public-222',
                    sessionUuid: 'session-public-222',
                    subdomain: 'paid',
                    host: 'paid.site.puter.localhost',
                }),
                authenticate_from_token: vi.fn(),
                createPublicHostedActorToken: vi.fn(),
                getPublicHostedActorCookieOptions: vi.fn(),
                app_uid_from_origin: vi.fn(),
            };
            const mockServices = {
                get: vi.fn().mockImplementation((serviceName) => {
                    if ( serviceName === 'puter-site' ) {
                        return {
                            get_subdomain: vi.fn().mockResolvedValue({
                                user_id: 101,
                                associated_app_id: 202,
                                root_dir_id: 303,
                            }),
                        };
                    }
                    if ( serviceName === 'filesystem' ) {
                        return {
                            node: vi.fn().mockImplementation(async () => {
                                filesystemNodeCallCount += 1;
                                return filesystemNodeCallCount === 1
                                    ? rootDirectoryNode
                                    : missingFileNode;
                            }),
                        };
                    }
                    if ( serviceName === 'acl' ) {
                        return {
                            check: vi.fn().mockResolvedValue(true),
                        };
                    }
                    if ( serviceName === 'auth' ) return authService;
                    return {};
                }),
            };
            mockContextInstance.get.mockImplementation((key) => {
                if ( key === 'services' ) return mockServices;
                return null;
            });
            getUserMockImpl = async () => ({ id: 101, suspended: false });
            getAppMockImpl = async () => ({
                uid: 'app-public-22222222-2222-2222-2222-222222222222',
                name: 'public-app',
                is_private: 0,
                index_url: 'https://paid.site.puter.localhost/',
            });

            const mockReq = {
                hostname: 'paid.site.puter.localhost',
                subdomains: ['paid'],
                is_custom_domain: false,
                baseUrl: '',
                path: '/asset.js',
                originalUrl: '/asset.js',
                query: {},
                cookies: {
                    'puter.public.hosted.actor.token': 'public-cookie-token',
                },
                headers: {},
                on: vi.fn(),
                ctx: mockContextInstance,
            };
            const mockRes = {
                redirect: vi.fn(),
                cookie: vi.fn(),
                setHeader: vi.fn(),
                set: vi.fn().mockReturnThis(),
                status: vi.fn().mockReturnThis(),
                send: vi.fn(),
                write: vi.fn(),
                end: vi.fn(),
            };
            const mockNext = vi.fn();

            await capturedMiddleware(mockReq, mockRes, mockNext);

            expect(authService.verifyPublicHostedActorToken).toHaveBeenCalledWith(
                'public-cookie-token',
                {
                    expectedAppUid: 'app-public-22222222-2222-2222-2222-222222222222',
                    expectedSubdomain: 'paid',
                    expectedHost: 'paid.site.puter.localhost',
                },
            );
            expect(authService.authenticate_from_token).not.toHaveBeenCalled();
            expect(authService.createPublicHostedActorToken).not.toHaveBeenCalled();
            expect(authService.app_uid_from_origin).not.toHaveBeenCalled();
            expect(mockRes.cookie).not.toHaveBeenCalled();
            expect(Context.set).toHaveBeenCalledWith('actor', expect.any(Object));
            const [, actor] = Context.set.mock.calls[0];
            expect(actor?.type?.user?.uuid).toBe('user-public-222');
            expect(mockRes.redirect).not.toHaveBeenCalled();
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('sets public hosted cookie and redirects to sanitized url for bootstrap tokens', async () => {
            const { rootDirectoryNode, missingFileNode } = createRootAndMissingNodes();
            let filesystemNodeCallCount = 0;
            const authService = {
                getPublicHostedActorCookieName: vi.fn().mockReturnValue('puter.public.hosted.actor.token'),
                verifyPublicHostedActorToken: vi.fn().mockImplementation(() => {
                    throw new Error('invalid');
                }),
                authenticate_from_token: vi.fn().mockResolvedValue({
                    type: {},
                    get_related_actor: vi.fn().mockReturnValue({
                        type: {
                            user: { uuid: 'user-public-333' },
                            session: 'session-public-333',
                        },
                    }),
                }),
                createPublicHostedActorToken: vi.fn().mockReturnValue('public-hosted-token-333'),
                getPublicHostedActorCookieOptions: vi.fn().mockReturnValue({ sameSite: 'none' }),
                app_uid_from_origin: vi.fn(),
            };
            const mockServices = {
                get: vi.fn().mockImplementation((serviceName) => {
                    if ( serviceName === 'puter-site' ) {
                        return {
                            get_subdomain: vi.fn().mockResolvedValue({
                                user_id: 101,
                                associated_app_id: 202,
                                root_dir_id: 303,
                            }),
                        };
                    }
                    if ( serviceName === 'filesystem' ) {
                        return {
                            node: vi.fn().mockImplementation(async () => {
                                filesystemNodeCallCount += 1;
                                return filesystemNodeCallCount === 1
                                    ? rootDirectoryNode
                                    : missingFileNode;
                            }),
                        };
                    }
                    if ( serviceName === 'acl' ) {
                        return {
                            check: vi.fn().mockResolvedValue(true),
                        };
                    }
                    if ( serviceName === 'auth' ) return authService;
                    return {};
                }),
            };
            mockContextInstance.get.mockImplementation((key) => {
                if ( key === 'services' ) return mockServices;
                return null;
            });
            getUserMockImpl = async () => ({ id: 101, suspended: false });
            getAppMockImpl = async () => ({
                uid: 'app-public-33333333-3333-3333-3333-333333333333',
                name: 'public-app',
                is_private: 0,
                index_url: 'https://paid.site.puter.localhost/',
            });

            const mockReq = {
                hostname: 'paid.site.puter.localhost',
                subdomains: ['paid'],
                is_custom_domain: false,
                baseUrl: '',
                path: '/asset.js',
                originalUrl: '/asset.js?puter.auth.token=bootstrap-token&foo=bar',
                query: {
                    'puter.auth.token': 'bootstrap-token',
                    foo: 'bar',
                },
                cookies: {},
                headers: {},
                on: vi.fn(),
                ctx: mockContextInstance,
            };
            const mockRes = {
                redirect: vi.fn(),
                cookie: vi.fn(),
                setHeader: vi.fn(),
                set: vi.fn().mockReturnThis(),
                status: vi.fn().mockReturnThis(),
                send: vi.fn(),
                write: vi.fn(),
                end: vi.fn(),
            };
            const mockNext = vi.fn();

            await capturedMiddleware(mockReq, mockRes, mockNext);

            expect(authService.authenticate_from_token).toHaveBeenCalledWith('bootstrap-token');
            expect(authService.createPublicHostedActorToken).toHaveBeenCalledWith({
                appUid: 'app-public-33333333-3333-3333-3333-333333333333',
                userUid: 'user-public-333',
                sessionUuid: 'session-public-333',
                subdomain: 'paid',
                host: 'paid.site.puter.localhost',
            });
            expect(mockRes.cookie).toHaveBeenCalledWith(
                'puter.public.hosted.actor.token',
                'public-hosted-token-333',
                { sameSite: 'none' },
            );
            expect(mockRes.redirect).toHaveBeenCalledWith('/asset.js?foo=bar');
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('uses strict bootstrap identity verification when available', async () => {
            const { rootDirectoryNode, missingFileNode } = createRootAndMissingNodes();
            let filesystemNodeCallCount = 0;
            const authService = {
                getPublicHostedActorCookieName: vi.fn().mockReturnValue('puter.public.hosted.actor.token'),
                verifyPublicHostedActorToken: vi.fn().mockImplementation(() => {
                    throw new Error('invalid');
                }),
                resolvePrivateBootstrapIdentityFromToken: vi.fn().mockResolvedValue({
                    userUid: 'user-public-555',
                    sessionUuid: 'session-public-555',
                }),
                authenticate_from_token: vi.fn(),
                createPublicHostedActorToken: vi.fn().mockReturnValue('public-hosted-token-555'),
                getPublicHostedActorCookieOptions: vi.fn().mockReturnValue({ sameSite: 'none' }),
                app_uid_from_origin: vi.fn(),
            };
            const mockServices = {
                get: vi.fn().mockImplementation((serviceName) => {
                    if ( serviceName === 'puter-site' ) {
                        return {
                            get_subdomain: vi.fn().mockResolvedValue({
                                user_id: 101,
                                associated_app_id: 202,
                                root_dir_id: 303,
                            }),
                        };
                    }
                    if ( serviceName === 'filesystem' ) {
                        return {
                            node: vi.fn().mockImplementation(async () => {
                                filesystemNodeCallCount += 1;
                                return filesystemNodeCallCount === 1
                                    ? rootDirectoryNode
                                    : missingFileNode;
                            }),
                        };
                    }
                    if ( serviceName === 'acl' ) {
                        return {
                            check: vi.fn().mockResolvedValue(true),
                        };
                    }
                    if ( serviceName === 'auth' ) return authService;
                    return {};
                }),
            };
            mockContextInstance.get.mockImplementation((key) => {
                if ( key === 'services' ) return mockServices;
                return null;
            });
            getUserMockImpl = async () => ({ id: 101, suspended: false });
            getAppMockImpl = async () => ({
                uid: 'app-public-55555555-5555-5555-5555-555555555555',
                name: 'public-app',
                is_private: 0,
                index_url: 'https://paid.site.puter.localhost/',
            });

            const mockReq = {
                hostname: 'paid.site.puter.localhost',
                subdomains: ['paid'],
                is_custom_domain: false,
                baseUrl: '',
                path: '/asset.js',
                originalUrl: '/asset.js?puter.auth.token=bootstrap-token&foo=bar',
                query: {
                    'puter.auth.token': 'bootstrap-token',
                    foo: 'bar',
                },
                cookies: {},
                headers: {},
                on: vi.fn(),
                ctx: mockContextInstance,
            };
            const mockRes = {
                redirect: vi.fn(),
                cookie: vi.fn(),
                setHeader: vi.fn(),
                set: vi.fn().mockReturnThis(),
                status: vi.fn().mockReturnThis(),
                send: vi.fn(),
                write: vi.fn(),
                end: vi.fn(),
            };
            const mockNext = vi.fn();

            await capturedMiddleware(mockReq, mockRes, mockNext);

            expect(authService.resolvePrivateBootstrapIdentityFromToken).toHaveBeenCalledWith(
                'bootstrap-token',
                {
                    expectedAppUid: 'app-public-55555555-5555-5555-5555-555555555555',
                },
            );
            expect(authService.authenticate_from_token).not.toHaveBeenCalled();
            expect(authService.createPublicHostedActorToken).toHaveBeenCalledWith({
                appUid: 'app-public-55555555-5555-5555-5555-555555555555',
                userUid: 'user-public-555',
                sessionUuid: 'session-public-555',
                subdomain: 'paid',
                host: 'paid.site.puter.localhost',
            });
            expect(mockRes.redirect).toHaveBeenCalledWith('/asset.js?foo=bar');
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('short-circuits without auth calls when no identity tokens exist', async () => {
            const { rootDirectoryNode, missingFileNode } = createRootAndMissingNodes();
            let filesystemNodeCallCount = 0;
            const authService = {
                getPublicHostedActorCookieName: vi.fn().mockReturnValue('puter.public.hosted.actor.token'),
                verifyPublicHostedActorToken: vi.fn(),
                authenticate_from_token: vi.fn(),
                createPublicHostedActorToken: vi.fn(),
                getPublicHostedActorCookieOptions: vi.fn(),
                app_uid_from_origin: vi.fn(),
            };
            const mockServices = {
                get: vi.fn().mockImplementation((serviceName) => {
                    if ( serviceName === 'puter-site' ) {
                        return {
                            get_subdomain: vi.fn().mockResolvedValue({
                                user_id: 101,
                                associated_app_id: 202,
                                root_dir_id: 303,
                            }),
                        };
                    }
                    if ( serviceName === 'filesystem' ) {
                        return {
                            node: vi.fn().mockImplementation(async () => {
                                filesystemNodeCallCount += 1;
                                return filesystemNodeCallCount === 1
                                    ? rootDirectoryNode
                                    : missingFileNode;
                            }),
                        };
                    }
                    if ( serviceName === 'acl' ) {
                        return {
                            check: vi.fn().mockResolvedValue(true),
                        };
                    }
                    if ( serviceName === 'auth' ) return authService;
                    return {};
                }),
            };
            mockContextInstance.get.mockImplementation((key) => {
                if ( key === 'services' ) return mockServices;
                return null;
            });
            getUserMockImpl = async () => ({ id: 101, suspended: false });
            getAppMockImpl = async () => ({
                uid: 'app-public-44444444-4444-4444-4444-444444444444',
                name: 'public-app',
                is_private: 0,
                index_url: 'https://paid.site.puter.localhost/',
            });

            const mockReq = {
                hostname: 'paid.site.puter.localhost',
                subdomains: ['paid'],
                is_custom_domain: false,
                baseUrl: '',
                path: '/asset.js',
                originalUrl: '/asset.js',
                query: {},
                cookies: {},
                headers: {},
                on: vi.fn(),
                ctx: mockContextInstance,
            };
            const mockRes = {
                redirect: vi.fn(),
                cookie: vi.fn(),
                setHeader: vi.fn(),
                set: vi.fn().mockReturnThis(),
                status: vi.fn().mockReturnThis(),
                send: vi.fn(),
                write: vi.fn(),
                end: vi.fn(),
            };
            const mockNext = vi.fn();

            await capturedMiddleware(mockReq, mockRes, mockNext);

            expect(authService.verifyPublicHostedActorToken).not.toHaveBeenCalled();
            expect(authService.authenticate_from_token).not.toHaveBeenCalled();
            expect(authService.createPublicHostedActorToken).not.toHaveBeenCalled();
            expect(authService.app_uid_from_origin).not.toHaveBeenCalled();
            expect(mockRes.cookie).not.toHaveBeenCalled();
            expect(mockRes.redirect).not.toHaveBeenCalled();
            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockNext).not.toHaveBeenCalled();
        });
    });
});
