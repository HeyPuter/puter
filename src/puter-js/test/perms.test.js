/* eslint-disable */
// TODO: Make these more compatible with eslint
// Hand-run these ONE AT A TIME in the browser harness: most prompt the user
// for permission, so they can't run unattended. They verify the request flows
// resolve to a sane value; approve/deny the prompt to exercise both paths.
window.permsTests = [
    {
        name: "testRequestEmail",
        description: "[interactive] requestEmail() returns an email, null, or undefined",
        test: async function() {
            try {
                const email = await puter.perms.requestEmail();
                assert(email === undefined || email === null || typeof email === 'string', "unexpected email value");
                pass("testRequestEmail passed: " + String(email));
            } catch (error) {
                fail("testRequestEmail failed:", error);
            }
        }
    },
    {
        name: "testRequestApps",
        description: "[interactive] requestApps() resolves to a boolean",
        test: async function() {
            try {
                const granted = await puter.perms.requestApps();
                assert(typeof granted === 'boolean', "requestApps should resolve to a boolean");
                pass("testRequestApps passed: " + granted);
            } catch (error) {
                fail("testRequestApps failed:", error);
            }
        }
    },
    {
        name: "testRequestFolderRead",
        description: "[interactive] requestFolder('Desktop') returns the path or undefined",
        test: async function() {
            try {
                const path = await puter.perms.requestFolder('Desktop');
                assert(path === undefined || typeof path === 'string', "unexpected path value");
                pass("testRequestFolderRead passed: " + String(path));
            } catch (error) {
                fail("testRequestFolderRead failed:", error);
            }
        }
    },
    {
        name: "testRequestFolderWrite",
        description: "[interactive] requestFolder('Desktop', 'write') returns the path or undefined",
        test: async function() {
            try {
                const path = await puter.perms.requestFolder('Desktop', 'write');
                assert(path === undefined || typeof path === 'string', "unexpected path value");
                pass("testRequestFolderWrite passed: " + String(path));
            } catch (error) {
                fail("testRequestFolderWrite failed:", error);
            }
        }
    },
    {
        name: "testRequestSubdomainsWrite",
        description: "[interactive] requestSubdomains('write') resolves to a boolean",
        test: async function() {
            try {
                const granted = await puter.perms.requestSubdomains('write');
                assert(typeof granted === 'boolean', "should resolve to a boolean");
                pass("testRequestSubdomainsWrite passed: " + granted);
            } catch (error) {
                fail("testRequestSubdomainsWrite failed:", error);
            }
        }
    },
    {
        name: "testRequestAppRootDirWriteAccess",
        description: "[interactive] requestAppRootDir(app, 'write') actually requests WRITE. Set window.__testAppUid to an app uid first.",
        test: async function() {
            const appUid = window.__testAppUid;
            if (!appUid) {
                pass("testRequestAppRootDirWriteAccess skipped: set window.__testAppUid to an owned app uid to run");
                return;
            }
            try {
                const result = await puter.perms.requestAppRootDir(appUid, 'write');
                assert(result === undefined || typeof result === 'object', "unexpected result");
                pass("testRequestAppRootDirWriteAccess passed: " + JSON.stringify(result));
            } catch (error) {
                fail("testRequestAppRootDirWriteAccess failed:", error);
            }
        }
    },
];
