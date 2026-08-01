/**
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

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PuterHomepageService } from './PuterHomepageService.js';

type EmitAndWait = (key: string, event: unknown, meta: unknown) => unknown;

const makeService = (
    config: Record<string, unknown> = {},
    emitAndWait: EmitAndWait = async () => undefined,
) => {
    const args = [
        { env: 'prod', domain: 'puter.test', ...config },
        { event: { emitAndWait: vi.fn(emitAndWait) } },
        {},
        {},
    ] as unknown as ConstructorParameters<typeof PuterHomepageService>;
    return new PuterHomepageService(...args);
};

const makeReq = (over: Partial<Request> = {}): Request =>
    ({
        query: {},
        path: '/',
        protocol: 'http',
        hostname: 'req-host.test',
        ...over,
    }) as unknown as Request;

/** Capture what the service sends, and return the rendered HTML. */
const render = async (
    service: PuterHomepageService,
    req: Request = makeReq(),
    meta: Record<string, unknown> = { title: 'Puter' },
    launchOptions: Record<string, unknown> = {},
): Promise<string> => {
    let sent = '';
    const res = {
        send: (html: string) => {
            sent = html;
        },
    } as unknown as Response;
    await service.send({ req, res }, meta as never, launchOptions as never);
    return sent;
};

/** Pull the object literal passed to the client-side `gui(...)` bootstrap. */
const guiParamsOf = (html: string): Record<string, unknown> => {
    const match = /gui\((\{.*?\})\);/s.exec(html);
    if (!match) throw new Error('no gui() call in rendered page');
    return JSON.parse(match[1].replaceAll('\\u003c', '<'));
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('PuterHomepageService.onServerStart', () => {
    const writeManifest = async (contents: string): Promise<string> => {
        const dir = await mkdtemp(path.join(tmpdir(), 'puter-homepage-'));
        await writeFile(path.join(dir, 'puter-gui.json'), contents, 'utf8');
        return dir;
    };

    it('does nothing when no assets root is configured', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await makeService().onServerStart();
        expect(warn).not.toHaveBeenCalled();
    });

    it('warns rather than throwing when the manifest is unreadable', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await makeService({
            gui_assets_root: path.join(tmpdir(), 'no-such-gui-root'),
        }).onServerStart();
        expect(warn).toHaveBeenCalledWith(
            '[homepage] failed to load puter-gui.json:',
            expect.anything(),
        );
    });

    it('warns when the manifest has no entry for the configured profile', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const root = await writeManifest('{"production":{}}');
        await makeService({
            gui_assets_root: root,
            gui_profile: 'development',
        }).onServerStart();
        expect(warn).toHaveBeenCalledWith(
            '[homepage] puter-gui.json has no profile "development"',
        );
    });

    it('renders the profile stylesheets when serving unbundled assets', async () => {
        const root = await writeManifest(
            '{"development":{"css_paths":["/src/a.css","/src/b.css"]}}',
        );
        const service = makeService({
            env: 'dev',
            gui_assets_root: root,
        });
        await service.onServerStart();

        const html = await render(service);
        expect(html).toContain('<link rel="stylesheet" href="/src/a.css">');
        expect(html).toContain('<link rel="stylesheet" href="/src/b.css">');
        // Unbundled: no prod css bundle, no gui_env marker.
        expect(html).not.toContain("window.gui_env = 'prod'");
        expect(html).toContain('href="/src/favicons/favicon-16x16.png"');
    });

    it('serves the bundle when dev explicitly opts into bundled assets', async () => {
        const root = await writeManifest(
            '{"development":{"css_paths":["/src/a.css"]}}',
        );
        const service = makeService({
            env: 'dev',
            use_bundled_gui: true,
            gui_assets_root: root,
            gui_css: '/dist/custom.css',
            gui_bundle: '/dist/custom.js',
        });
        await service.onServerStart();

        const html = await render(service);
        expect(html).toContain(
            '<link rel="stylesheet" href="/dist/custom.css">',
        );
        expect(html).toContain('<script src="/dist/custom.js"></script>');
        expect(html).toContain("window.gui_env = 'prod'");
        // Manifest css belongs to the unbundled path only.
        expect(html).not.toContain('/src/a.css');
        // …but the asset dir still follows `env`.
        expect(html).toContain('href="/src/favicons/favicon-16x16.png"');
    });
});

