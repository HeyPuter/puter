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
import { describe, expect, it } from 'vitest';

const {
    parseSiteErrorConfig,
    getSiteErrorRule,
} = require('./puter-site-config');

describe('puter-site-config parser', () => {
    it('parses nginx error_page syntax', () => {
        const config = parseSiteErrorConfig(`
            error_page 404 /404.html;
            error_page 500 502 503 504 =200 /index.html;
        `);

        expect(getSiteErrorRule(config, 404)).toEqual({
            file: '/404.html',
            status: null,
        });
        expect(getSiteErrorRule(config, 500)).toEqual({
            file: '/index.html',
            status: 200,
        });
        expect(getSiteErrorRule(config, 503)).toEqual({
            file: '/index.html',
            status: 200,
        });
    });

    it('parses cloudfront custom error responses', () => {
        const config = parseSiteErrorConfig(JSON.stringify({
            CustomErrorResponses: [
                {
                    ErrorCode: 404,
                    ResponsePagePath: '/404.html',
                    ResponseCode: '200',
                },
                {
                    ErrorCode: 500,
                    ResponseCode: '404',
                },
            ],
        }));

        expect(getSiteErrorRule(config, 404)).toEqual({
            file: '/404.html',
            status: 200,
        });
        expect(getSiteErrorRule(config, 500)).toEqual({
            file: null,
            status: 404,
        });
    });

    it('parses puter-native json with exact, wildcard, and default rules', () => {
        const config = parseSiteErrorConfig(JSON.stringify({
            errors: {
                404: {
                    file: 'not-found.html',
                },
                '5xx': {
                    file: '/error.html',
                    status: 404,
                },
                default: {
                    status: 404,
                },
            },
        }));

        expect(getSiteErrorRule(config, 404)).toEqual({
            file: '/not-found.html',
            status: null,
        });
        expect(getSiteErrorRule(config, 502)).toEqual({
            file: '/error.html',
            status: 404,
        });
        expect(getSiteErrorRule(config, 418)).toEqual({
            file: null,
            status: 404,
        });
    });

    it('parses vercel-style catch-all rewrite as 404 fallback', () => {
        const config = parseSiteErrorConfig(JSON.stringify({
            rewrites: [
                {
                    source: '/:path*',
                    destination: '/index.html',
                },
            ],
        }));

        expect(getSiteErrorRule(config, 404)).toEqual({
            file: '/index.html',
            status: 200,
        });
    });

    it('returns null for unsupported config text', () => {
        const config = parseSiteErrorConfig('this is not a supported config format');
        expect(config).toBeNull();
    });
});
