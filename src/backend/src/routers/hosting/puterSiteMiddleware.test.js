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
        private_app_hosting_domain: 'puter.app',
        origin: 'https://puter.com',
        cookie_name: 'puter.session.token',
        username_regex: /^[a-z0-9_]+$/,
    },
    static_hosting_domain: 'site.puter.localhost',
    static_hosting_base_domain_redirect: 'https://developer.puter.com/static-hosting/',
    private_app_hosting_domain: 'puter.app',
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

vi.mock('../../services/auth/Actor.js', () => ({
    Actor: { adapt: vi.fn(), create: vi.fn() },
    UserActorType: class {
    },
    SiteActorType: class {
    },
}));

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
            Context.get = vi.fn().mockReturnValue(mockContextInstance);
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
            Context.get = vi.fn().mockReturnValue(mockContextInstance);
            getUserMockImpl = async () => null;
            getAppMockImpl = async () => null;
            capturedMiddleware = puterSiteMiddleware;
        });

        it('redirects private app assets to puter.app host', async () => {
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
                index_url: 'https://paid.puter.app/',
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

            expect(mockRes.redirect).toHaveBeenCalledWith('https://paid.puter.app/asset.js?foo=1');
            expect(mockNext).not.toHaveBeenCalled();
        });

        it('denies private app access and redirects using entitlement response', async () => {
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
                index_url: 'https://paid.puter.app/',
            });

            const mockReq = {
                hostname: 'paid.puter.app',
                subdomains: [],
                is_custom_domain: true,
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
                    userUid: null,
                }),
            );
            expect(mockRes.redirect).toHaveBeenCalledWith('https://puter.com/app/app-center/?item=app-11111111-1111-1111-1111-111111111111');
            expect(mockRes.cookie).not.toHaveBeenCalled();
            expect(mockNext).not.toHaveBeenCalled();
        });
    });
});