describe('PuterHomepageService.send — puter-in-puter guard', () => {
    it('renders the error page instead of the shell when nested in an app instance', async () => {
        const html = await render(
            makeService(),
            makeReq({ query: { 'puter.app_instance_id': 'x' } as never }),
        );
        expect(html).not.toContain('window.puter_gui_enabled');
        expect(html).toMatch(/<h1>.+<\/h1>/);
    });

    it('shows the supplied message, escaped', async () => {
        const html = await render(
            makeService(),
            makeReq({
                query: {
                    error_from_within_iframe: '1',
                    message: 'boom <script>',
                } as never,
            }),
        );
        expect(html).toContain('<h1>boom &lt;script&gt;</h1>');
        expect(html).not.toContain('window.puter_gui_enabled');
    });
});

describe('PuterHomepageService — gui() parameters', () => {
    it('carries config, request-derived origins and per-page meta', async () => {
        const service = makeService({
            api_base_url: 'https://api.puter.test',
            static_hosting_domain: 'site.puter.test',
        });
        const html = await render(service, makeReq({ path: '/app/x' }), {
            title: 'Editor',
            description: 'desc',
            app: { name: 'editor' },
        });

        const params = guiParamsOf(html);
        expect(params).toMatchObject({
            domain: 'puter.test',
            env: 'prod',
            api_base_url: 'https://api.puter.test',
            api_origin: 'https://api.puter.test',
            hosting_domain: 'site.puter.test',
            asset_dir: '/dist',
            title: 'Editor',
            app: { name: 'editor' },
            launch_options: {},
        });
        // No `config.origin`: fall back to the request's protocol + domain.
        expect(params.app_origin).toBe('http://puter.test');
        expect(params.gui_origin).toBe('http://puter.test');
    });

    it('prefers the configured origin over anything derived from the request', async () => {
        const service = makeService({ origin: 'https://puter.test:8443' });
        const params = guiParamsOf(await render(service));
        expect(params.app_origin).toBe('https://puter.test:8443');
    });

    it('falls back to the request hostname when no domain is configured', async () => {
        const service = makeService({ domain: undefined });
        const params = guiParamsOf(await render(service));
        expect(params.app_origin).toBe('http://req-host.test');
    });

    it('reports captcha requirements from config', async () => {
        expect(
            guiParamsOf(await render(makeService())).captchaRequired,
        ).toEqual({ login: false, signup: false });
        expect(
            guiParamsOf(
                await render(makeService({ captcha: { enabled: true } })),
            ).captchaRequired,
        ).toEqual({ login: true, signup: true });
    });

    it('disables temp users when signup is off or the operator asked for it', async () => {
        expect(
            guiParamsOf(await render(makeService())).disable_temp_users,
        ).toBe(false);
        expect(
            guiParamsOf(
                await render(makeService({ disable_user_signup: true })),
            ).disable_temp_users,
        ).toBe(true);
        // An operator-set gui_param must survive the config override.
        expect(
            guiParamsOf(
                await render(
                    makeService({
                        gui_params: { disable_temp_users: true, extra: 1 },
                    }),
                ),
            ),
        ).toMatchObject({ disable_temp_users: true, extra: 1 });
    });

    it('escapes `<` so the params payload cannot break out of the script tag', async () => {
        const service = makeService();
        service.setGuiParam('injected', '</script><img src=x>');
        const html = await render(service);
        expect(html).toContain('\\u003c/script>');
        expect(guiParamsOf(html).injected).toBe('</script><img src=x>');
    });

    it('passes launch options straight through', async () => {
        const params = guiParamsOf(
            await render(
                makeService(),
                makeReq(),
                { title: 'Puter' },
                {
                    on_initialized: [{ do: 'thing' }],
                },
            ),
        );
        expect(params.launch_options).toEqual({
            on_initialized: [{ do: 'thing' }],
        });
    });
});

