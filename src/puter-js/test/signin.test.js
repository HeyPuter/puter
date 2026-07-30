/* eslint-disable */
// TODO: Make these more compatible with eslint
//
// Cross-origin sign-in. These only mean anything when this page is served from
// an origin that ISN'T the Puter GUI — `npm run test` in src/puter-js serves it
// on http://localhost:8080 while the GUI is on http://puter.localhost:4100, so
// `puter.env` is 'web' and `signIn()` goes through a real popup on the GUI
// origin. Opened from the GUI's own origin they prove nothing; the first test
// checks that and bails.
//
// Hand-run these ONE AT A TIME: three of the four open a popup and need you to
// complete (or dismiss) a sign-in, so they can't run unattended.
//
// Two shapes exist and they deliver the token by completely different means:
//
//   - default          — popup posts `puter.token` back via postMessage.
//   - cross-origin-isolated — COOP severs `window.opener`, so the popup can't
//     post anything. It POSTs the token to `/login/set` instead and the SDK
//     collects it by long-polling `/login/wait`. This is the path that broke:
//     every failure in it used to surface as the popup alerting "Couldn't sign
//     you in. Please try again." with no cause anywhere.
window.signinTests = [
    {
        name: "testSignInIsCrossOrigin",
        description: "Harness sanity check: this page is cross-origin to the GUI (env=web)",
        test: async function() {
            try {
                const guiOrigin = puter.defaultGUIOrigin;
                assert(typeof guiOrigin === 'string' && guiOrigin.length > 0,
                    "puter.defaultGUIOrigin is unset — the SDK has no popup target");
                assert(window.location.origin !== guiOrigin,
                    `this page is served from the GUI origin (${guiOrigin}); serve it elsewhere ` +
                    `(cd src/puter-js && npm run test) or these tests prove nothing`);
                assert(puter.env === 'web',
                    `expected env 'web' for a third-party page, got '${puter.env}'`);
                pass(`testSignInIsCrossOrigin passed: page=${window.location.origin} gui=${guiOrigin} api=${puter.APIOrigin}`);
            } catch (error) {
                fail("testSignInIsCrossOrigin failed:", error);
            }
        }
    },
    {
        name: "testSignInPostMessage",
        description: "[interactive] signIn() resolves with a token over the default postMessage path",
        test: async function() {
            try {
                const result = await puter.auth.signIn();
                assert(result && result.success === true,
                    "signIn did not resolve with success:true — got " + JSON.stringify(result));
                assert(typeof result.token === 'string' && result.token.length > 0,
                    "signIn resolved without a token");
                // The SDK is supposed to adopt the token, not just hand it back.
                assert(puter.authToken === result.token,
                    "signIn resolved but puter.authToken was not set to the returned token");
                assert(puter.auth.isSignedIn(), "isSignedIn() is false after a successful signIn");
                pass("testSignInPostMessage passed as " + (result.username ?? '(unknown user)'));
            } catch (error) {
                // `auth_window_closed` means the popup was dismissed rather
                // than completed — that's an aborted run, not a product bug,
                // so say so instead of reporting a failure the code caused.
                if (error && error.error === 'auth_window_closed') {
                    fail("testSignInPostMessage was not completed: the popup was closed before sign-in finished. Re-run and complete it.", error);
                }
                if (error && error.error === 'popup_blocked') {
                    fail("testSignInPostMessage could not run: the browser blocked the popup. Allow popups for this origin.", error);
                }
                fail("testSignInPostMessage failed:", error);
            }
        }
    },
    {
        name: "testSignInCrossOriginIsolatedRelay",
        description: "[interactive] signIn() resolves via the /login/set + /login/wait relay (forces the cross-origin-isolated path)",
        test: async function() {
            // `http-server` sends no COOP/COEP, so `window.crossOriginIsolated`
            // is false here and the SDK would take the postMessage path. Shadow
            // the getter to force the relay branch — the same trick the
            // Playwright specs use for `navigator.userActivation`. The GUI side
            // is driven by the `cross_origin_isolated=true` URL parameter the
            // SDK adds off this flag, so the popup genuinely runs its isolated
            // branch and really does POST to `/login/set`.
            //
            // This does NOT reproduce COOP severing `window.opener`, so it
            // exercises the relay's delivery, not the reason the relay exists.
            const hadOwn = Object.prototype.hasOwnProperty.call(window, 'crossOriginIsolated');
            const ownDescriptor = hadOwn
                ? Object.getOwnPropertyDescriptor(window, 'crossOriginIsolated')
                : null;
            let relayObserved = false;
            // The relay long-poll goes out through the SDK's `fetchUrl`, which
            // is an XHR-based replacement for fetch — hooking only `window.fetch`
            // sees nothing. Both are hooked so this keeps working if the SDK's
            // transport changes.
            const realFetch = window.fetch;
            const realXhrOpen = XMLHttpRequest.prototype.open;
            const noteUrl = (url) => {
                if (typeof url === 'string' && url.includes('/login/wait')) relayObserved = true;
            };

            try {
                Object.defineProperty(window, 'crossOriginIsolated', {
                    value: true,
                    configurable: true,
                    writable: false,
                });
                assert(window.crossOriginIsolated === true,
                    "could not shadow window.crossOriginIsolated — this browser won't let the isolated path be forced");

                // Watch for the long-poll so a pass can't be claimed by the
                // postMessage path quietly handling it instead.
                XMLHttpRequest.prototype.open = function(method, url, ...rest) {
                    try { noteUrl(url); } catch (e) { /* never let instrumentation break the call */ }
                    return realXhrOpen.call(this, method, url, ...rest);
                };
                window.fetch = function(resource, ...rest) {
                    try {
                        noteUrl(typeof resource === 'string' ? resource : resource?.url);
                    } catch (e) { /* never let instrumentation break the call */ }
                    return realFetch.call(this, resource, ...rest);
                };

                const result = await puter.auth.signIn();

                assert(result && result.success === true,
                    "signIn did not resolve with success:true — got " + JSON.stringify(result));
                assert(typeof result.token === 'string' && result.token.length > 0,
                    "signIn resolved without a token");
                assert(puter.authToken === result.token,
                    "signIn resolved but puter.authToken was not set to the returned token");
                assert(relayObserved,
                    "no /login/wait request was seen — the token did not come through the relay, " +
                    "so the isolated path was not actually exercised");
                pass("testSignInCrossOriginIsolatedRelay passed: token arrived via /login/wait");
            } catch (error) {
                if (error && error.error === 'auth_window_closed') {
                    fail("testSignInCrossOriginIsolatedRelay was not completed: the popup was closed before sign-in finished. Re-run and complete it.", error);
                }
                if (error && error.error === 'popup_blocked') {
                    fail("testSignInCrossOriginIsolatedRelay could not run: the browser blocked the popup. Allow popups for this origin.", error);
                }
                // The isolated path has no popup-closed watchdog, so a failure
                // on the GUI side never reaches this promise — it just never
                // settles and the harness times out. If the popup showed
                // "Couldn't sign you in", the cause is in ITS console, not here.
                fail("testSignInCrossOriginIsolatedRelay failed (if the popup alerted \"Couldn't sign you in\", check the popup's console for the real cause):", error);
            } finally {
                window.fetch = realFetch;
                XMLHttpRequest.prototype.open = realXhrOpen;
                if (hadOwn && ownDescriptor) {
                    Object.defineProperty(window, 'crossOriginIsolated', ownDescriptor);
                } else {
                    // Drop the shadow so the real (prototype) getter is visible again.
                    delete window.crossOriginIsolated;
                }
            }
        }
    },
    {
        name: "testSignInRelayContract",
        description: "Non-interactive: /login/wait and /login/set reject a session id that isn't a UUID",
        test: async function() {
            // The two halves of the relay, checked without a popup. Only the
            // input contract is asserted, because what a *valid* session id
            // returns is deliberately different before and after the audience
            // check that binds a relayed token to the collecting origin: a
            // caller that isn't the app the token was minted for gets the same
            // 408 as "nothing arrived". Asserting a successful round-trip here
            // would therefore start failing the moment that lands, so don't.
            try {
                const post = async (path, body) => {
                    const resp = await fetch(`${puter.APIOrigin}${path}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                    });
                    return resp;
                };

                const waitBad = await post('/login/wait', { session: 'not-a-uuid' });
                assert(waitBad.status === 400,
                    `/login/wait should reject a non-UUID session with 400, got ${waitBad.status}`);

                const waitMissing = await post('/login/wait', {});
                assert(waitMissing.status === 400,
                    `/login/wait should reject a missing session with 400, got ${waitMissing.status}`);

                // A guessable/attacker-chosen id is the whole reason the id is
                // validated and the relay is origin-bound; a non-UUID must
                // never open a channel.
                const setBad = await post('/login/set', { session: 'not-a-uuid', auth_token: 'x' });
                assert(setBad.status === 400,
                    `/login/set should reject a non-UUID session with 400, got ${setBad.status}`);

                const setNoToken = await post('/login/set', { session: crypto.randomUUID() });
                assert(setNoToken.status === 400,
                    `/login/set should reject a missing auth_token with 400, got ${setNoToken.status}`);

                pass("testSignInRelayContract passed: both relay endpoints validate their input");
            } catch (error) {
                fail("testSignInRelayContract failed:", error);
            }
        }
    },
    {
        name: "testSignInConsentDialogWithoutGesture",
        description: "[interactive] with no user activation, signIn() shows the consent dialog instead of being popup-blocked",
        test: async function() {
            // Clicking "Run Test" grants user activation, and the SDK opens the
            // popup directly when it has one. Wait it out first: activation
            // expires after a few seconds, and the no-gesture path is the one
            // that has to put up a consent dialog so the popup can be opened
            // from a click on THAT — otherwise the browser blocks it.
            try {
                if (!navigator.userActivation) {
                    fail("testSignInConsentDialogWithoutGesture skipped: this browser has no navigator.userActivation, so the no-gesture path can't be identified");
                }

                // Don't touch the page while this runs, or activation returns.
                const deadline = Date.now() + 15000;
                while (navigator.userActivation.isActive && Date.now() < deadline) {
                    await new Promise(r => setTimeout(r, 500));
                }
                assert(!navigator.userActivation.isActive,
                    "user activation never went idle — don't interact with the page while this test waits");

                const settled = puter.auth.signIn().then(
                    (v) => ({ outcome: 'resolved', value: v }),
                    (e) => ({ outcome: 'rejected', error: e }),
                );

                // The dialog is a <puter-dialog> custom element with its
                // markup in a shadow root.
                let host = null;
                const dialogDeadline = Date.now() + 5000;
                while (!host && Date.now() < dialogDeadline) {
                    host = [...document.querySelectorAll('*')].find(
                        (el) => el.shadowRoot && el.shadowRoot.querySelector('#launch-auth-popup'),
                    ) ?? null;
                    if (!host) await new Promise(r => setTimeout(r, 100));
                }
                assert(host, "no consent dialog appeared — without a gesture the popup would just be blocked");

                pass("testSignInConsentDialogWithoutGesture passed: consent dialog shown; " +
                     "click Continue to finish signing in, or Cancel to reject (either is fine — the dialog is what this test asserts)");

                // Don't leave the promise dangling as an unhandled rejection
                // if the dialog is cancelled.
                settled.catch(() => {});
            } catch (error) {
                fail("testSignInConsentDialogWithoutGesture failed:", error);
            }
        }
    },
];
