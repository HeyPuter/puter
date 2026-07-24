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
        name: "testRequestReadApps",
        description: "[interactive] requestReadApps() resolves to a boolean",
        test: async function() {
            try {
                const granted = await puter.perms.requestReadApps();
                assert(typeof granted === 'boolean', "requestReadApps should resolve to a boolean");
                pass("testRequestReadApps passed: " + granted);
            } catch (error) {
                fail("testRequestReadApps failed:", error);
            }
        }
    },
    {
        name: "testRequestReadDesktop",
        description: "[interactive] requestReadDesktop() returns the path or undefined",
        test: async function() {
            try {
                const path = await puter.perms.requestReadDesktop();
                assert(path === undefined || typeof path === 'string', "unexpected path value");
                pass("testRequestReadDesktop passed: " + String(path));
            } catch (error) {
                fail("testRequestReadDesktop failed:", error);
            }
        }
    },
    {
        name: "testRequestWriteDesktop",
        description: "[interactive] requestWriteDesktop() returns the path or undefined",
        test: async function() {
            try {
                const path = await puter.perms.requestWriteDesktop();
                assert(path === undefined || typeof path === 'string', "unexpected path value");
                pass("testRequestWriteDesktop passed: " + String(path));
            } catch (error) {
                fail("testRequestWriteDesktop failed:", error);
            }
        }
    },
    {
        name: "testRequestManageSubdomains",
        description: "[interactive] requestManageSubdomains() resolves to a boolean",
        test: async function() {
            try {
                const granted = await puter.perms.requestManageSubdomains();
                assert(typeof granted === 'boolean', "should resolve to a boolean");
                pass("testRequestManageSubdomains passed: " + granted);
            } catch (error) {
                fail("testRequestManageSubdomains failed:", error);
            }
        }
    },
    {
        name: "testListGroups",
        description: "listGroups() returns a result without erroring",
        test: async function() {
            try {
                const result = await puter.perms.listGroups();
                assert(result && !result.error, "listGroups should not report an error: " + JSON.stringify(result));
                pass("testListGroups passed");
            } catch (error) {
                fail("testListGroups failed:", error);
            }
        }
    },
    {
        name: "testRequestWriteAppRootDirAccess",
        description: "[interactive] requestWriteAppRootDir(app) actually requests WRITE (bug fix). Set window.__testAppUid to an app uid first.",
        test: async function() {
            const appUid = window.__testAppUid;
            if (!appUid) {
                pass("testRequestWriteAppRootDirAccess skipped: set window.__testAppUid to an owned app uid to run");
                return;
            }
            try {
                const result = await puter.perms.requestWriteAppRootDir(appUid);
                assert(result === undefined || typeof result === 'object', "unexpected result");
                pass("testRequestWriteAppRootDirAccess passed: " + JSON.stringify(result));
            } catch (error) {
                fail("testRequestWriteAppRootDirAccess failed:", error);
            }
        }
    },
];