describe('PuterHomepageService — extension hooks', () => {
    it('renders registered service scripts after the boot script', async () => {
        const service = makeService();
        service.registerScript('https://cdn.test/a.js');
        service.registerScript('https://cdn.test/b.js');
        const html = await render(service);
        expect(html).toContain(
            '<script type="module" src="https://cdn.test/a.js"></script>',
        );
        expect(html.indexOf('https://cdn.test/a.js')).toBeGreaterThan(
            html.indexOf('window.addEventListener'),
        );
    });

    it('splices addon markup into the four documented slots', async () => {
        const service = makeService({}, async (_key, event) => {
            const e = event as Record<string, string>;
            e.prependHeadContent = '<!--PREPEND-HEAD-->';
            e.headContent = '<!--HEAD-->';
            e.prependBodyContent = '<!--PREPEND-BODY-->';
            e.bodyContent = '<!--BODY-->';
        });
        const html = await render(service);

        expect(html).toContain('<!--PREPEND-HEAD-->');
        expect(html).toContain('<!--HEAD-->');
        expect(html).toContain('<!--PREPEND-BODY-->');
        expect(html).toContain('<!--BODY-->');
        expect(html.indexOf('<!--PREPEND-HEAD-->')).toBeLessThan(
            html.indexOf('<!--HEAD-->'),
        );
        expect(html.indexOf('<!--PREPEND-BODY-->')).toBeLessThan(
            html.indexOf('<!--BODY-->'),
        );
    });

    it('still renders the shell when an addon listener throws', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const service = makeService({}, async () => {
            throw new Error('addon exploded');
        });
        const html = await render(service);
        expect(html).toContain('window.puter_gui_enabled = true');
        expect(warn).toHaveBeenCalledWith(
            '[homepage] puter.gui.addons emit failed:',
            expect.anything(),
        );
    });
});

describe('PuterHomepageService — social image validation', () => {
    const ogImage = (html: string): string =>
        /<meta property="og:image" content="([^"]*)">/.exec(html)![1];

    it('falls back to the bundled screenshot when unset', async () => {
        expect(ogImage(await render(makeService()))).toBe(
            '/dist/images/screenshot.png',
        );
    });

    it('accepts an absolute https image URL', async () => {
        expect(
            ogImage(
                await render(makeService(), makeReq(), {
                    title: 'Puter',
                    social_media_image: 'https://cdn.test/card.png',
                }),
            ),
        ).toBe('https://cdn.test/card.png');
    });

    it('rejects a non-http scheme, an unparsable URL, and a non-image extension', async () => {
        for (const raw of [
            'javascript:alert(1)//x.png',
            'not a url',
            'https://cdn.test/card.svg',
        ]) {
            expect(
                ogImage(
                    await render(makeService(), makeReq(), {
                        title: 'Puter',
                        social_media_image: raw,
                    }),
                ),
                raw,
            ).toBe('/dist/images/screenshot.png');
        }
    });
});

describe('PuterHomepageService — head metadata', () => {
    it('escapes meta values and flattens newlines in descriptions', async () => {
        const html = await render(makeService(), makeReq(), {
            title: 'Ti<tle>',
            description: 'line one\nline two',
            company: 'A & B',
            canonical_url: 'https://puter.test/?a=1&b=2',
        });
        expect(html).toContain('<title>Ti&lt;tle&gt;</title>');
        expect(html).toContain('content="line one line two"');
        expect(html).toContain('content="A &amp; B"');
        expect(html).toContain(
            '<link rel="canonical" href="https://puter.test/?a=1&amp;b=2">',
        );
        // No explicit short description — falls back to the long one.
        expect(html).toContain(
            '<meta property="og:description" content="line one line two">',
        );
    });

    it('uses the short description for social cards when supplied', async () => {
        const html = await render(makeService(), makeReq(), {
            title: 'Puter',
            description: 'long',
            short_description: 'short',
        });
        expect(html).toContain(
            '<meta property="og:description" content="short">',
        );
        expect(html).toContain('<meta name="description" content="long">');
    });
});
