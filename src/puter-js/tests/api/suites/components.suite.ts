import { suite, type SuiteTest, type SuiteTestSpec } from '../harness/types.ts';

/**
 * The web components the SDK defines and registers itself
 * (`src/ui/registerComponents.js`) — the standalone fallback used when an app
 * runs outside the Puter desktop.
 *
 * These are the one justified exception to the "never write a per-platform
 * test" rule: a custom element cannot be defined, upgraded or rendered without
 * a DOM, so `customElements`, shadow roots and `document` simply do not exist
 * on the node and workerd runners. Every test here is pinned to the browser
 * runner rather than guarded at runtime, so the other two platforms report
 * them as skipped instead of silently passing an empty test.
 *
 * Note this is *not* `puter.ui.*` — the desktop-rendered surface is covered by
 * the Playwright harness in `tests/e2e/`.
 */
const browserOnly = (fn: SuiteTest): SuiteTestSpec => ({
    platforms: ['browser'],
    fn,
});

/** Tags `registerComponents` defines, in registration order. */
const COMPONENT_TAGS = [
    'puter-alert',
    'puter-prompt',
    'puter-notification',
    'puter-context-menu',
    'puter-spinner',
    'puter-menubar',
    'puter-color-picker',
    'puter-font-picker',
];

const raf = (): Promise<void> =>
    new Promise((resolve) => requestAnimationFrame(() => resolve()));

const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The runners share one page across the whole suite, so each test starts from
 * an empty body — that also runs `disconnectedCallback` on anything a previous
 * test left behind.
 */
const resetPage = (): void => {
    document.body.innerHTML = '';
};

type Mounted = HTMLElement & {
    shadowRoot: ShadowRoot;
    items?: unknown[];
    buttons?: unknown[];
    options?: unknown;
    open?: () => void;
    close?: () => void;
};

/**
 * Create, configure and connect a component. Properties have to be set before
 * the element is connected: `connectedCallback` renders straight away and only
 * some components re-render on a later property write.
 */
const mount = async (
    tag: string,
    init?: (el: Mounted) => void,
): Promise<Mounted> => {
    resetPage();
    const el = document.createElement(tag) as Mounted;
    init?.(el);
    document.body.appendChild(el);
    // Two frames: the components that finish setting up inside
    // requestAnimationFrame (spinner, menu placement) need one, and the
    // notification's entrance animation nests a second one.
    await raf();
    await raf();
    return el;
};

/** Details of every `name` event fired on `el`, in order. */
const recordEvents = (el: HTMLElement, name: string): unknown[] => {
    const seen: unknown[] = [];
    el.addEventListener(name, (e) => seen.push((e as CustomEvent).detail));
    return seen;
};

const shadowText = (el: Mounted, selector: string): string =>
    el.shadowRoot.querySelector(selector)?.textContent?.trim() ?? '';

const shadowAll = (el: Mounted, selector: string): Element[] =>
    Array.from(el.shadowRoot.querySelectorAll(selector));

const clickShadow = (el: Mounted, selector: string): void => {
    const target = el.shadowRoot.querySelector(selector);
    if (!target) throw new Error(`no element matching ${selector}`);
    (target as HTMLElement).click();
};

const typeInto = (input: HTMLInputElement, value: string): void => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
};

const pressKey = (target: EventTarget, key: string): void => {
    target.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
};

/** `data-index` of the currently focused entry, or null when none is. */
const focusedIndexOf = (
    el: Mounted,
    selector = '.menu-item',
): string | null => {
    const focused = el.shadowRoot.querySelector(`${selector}.focused`);
    return focused ? focused.getAttribute('data-index') : null;
};

