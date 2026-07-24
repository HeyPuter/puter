/* eslint-disable */
// TODO: Make these more compatible with eslint
// Hand-run in the browser harness. Read-only; safe to run against any account.
window.osTests = [
    {
        name: "testUser",
        description: "os.user() returns the authenticated user with a username",
        test: async function() {
            try {
                const user = await puter.os.user();
                assert(user && typeof user === 'object', "user should be an object");
                assert(typeof user.username === 'string' && user.username.length > 0, "username should be a non-empty string");
                pass("testUser passed: " + user.username);
            } catch (error) {
                fail("testUser failed:", error);
            }
        }
    },
    {
        name: "testUserCallback",
        description: "os.user() honors trailing success/error callbacks",
        test: async function() {
            try {
                const user = await new Promise((resolve, reject) => {
                    puter.os.user(resolve, reject);
                });
                assert(user && typeof user.username === 'string', "callback should deliver the user");
                pass("testUserCallback passed");
            } catch (error) {
                fail("testUserCallback failed:", error);
            }
        }
    },
    {
        name: "testVersion",
        description: "os.version() returns a deployment version object",
        test: async function() {
            try {
                const version = await puter.os.version();
                assert(version && typeof version === 'object', "version should be an object");
                pass("testVersion passed: " + JSON.stringify(version));
            } catch (error) {
                fail("testVersion failed:", error);
            }
        }
    },
];
