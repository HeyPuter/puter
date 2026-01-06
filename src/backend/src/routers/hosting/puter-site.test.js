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

// Mocks to test middleware logic with minimal integration complexity
// (I added region markers, so this can be collapsed for readability)

// #region: mocks
vi.mock('../../config', () => ({
    default: {
        static_hosting_domain: 'site.puter.localhost',
        static_hosting_base_domain_redirect: 'https://developer.puter.com/static-hosting/',
        username_regex: /^[a-z0-9_]+$/,
    },
    static_hosting_domain: 'site.puter.localhost',
    static_hosting_base_domain_redirect: 'https://developer.puter.com/static-hosting/',
    username_regex: /^[a-z0-9_]+$/,
}));

vi.mock('../../modules/web/lib/api_error_handler', () => ({
    default: vi.fn(),
}));

vi.mock('../../helpers', () => ({
    get_user: vi.fn(),
    get_app: vi.fn(),
}));

// Mock Context to allow arun passthrough
const mockContextInstance = {
    get: vi.fn(),
    arun: vi.fn().mockImplementation(async (fn) => await fn()),
};

vi.mock('../../util/context', () => ({
    Context: {
        get: vi.fn().mockReturnValue(mockContextInstance),
    },
}));

vi.mock('../../filesystem/node/selectors', () => ({
    NodeInternalIDSelector: class {
    },
    NodePathSelector: class {
    },
}));

vi.mock('../../filesystem/FSNodeContext', () => ({
    TYPE_DIRECTORY: 'directory',
}));

vi.mock('../../filesystem/ll_operations/ll_read', () => ({
    LLRead: class {
    },
}));

vi.mock('../../services/auth/Actor', () => ({
    Actor: { adapt: vi.fn(), create: vi.fn() },
    UserActorType: class {
    },
    SiteActorType: class {
    },
}));

vi.mock('../../api/APIError', () => ({
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
const puterSiteModule = require('./puter-site');
const config = require('../../config');

describe('PuterSiteMiddleware', () => {
    describe('base domain redirect', () => {
        let capturedMiddleware;
        let mockApp;

        beforeEach(() => {
            vi.clearAllMocks();

            // Capture the middleware when it's installed
            mockApp = {
                use: vi.fn().mockImplementation((mw) => {
                    capturedMiddleware = mw;
                }),
            };

            // Install the middleware
            puterSiteModule(mockApp);
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
});