export default suite('components', {
    // -- Registration and the shared base class ----------------------

    'every SDK component is registered and upgrades on creation': browserOnly(
        async (t) => {
            resetPage();
            for (const tag of COMPONENT_TAGS) {
                t.assert.equal(
                    typeof customElements.get(tag),
                    'function',
                    `${tag} should be defined`,
                );
                const el = document.createElement(tag) as Mounted;
                t.assert.ok(
                    el.shadowRoot,
                    `${tag} should attach a shadow root on construction`,
                );
                t.assert.equal(
                    el.shadowRoot.mode,
                    'open',
                    `${tag} shadow root should be open`,
                );
            }
        },
    ),

    'a component renders its styles and markup into the shadow root':
        browserOnly(async (t) => {
            const el = await mount('puter-spinner', (spinner) =>
                spinner.setAttribute('text', 'Loading things'),
            );
            t.assert.ok(
                el.shadowRoot.querySelector('style'),
                'styles should be injected into the shadow root',
            );
            t.assert.ok(
                el.shadowRoot.querySelector('.spinner'),
                'the component markup should be rendered',
            );
            t.assert.equal(
                document.body.textContent,
                '',
                'shadow content should not leak into the light DOM',
            );
        }),

    'a forced theme attribute wins over the system preference': browserOnly(
        async (t) => {
            const dark = await mount('puter-notification', (el) =>
                el.setAttribute('theme', 'dark'),
            );
            t.assert.ok(
                dark.classList.contains('puter-theme-dark'),
                'theme="dark" should mark the host dark',
            );

            dark.setAttribute('theme', 'light');
            // The theme is re-applied by a MutationObserver, so it lands on a
            // microtask rather than synchronously.
            await sleep(0);
            t.assert.ok(
                !dark.classList.contains('puter-theme-dark'),
                'theme="light" should clear the dark marker',
            );
        },
    ),

    'a disconnected component stops watching the theme': browserOnly(
        async (t) => {
            const el = await mount('puter-spinner', (spinner) =>
                spinner.setAttribute('theme', 'dark'),
            );
            t.assert.ok(el.classList.contains('puter-theme-dark'));

            el.remove();
            el.setAttribute('theme', 'light');
            await sleep(0);
            t.assert.ok(
                el.classList.contains('puter-theme-dark'),
                'the theme observer should be disconnected on teardown',
            );
        },
    ),

    // -- puter-spinner -----------------------------------------------

    'the spinner shows its text and drops it when unset': browserOnly(
        async (t) => {
            const withText = await mount('puter-spinner', (el) =>
                el.setAttribute('text', 'Uploading'),
            );
            t.assert.equal(shadowText(withText, '.text'), 'Uploading');
            t.assert.ok(
                withText.classList.contains('visible'),
                'the overlay should fade in after the first frame',
            );

            const bare = await mount('puter-spinner');
            t.assert.equal(
                bare.shadowRoot.querySelector('.text'),
                null,
                'no text node should be rendered without the attribute',
            );
        },
    ),

    'the spinner escapes its text instead of parsing it': browserOnly(
        async (t) => {
            const el = await mount('puter-spinner', (spinner) =>
                spinner.setAttribute('text', '<b>bold</b> & more'),
            );
            t.assert.equal(shadowText(el, '.text'), '<b>bold</b> & more');
            t.assert.equal(
                el.shadowRoot.querySelector('.text b'),
                null,
                'markup in the text must not become elements',
            );
        },
    ),

    'closing the spinner hides it and then detaches it': browserOnly(
        async (t) => {
            const el = await mount('puter-spinner');
            el.close!();
            t.assert.ok(
                !el.classList.contains('visible'),
                'close should start the fade out immediately',
            );
            t.assert.ok(el.isConnected, 'removal waits for the transition');
            await sleep(300);
            t.assert.ok(!el.isConnected, 'the overlay should be removed');
        },
    ),

    // -- puter-alert -------------------------------------------------

    'the alert renders one button per spec and makes the last primary':
        browserOnly(async (t) => {
            const el = await mount('puter-alert', (alert) => {
                alert.setAttribute('message', 'Delete this file?');
                alert.buttons = [
                    { label: 'Cancel', value: false },
                    { label: 'Delete', value: true },
                ];
            });

            const buttons = shadowAll(el, 'button');
            t.assert.equal(buttons.length, 2);
            t.assert.deepEqual(
                buttons.map((b) => b.textContent),
                ['Cancel', 'Delete'],
            );
            t.assert.ok(
                buttons[0].classList.contains('btn-default'),
                'leading buttons default to the neutral style',
            );
            t.assert.ok(
                buttons[1].classList.contains('btn-primary'),
                'the last button defaults to primary',
            );
            t.assert.equal(shadowText(el, '.message'), 'Delete this file?');
        }),

    'the alert reports the clicked button value and closes': browserOnly(
        async (t) => {
            const el = await mount('puter-alert', (alert) => {
                alert.setAttribute('message', 'Pick one');
                alert.buttons = [
                    { label: 'No', value: 'no' },
                    { label: 'Yes', value: 'yes' },
                ];
            });
            const responses = recordEvents(el, 'response');

            clickShadow(el, 'button.btn-primary');
            t.assert.deepEqual(responses, ['yes']);
            t.assert.ok(!el.isConnected, 'answering should close the alert');
        },
    ),

    'the alert falls back to a single OK button resolving true': browserOnly(
        async (t) => {
            const el = await mount('puter-alert', (alert) =>
                alert.setAttribute('message', 'Saved'),
            );
            const buttons = shadowAll(el, 'button');
            t.assert.equal(buttons.length, 1);
            t.assert.equal(buttons[0].textContent, 'OK');

            const responses = recordEvents(el, 'response');
            (buttons[0] as HTMLElement).click();
            t.assert.deepEqual(responses, [true]);
        },
    ),

    'a button with no value resolves its label': browserOnly(async (t) => {
        const el = await mount('puter-alert', (alert) => {
            alert.setAttribute('message', 'Choose');
            alert.buttons = [{ label: 'Later' }, { label: 'Now' }];
        });
        const responses = recordEvents(el, 'response');
        clickShadow(el, 'button.btn-primary');
        t.assert.deepEqual(responses, ['Now']);
    }),

    'a backdrop click dismisses the alert with no value': browserOnly(
        async (t) => {
            const el = await mount('puter-alert', (alert) =>
                alert.setAttribute('message', 'Dismiss me'),
            );
            const responses = recordEvents(el, 'response');
            // The handler keys off the dialog itself being the click target,
            // which is what the backdrop region reports.
            clickShadow(el, 'dialog');
            t.assert.equal(responses.length, 1);
            // The component reports "no answer" as an absent detail, which
            // CustomEvent normalizes to null on the way out.
            t.assert.equal(responses[0], null);
            t.assert.ok(!el.isConnected);
        },
    ),

    'the alert allows only its documented inline tags in a message':
        browserOnly(async (t) => {
            const el = await mount('puter-alert', (alert) =>
                alert.setAttribute(
                    'message',
                    '<strong>Careful</strong><br><script>alert(1)</script> a & b',
                ),
            );
            const message = el.shadowRoot.querySelector('.message')!;
            t.assert.ok(
                message.querySelector('strong'),
                '<strong> is part of the supported tag set',
            );
            t.assert.ok(
                message.querySelector('br'),
                '<br> is part of the supported tag set',
            );
            t.assert.equal(
                message.querySelector('script'),
                null,
                'other tags must stay inert text',
            );
            t.assert.ok(
                (message.textContent ?? '').includes('<script>alert(1)</script>'),
                `the script tag should survive as text, got ${message.textContent}`,
            );
            t.assert.ok((message.textContent ?? '').includes('a & b'));
        }),

    'the alert picks its icon by type and lets options override it':
        browserOnly(async (t) => {
            const error = await mount('puter-alert', (alert) => {
                alert.setAttribute('message', 'Broken');
                alert.setAttribute('type', 'error');
            });
            const errorIcon = error.shadowRoot
                .querySelector('.alert-icon')!
                .getAttribute('src');

            const success = await mount('puter-alert', (alert) => {
                alert.setAttribute('message', 'Done');
                alert.setAttribute('type', 'success');
            });
            const successIcon = success.shadowRoot
                .querySelector('.alert-icon')!
                .getAttribute('src');

            t.assert.ok(errorIcon, 'a default icon should be chosen');
            t.assert.ok(
                errorIcon !== successIcon,
                'each type should get its own default icon',
            );

            const custom = await mount('puter-alert', (alert) => {
                alert.setAttribute('message', 'Custom');
                alert.setAttribute('type', 'error');
                alert.options = { body_icon: 'https://example.com/icon.png' };
            });
            t.assert.equal(
                custom.shadowRoot
                    .querySelector('.alert-icon')!
                    .getAttribute('src'),
                'https://example.com/icon.png',
            );
        }),

    'opening the alert puts its dialog in modal state': browserOnly(
        async (t) => {
            const el = await mount('puter-alert', (alert) =>
                alert.setAttribute('message', 'Modal'),
            );
            const dialog = el.shadowRoot.querySelector(
                'dialog',
            ) as HTMLDialogElement;
            t.assert.equal(dialog.open, false, 'the dialog starts closed');
            el.open!();
            t.assert.equal(dialog.open, true);
            // A second open must not throw on an already-open dialog.
            el.open!();
            t.assert.equal(dialog.open, true);
            el.close!();
            t.assert.ok(!el.isConnected);
        },
    ),

    // -- puter-prompt ------------------------------------------------

    'the prompt seeds its input from the attributes': browserOnly(async (t) => {
        const el = await mount('puter-prompt', (prompt) => {
            prompt.setAttribute('message', 'Your name?');
            prompt.setAttribute('placeholder', 'e.g. Ada');
            prompt.setAttribute('default-value', 'Ada');
        });
        const input = el.shadowRoot.querySelector(
            '.prompt-input',
        ) as HTMLInputElement;
        t.assert.equal(shadowText(el, '.message'), 'Your name?');
        t.assert.equal(input.placeholder, 'e.g. Ada');
        t.assert.equal(input.value, 'Ada');
    }),

    'the prompt resolves the typed value and false on cancel': browserOnly(
        async (t) => {
            const ok = await mount('puter-prompt', (prompt) =>
                prompt.setAttribute('message', 'Name?'),
            );
            const okResponses = recordEvents(ok, 'response');
            const input = ok.shadowRoot.querySelector(
                '.prompt-input',
            ) as HTMLInputElement;
            input.value = 'Grace';
            clickShadow(ok, '.btn-ok');
            t.assert.deepEqual(okResponses, ['Grace']);
            t.assert.ok(!ok.isConnected);

            const cancelled = await mount('puter-prompt', (prompt) =>
                prompt.setAttribute('message', 'Name?'),
            );
            const cancelResponses = recordEvents(cancelled, 'response');
            clickShadow(cancelled, '.btn-cancel');
            t.assert.deepEqual(cancelResponses, [false]);
        },
    ),

    'the prompt submits on Enter and cancels on Escape': browserOnly(
        async (t) => {
            const submitted = await mount('puter-prompt', (prompt) =>
                prompt.setAttribute('message', 'Name?'),
            );
            const submittedResponses = recordEvents(submitted, 'response');
            const input = submitted.shadowRoot.querySelector(
                '.prompt-input',
            ) as HTMLInputElement;
            input.value = 'Enter wins';
            pressKey(input, 'Enter');
            t.assert.deepEqual(submittedResponses, ['Enter wins']);

            const escaped = await mount('puter-prompt', (prompt) =>
                prompt.setAttribute('message', 'Name?'),
            );
            const escapedResponses = recordEvents(escaped, 'response');
            pressKey(
                escaped.shadowRoot.querySelector('.prompt-input')!,
                'Escape',
            );
            t.assert.deepEqual(escapedResponses, [false]);
        },
    ),

    'a prompt backdrop click cancels': browserOnly(async (t) => {
        const el = await mount('puter-prompt', (prompt) =>
            prompt.setAttribute('message', 'Name?'),
        );
        const responses = recordEvents(el, 'response');
        clickShadow(el, 'dialog');
        t.assert.deepEqual(responses, [false]);
        t.assert.ok(!el.isConnected);
    }),

    // -- puter-notification ------------------------------------------

    'the notification renders its title, text and close control': browserOnly(
        async (t) => {
            const el = await mount('puter-notification', (n) => {
                n.setAttribute('title', 'Upload complete');
                n.setAttribute('text', '3 files copied');
                n.setAttribute('duration', '0');
            });
            t.assert.equal(shadowText(el, '.title'), 'Upload complete');
            t.assert.equal(shadowText(el, '.text'), '3 files copied');
            t.assert.equal(
                el.shadowRoot
                    .querySelector('.close-btn')!
                    .getAttribute('aria-label'),
                'Close',
            );
            t.assert.ok(
                el.classList.contains('visible'),
                'the notification should animate in',
            );
        },
    ),

    'the notification draws a type icon unless given one': browserOnly(
        async (t) => {
            const typed = await mount('puter-notification', (n) => {
                n.setAttribute('text', 'Heads up');
                n.setAttribute('type', 'warning');
                n.setAttribute('duration', '0');
            });
            t.assert.ok(
                typed.shadowRoot.querySelector('.icon-area svg'),
                'a type should select a built-in icon',
            );

            const custom = await mount('puter-notification', (n) => {
                n.setAttribute('text', 'Heads up');
                n.setAttribute('icon', 'https://example.com/i.png');
                n.setAttribute('duration', '0');
            });
            t.assert.equal(
                custom.shadowRoot
                    .querySelector('.icon-area img')!
                    .getAttribute('src'),
                'https://example.com/i.png',
            );
        },
    ),

    'clicking the notification body emits click, the close button dismisses':
        browserOnly(async (t) => {
            const el = await mount('puter-notification', (n) => {
                n.setAttribute('text', 'Tap me');
                n.setAttribute('duration', '0');
            });
            const clicks = recordEvents(el, 'click');
            const closes = recordEvents(el, 'close');
            // A native click also reaches the host (it is composed), so the
            // component's own notice is the one carrying an object detail.
            const reported = (): unknown[] =>
                clicks.filter((d) => d !== null && typeof d === 'object');

            clickShadow(el, '.notification');
            t.assert.equal(reported().length, 1, 'a body click should be reported');
            t.assert.equal(closes.length, 0, 'a body click should not dismiss');

            clickShadow(el, '.close-btn');
            await sleep(450);
            t.assert.equal(closes.length, 1, 'dismissing should emit close');
            t.assert.ok(!el.isConnected, 'the notification should be removed');
        }),

    'the notification auto-dismisses after its duration': browserOnly(
        async (t) => {
            const el = await mount('puter-notification', (n) => {
                n.setAttribute('text', 'Fleeting');
                n.setAttribute('duration', '20');
            });
            const closes = recordEvents(el, 'close');
            t.assert.ok(el.isConnected, 'it should still be up right away');
            await sleep(500);
            t.assert.equal(closes.length, 1);
            t.assert.ok(!el.isConnected);
        },
    ),

    'a zero duration keeps the notification up': browserOnly(async (t) => {
        const el = await mount('puter-notification', (n) => {
            n.setAttribute('text', 'Sticky');
            n.setAttribute('duration', '0');
        });
        await sleep(200);
        t.assert.ok(
            el.isConnected,
            'duration="0" should disable auto-dismissal',
        );
    }),

    // -- puter-color-picker ------------------------------------------

    'the color picker seeds from default-color and expands short hex':
        browserOnly(async (t) => {
            const el = await mount('puter-color-picker', (picker) =>
                picker.setAttribute('default-color', '#abc'),
            );
            const hexInput = el.shadowRoot.querySelector(
                '.hex-input',
            ) as HTMLInputElement;
            t.assert.equal(hexInput.value, '#AABBCC');
            t.assert.equal(
                (
                    el.shadowRoot.querySelector(
                        'input[type="color"]',
                    ) as HTMLInputElement
                ).value,
                '#aabbcc',
            );
        }),

    'the color picker resolves the chosen swatch': browserOnly(async (t) => {
        const el = await mount('puter-color-picker');
        const responses = recordEvents(el, 'response');
        const swatch = el.shadowRoot.querySelector(
            '.swatch[data-color="#ff0000"]',
        ) as HTMLElement;
        t.assert.ok(swatch, 'the preset palette should be rendered');
        swatch.click();
        t.assert.equal(
            (el.shadowRoot.querySelector('.hex-input') as HTMLInputElement)
                .value,
            '#FF0000',
            'a swatch click should mirror into the hex field',
        );

        clickShadow(el, '.btn-ok');
        t.assert.deepEqual(responses, ['#ff0000']);
        t.assert.ok(!el.isConnected);
    }),

    'a typed hex reaches the native input and the result': browserOnly(
        async (t) => {
            const el = await mount('puter-color-picker');
            const responses = recordEvents(el, 'response');
            const hexInput = el.shadowRoot.querySelector(
                '.hex-input',
            ) as HTMLInputElement;

            typeInto(hexInput, 'not a color');
            typeInto(hexInput, '#0f0');
            t.assert.equal(
                (
                    el.shadowRoot.querySelector(
                        'input[type="color"]',
                    ) as HTMLInputElement
                ).value,
                '#00ff00',
                'a valid hex should drive the native picker',
            );

            clickShadow(el, '.btn-ok');
            t.assert.deepEqual(
                responses,
                ['#00ff00'],
                'the invalid entry should have been ignored',
            );
        },
    ),

    'the color picker resolves null when cancelled': browserOnly(async (t) => {
        const el = await mount('puter-color-picker');
        const responses = recordEvents(el, 'response');
        clickShadow(el, '.btn-cancel');
        t.assert.deepEqual(responses, [null]);

        const dismissed = await mount('puter-color-picker');
        const dismissedResponses = recordEvents(dismissed, 'response');
        clickShadow(dismissed, 'dialog');
        t.assert.deepEqual(dismissedResponses, [null]);
    }),

    // -- puter-font-picker -------------------------------------------

    'the font picker preselects the default font': browserOnly(async (t) => {
        const el = await mount('puter-font-picker', (picker) =>
            picker.setAttribute('default-font', 'Georgia'),
        );
        const selected = shadowAll(el, '.font-item.selected');
        t.assert.equal(selected.length, 1, 'exactly one font is selected');
        t.assert.equal(selected[0].getAttribute('data-name'), 'Georgia');
        t.assert.ok(
            shadowAll(el, '.font-item').length > 5,
            'the curated catalogue should be listed',
        );
    }),

    'an unknown default font falls back to the first entry': browserOnly(
        async (t) => {
            const el = await mount('puter-font-picker', (picker) =>
                picker.setAttribute('default-font', 'Nonexistent Face'),
            );
            t.assert.equal(
                el.shadowRoot
                    .querySelector('.font-item.selected')!
                    .getAttribute('data-name'),
                'System UI',
            );
        },
    ),

    'the font picker filters by name and by category': browserOnly(
        async (t) => {
            const el = await mount('puter-font-picker');
            const total = shadowAll(el, '.font-item').length;
            const search = el.shadowRoot.querySelector(
                '.search',
            ) as HTMLInputElement;

            typeInto(search, 'courier');
            const byName = shadowAll(el, '.font-item').map((i) =>
                i.getAttribute('data-name'),
            );
            t.assert.deepEqual(byName, ['Courier New']);

            typeInto(search, 'monospace');
            const byCategory = shadowAll(el, '.font-item').length;
            t.assert.ok(
                byCategory > 1 && byCategory < total,
                `a category query should narrow the list, got ${byCategory} of ${total}`,
            );

            typeInto(search, 'zzz-no-such-font');
            t.assert.equal(shadowAll(el, '.font-item').length, 0);
        },
    ),

    'the font picker resolves the family of the clicked font': browserOnly(
        async (t) => {
            const el = await mount('puter-font-picker');
            const responses = recordEvents(el, 'response');
            const georgia = el.shadowRoot.querySelector(
                '.font-item[data-name="Georgia"]',
            ) as HTMLElement;
            georgia.click();
            t.assert.ok(
                georgia.classList.contains('selected'),
                'clicking should move the selection',
            );
            t.assert.equal(shadowAll(el, '.font-item.selected').length, 1);

            clickShadow(el, '.btn-ok');
            t.assert.deepEqual(responses, [{ fontFamily: 'Georgia, serif' }]);
            t.assert.ok(!el.isConnected);
        },
    ),

    'a filtered font stays clickable after the list is rebuilt': browserOnly(
        async (t) => {
            const el = await mount('puter-font-picker');
            const responses = recordEvents(el, 'response');
            typeInto(
                el.shadowRoot.querySelector('.search') as HTMLInputElement,
                'georgia',
            );
            clickShadow(el, '.font-item[data-name="Georgia"]');
            clickShadow(el, '.btn-ok');
            t.assert.deepEqual(responses, [{ fontFamily: 'Georgia, serif' }]);
        },
    ),

    'the font picker resolves null when cancelled': browserOnly(async (t) => {
        const el = await mount('puter-font-picker');
        const responses = recordEvents(el, 'response');
        clickShadow(el, '.btn-cancel');
        t.assert.deepEqual(responses, [null]);
    }),

    // -- puter-context-menu ------------------------------------------

    'the context menu renders items, dividers and disabled entries':
        browserOnly(async (t) => {
            const el = await mount('puter-context-menu', (menu) => {
                menu.items = [
                    { label: 'Open' },
                    '-',
                    { label: 'Rename', disabled: true },
                    { separator: true },
                    { label: 'Delete', type: 'danger' },
                ];
            });

            t.assert.deepEqual(
                shadowAll(el, '.menu-item:not(.divider) .label').map(
                    (n) => n.textContent,
                ),
                ['Open', 'Rename', 'Delete'],
            );
            t.assert.equal(
                shadowAll(el, '.menu-item.divider').length,
                2,
                `both "-" and { separator } should draw a divider`,
            );
            t.assert.equal(shadowAll(el, '.menu-item.disabled').length, 1);
            t.assert.equal(shadowAll(el, '.menu-item.danger').length, 1);
        }),

    'the context menu reserves a check column and marks checked items':
        browserOnly(async (t) => {
            const el = await mount('puter-context-menu', (menu) => {
                menu.items = [
                    { label: 'Word wrap', checked: true },
                    { label: 'Line numbers', checked: false },
                    { label: 'Plain' },
                ];
            });
            const checks = shadowAll(el, '.menu-item .check');
            t.assert.equal(checks.length, 2);
            t.assert.equal(checks[0].textContent, '✓');
            t.assert.equal(checks[1].textContent, '');
            t.assert.equal(
                shadowAll(el, '.menu-item .icon').length,
                1,
                'items with neither icon nor check keep the column reserved',
            );
        }),

    'the context menu takes an icon as markup or as a URL': browserOnly(
        async (t) => {
            const el = await mount('puter-context-menu', (menu) => {
                menu.items = [
                    { label: 'Inline', icon: '<svg viewBox="0 0 1 1"></svg>' },
                    { label: 'Remote', icon: 'https://example.com/i.png' },
                ];
            });
            t.assert.ok(
                el.shadowRoot.querySelector('.menu-item .icon svg'),
                'markup icons should be inlined',
            );
            t.assert.equal(
                el.shadowRoot
                    .querySelector('.menu-item .icon img')!
                    .getAttribute('src'),
                'https://example.com/i.png',
            );
        },
    ),

    'choosing an item runs its action then emits select and close':
        browserOnly(async (t) => {
            let ran = 0;
            const el = await mount('puter-context-menu', (menu) => {
                menu.items = [
                    { label: 'Copy', action: () => { ran += 1; } },
                    { label: 'Paste' },
                ];
            });
            const selects = recordEvents(el, 'select');
            const closes = recordEvents(el, 'close');

            clickShadow(el, '.menu-item:not(.divider)');
            t.assert.equal(ran, 1, 'the item action should run exactly once');
            t.assert.equal(selects.length, 1);
            t.assert.equal(
                (selects[0] as { label?: string }).label,
                'Copy',
                'select should carry the chosen item',
            );
            t.assert.equal(closes.length, 1, 'choosing should close the menu');
        }),

    'a disabled item cannot be chosen': browserOnly(async (t) => {
        let ran = 0;
        const el = await mount('puter-context-menu', (menu) => {
            menu.items = [
                { label: 'Undo', disabled: true, action: () => { ran += 1; } },
            ];
        });
        const selects = recordEvents(el, 'select');
        clickShadow(el, '.menu-item.disabled');
        t.assert.equal(ran, 0, 'a disabled action must not run');
        t.assert.equal(selects.length, 0);
    }),

    'the context menu positions itself from its x and y attributes':
        browserOnly(async (t) => {
            const el = await mount('puter-context-menu', (menu) => {
                menu.items = [{ label: 'Only' }];
                menu.setAttribute('x', '42');
                menu.setAttribute('y', '84');
            });
            t.assert.equal(el.style.left, '42px');
            t.assert.equal(el.style.top, '84px');
        }),

    'the context menu escapes labels and shortcuts': browserOnly(async (t) => {
        const el = await mount('puter-context-menu', (menu) => {
            menu.items = [{ label: '<img src=x>', shortcut: 'Ctrl+S' }];
        });
        const label = el.shadowRoot.querySelector('.menu-item .label')!;
        t.assert.equal(label.textContent, '<img src=x>');
        t.assert.equal(
            el.shadowRoot.querySelector('.menu-item .label img'),
            null,
            'a label must never become markup',
        );
        t.assert.ok(shadowText(el, '.menu-item .shortcut').length > 0);
    }),

    'replacing the items of a mounted context menu re-renders it': browserOnly(
        async (t) => {
            const el = await mount('puter-context-menu', (menu) => {
                menu.items = [{ label: 'First' }];
            });
            t.assert.deepEqual(
                shadowAll(el, '.menu-item .label').map((n) => n.textContent),
                ['First'],
            );

            el.items = [{ label: 'Second' }, { label: 'Third' }];
            t.assert.deepEqual(
                shadowAll(el, '.menu-item .label').map((n) => n.textContent),
                ['Second', 'Third'],
            );
        },
    ),

    'an item with a submenu opens a nested menu instead of choosing':
        browserOnly(async (t) => {
            const el = await mount('puter-context-menu', (menu) => {
                menu.items = [
                    { label: 'New', items: [{ label: 'Folder' }] },
                    { label: 'Refresh' },
                ];
            });
            const selects = recordEvents(el, 'select');

            clickShadow(el, '.menu-item:not(.divider)');
            await raf();
            const submenus = Array.from(
                document.querySelectorAll('puter-context-menu'),
            );
            t.assert.equal(
                submenus.length,
                2,
                'the parent plus its submenu should be in the document',
            );
            t.assert.equal(
                selects.length,
                0,
                'opening a submenu is not a selection',
            );

            const submenu = submenus.find((m) => m !== el) as Mounted;
            t.assert.deepEqual(
                shadowAll(submenu, '.menu-item .label').map(
                    (n) => n.textContent,
                ),
                ['Folder'],
            );
        }),

    // -- puter-menubar -----------------------------------------------

    'the menubar renders one button per top-level item': browserOnly(
        async (t) => {
            const el = await mount('puter-menubar', (menubar) => {
                menubar.items = [
                    { label: 'File', items: [{ label: 'New' }] },
                    { label: 'Edit', items: [{ label: 'Undo' }] },
                ];
            });
            t.assert.deepEqual(
                shadowAll(el, '.menu-button').map((b) => b.textContent),
                ['File', 'Edit'],
            );
            t.assert.deepEqual(
                shadowAll(el, '.menu-button').map((b) =>
                    b.getAttribute('data-index'),
                ),
                ['0', '1'],
            );
        },
    ),

    'replacing the items of a mounted menubar re-renders it': browserOnly(
        async (t) => {
            const el = await mount('puter-menubar', (menubar) => {
                menubar.items = [{ label: 'File', items: [{ label: 'New' }] }];
            });
            el.items = [
                { label: 'View', items: [{ label: 'Zoom' }] },
                { label: 'Help', items: [{ label: 'About' }] },
            ];
            t.assert.deepEqual(
                shadowAll(el, '.menu-button').map((b) => b.textContent),
                ['View', 'Help'],
            );
        },
    ),

    'a top-level menubar item with an action fires it directly': browserOnly(
        async (t) => {
            let ran = 0;
            const el = await mount('puter-menubar', (menubar) => {
                menubar.items = [{ label: 'Save', action: () => { ran += 1; } }];
            });
            const selects = recordEvents(el, 'select');

            clickShadow(el, '.menu-button');
            t.assert.equal(ran, 1);
            t.assert.equal((selects[0] as { label?: string })?.label, 'Save');
            t.assert.equal(
                document.querySelectorAll('puter-context-menu').length,
                0,
                'an action-only item should not open a dropdown',
            );
        },
    ),

    'opening a menubar dropdown and choosing an item reports the selection':
        browserOnly(async (t) => {
            let ran = 0;
            const el = await mount('puter-menubar', (menubar) => {
                menubar.items = [
                    {
                        label: 'File',
                        items: [
                            { label: 'New', action: () => { ran += 1; } },
                            { label: 'Open' },
                        ],
                    },
                ];
            });
            const selects = recordEvents(el, 'select');

            clickShadow(el, '.menu-button');
            await raf();
            const dropdown = document.querySelector(
                'puter-context-menu',
            ) as Mounted;
            t.assert.ok(dropdown, 'the dropdown should be attached to the body');
            t.assert.ok(
                el.shadowRoot
                    .querySelector('.menu-button')!
                    .classList.contains('active'),
                'the open button should be marked active',
            );

            clickShadow(dropdown, '.menu-item:not(.divider)');
            await raf();
            t.assert.equal(ran, 1, 'the dropdown item action should run');
            t.assert.equal((selects[0] as { label?: string })?.label, 'New');
            t.assert.equal(
                document.querySelectorAll('puter-context-menu').length,
                0,
                'choosing should tear the dropdown down',
            );
        }),

    'disconnecting the menubar closes its open dropdown': browserOnly(
        async (t) => {
            const el = await mount('puter-menubar', (menubar) => {
                menubar.items = [
                    { label: 'File', items: [{ label: 'New' }] },
                ];
            });
            clickShadow(el, '.menu-button');
            await raf();
            t.assert.equal(
                document.querySelectorAll('puter-context-menu').length,
                1,
            );

            el.remove();
            await raf();
            t.assert.equal(
                document.querySelectorAll('puter-context-menu').length,
                0,
                'teardown should not leave a dropdown behind',
            );
        },
    ),

    'the menubar escapes item labels': browserOnly(async (t) => {
        const el = await mount('puter-menubar', (menubar) => {
            menubar.items = [{ label: '<b>File</b>', items: [{ label: 'New' }] }];
        });
        const button = el.shadowRoot.querySelector('.menu-button')!;
        t.assert.equal(button.textContent, '<b>File</b>');
        t.assert.equal(button.querySelector('b'), null);
    }),

    // -- Keyboard driving --------------------------------------------
    //
    // Both menus listen on `document` in the capture phase, so a keydown
    // dispatched at the document reaches them exactly as a real one would.

    'arrow keys walk the context menu and skip dividers and disabled items':
        browserOnly(async (t) => {
            const el = await mount('puter-context-menu', (menu) => {
                menu.items = [
                    { label: 'Open' },
                    '-',
                    { label: 'Rename', disabled: true },
                    { label: 'Delete' },
                ];
            });

            const navigations = recordEvents(el, 'puter-menu-navigate');

            pressKey(document, 'ArrowDown');
            t.assert.equal(focusedIndexOf(el), '0');
            pressKey(document, 'ArrowDown');
            t.assert.equal(
                focusedIndexOf(el),
                '3',
                'the divider and the disabled item should be stepped over',
            );
            pressKey(document, 'ArrowUp');
            t.assert.equal(focusedIndexOf(el), '0');
            pressKey(document, 'ArrowDown');
            t.assert.equal(
                focusedIndexOf(el),
                '3',
                'ArrowDown should wrap from the last item',
            );
            t.assert.equal(
                navigations.length,
                0,
                'walking inside the menu should stay inside the menu',
            );

            // ArrowUp on the first item deliberately does not wrap: a root
            // menu hands the key up to whatever opened it (the menubar).
            pressKey(document, 'ArrowDown');
            t.assert.equal(focusedIndexOf(el), '0');
            pressKey(document, 'ArrowUp');
            t.assert.equal(focusedIndexOf(el), '0');
            t.assert.deepEqual(navigations, [{ direction: 'up' }]);
        }),

    'Home and End jump to the first and last selectable items': browserOnly(
        async (t) => {
            const el = await mount('puter-context-menu', (menu) => {
                menu.items = [
                    { label: 'First' },
                    { label: 'Middle' },
                    { label: 'Last' },
                    { separator: true },
                ];
            });

            pressKey(document, 'End');
            t.assert.equal(focusedIndexOf(el), '2');
            pressKey(document, 'Home');
            t.assert.equal(focusedIndexOf(el), '0');
        },
    ),

    'Enter chooses the focused context menu item': browserOnly(async (t) => {
        let ran = 0;
        const el = await mount('puter-context-menu', (menu) => {
            menu.items = [
                { label: 'Cut' },
                { label: 'Copy', action: () => { ran += 1; } },
            ];
        });
        const selects = recordEvents(el, 'select');

        pressKey(document, 'ArrowDown');
        pressKey(document, 'ArrowDown');
        t.assert.equal(focusedIndexOf(el), '1');
        pressKey(document, 'Enter');

        t.assert.equal(ran, 1);
        t.assert.equal((selects[0] as { label?: string })?.label, 'Copy');
        t.assert.ok(!el.isConnected, 'activating should close the menu');
    }),

    'Escape and Tab close the context menu without choosing': browserOnly(
        async (t) => {
            const escaped = await mount('puter-context-menu', (menu) => {
                menu.items = [{ label: 'Only' }];
            });
            const escapedSelects = recordEvents(escaped, 'select');
            const escapedCloses = recordEvents(escaped, 'close');
            pressKey(document, 'Escape');
            t.assert.equal(escapedSelects.length, 0);
            t.assert.equal(escapedCloses.length, 1);

            const tabbed = await mount('puter-context-menu', (menu) => {
                menu.items = [{ label: 'Only' }];
            });
            const tabbedCloses = recordEvents(tabbed, 'close');
            pressKey(document, 'Tab');
            t.assert.equal(tabbedCloses.length, 1);
        },
    ),

    'typing a letter jumps to the matching context menu item': browserOnly(
        async (t) => {
            const el = await mount('puter-context-menu', (menu) => {
                menu.items = [
                    { label: 'New' },
                    { label: 'Open' },
                    { label: 'Print' },
                ];
            });

            pressKey(document, 'p');
            t.assert.equal(focusedIndexOf(el), '2');
            pressKey(document, 'o');
            t.assert.equal(
                focusedIndexOf(el),
                '1',
                'a later letter should keep searching from the current item',
            );
        },
    ),

    'a modifier keypress passes through the context menu': browserOnly(
        async (t) => {
            const el = await mount('puter-context-menu', (menu) => {
                menu.items = [{ label: 'Save' }];
            });
            document.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 's',
                    ctrlKey: true,
                    bubbles: true,
                    cancelable: true,
                }),
            );
            t.assert.equal(
                focusedIndexOf(el),
                null,
                'a host shortcut must not be swallowed as typeahead',
            );
            t.assert.ok(el.isConnected);
        },
    ),

    'a pointerdown outside the context menu closes it': browserOnly(
        async (t) => {
            const el = await mount('puter-context-menu', (menu) => {
                menu.items = [{ label: 'Only' }];
            });
            const closes = recordEvents(el, 'close');
            // The outside handler is armed on a macrotask so the very click
            // that opened the menu can't immediately dismiss it.
            await sleep(10);

            const outside = document.createElement('div');
            document.body.appendChild(outside);
            outside.dispatchEvent(
                new PointerEvent('pointerdown', { bubbles: true }),
            );
            t.assert.equal(closes.length, 1);
            t.assert.ok(!el.isConnected);
        },
    ),

    'a pointerdown inside the context menu leaves it open': browserOnly(
        async (t) => {
            const el = await mount('puter-context-menu', (menu) => {
                menu.items = [{ label: 'Only' }];
            });
            const closes = recordEvents(el, 'close');
            await sleep(10);

            el.shadowRoot
                .querySelector('.menu-item')!
                .dispatchEvent(
                    new PointerEvent('pointerdown', {
                        bubbles: true,
                        composed: true,
                    }),
                );
            t.assert.equal(closes.length, 0);
            t.assert.ok(el.isConnected);
        },
    ),

    'ArrowRight opens the focused submenu and ArrowLeft returns to it':
        browserOnly(async (t) => {
            const el = await mount('puter-context-menu', (menu) => {
                menu.items = [
                    { label: 'New', items: [{ label: 'Folder' }] },
                    { label: 'Refresh' },
                ];
            });

            pressKey(document, 'ArrowDown');
            pressKey(document, 'ArrowRight');
            await raf();
            const menus = Array.from(
                document.querySelectorAll('puter-context-menu'),
            );
            t.assert.equal(menus.length, 2, 'the submenu should be attached');

            pressKey(document, 'ArrowLeft');
            await raf();
            t.assert.equal(
                document.querySelectorAll('puter-context-menu').length,
                1,
                'ArrowLeft should collapse back to the parent',
            );
            t.assert.equal(
                focusedIndexOf(el),
                '0',
                'the parent item should regain focus',
            );
        }),

    'F10 activates the menubar and arrows move between its buttons':
        browserOnly(async (t) => {
            const el = await mount('puter-menubar', (menubar) => {
                menubar.items = [
                    { label: 'File', items: [{ label: 'New' }] },
                    { label: 'Edit', items: [{ label: 'Undo' }] },
                    { label: 'View', items: [{ label: 'Zoom' }] },
                ];
            });

            pressKey(document, 'F10');
            t.assert.equal(
                focusedIndexOf(el, '.menu-button'),
                '0',
                'F10 should focus the first menu',
            );

            pressKey(document, 'Escape');
            t.assert.equal(
                focusedIndexOf(el, '.menu-button'),
                null,
                'Escape should give focus back to the app',
            );

            pressKey(document, 'F10');
            pressKey(document, 'F10');
            t.assert.equal(
                focusedIndexOf(el, '.menu-button'),
                null,
                'F10 should toggle rather than re-activate',
            );
        }),

    'Enter on an active menubar opens the focused dropdown': browserOnly(
        async (t) => {
            const el = await mount('puter-menubar', (menubar) => {
                menubar.items = [
                    { label: 'File', items: [{ label: 'New' }] },
                    { label: 'Edit', items: [{ label: 'Undo' }] },
                ];
            });

            pressKey(document, 'F10');
            pressKey(document, 'Enter');
            await raf();
            const dropdown = document.querySelector(
                'puter-context-menu',
            ) as Mounted;
            t.assert.ok(dropdown, 'Enter should open the focused menu');
            t.assert.deepEqual(
                shadowAll(dropdown, '.menu-item .label').map(
                    (n) => n.textContent,
                ),
                ['New'],
            );
        },
    ),

    'a tapped Alt toggles menubar focus': browserOnly(async (t) => {
        const el = await mount('puter-menubar', (menubar) => {
            menubar.items = [{ label: 'File', items: [{ label: 'New' }] }];
        });

        pressKey(document, 'Alt');
        document.dispatchEvent(
            new KeyboardEvent('keyup', {
                key: 'Alt',
                bubbles: true,
                cancelable: true,
            }),
        );
        t.assert.equal(focusedIndexOf(el, '.menu-button'), '0');

        // Alt used as part of a combination must not toggle the menubar.
        pressKey(document, 'Escape');
        pressKey(document, 'Alt');
        pressKey(document, 'f');
        document.dispatchEvent(
            new KeyboardEvent('keyup', {
                key: 'Alt',
                bubbles: true,
                cancelable: true,
            }),
        );
        t.assert.equal(focusedIndexOf(el, '.menu-button'), null);
    }),

    'an empty menubar cannot be activated': browserOnly(async (t) => {
        const el = await mount('puter-menubar', (menubar) => {
            menubar.items = [];
        });
        t.assert.equal(shadowAll(el, '.menu-button').length, 0);
        pressKey(document, 'F10');
        t.assert.equal(focusedIndexOf(el, '.menu-button'), null);
    }),
});
