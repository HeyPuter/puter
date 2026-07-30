/* eslint-disable */
// TODO: Make these more compatible with eslint
// Hand-run these in the browser harness. They create and delete real apps
// under the signed-in account, using unique names so reruns don't collide.
const appsName = (s) => `apps-test-${s}-${Date.now()}`;

window.appsTests = [
    {
        name: "testCreateAndGet",
        description: "Create an app (positional form) and read it back by name",
        test: async function() {
            const name = appsName('create');
            try {
                const app = await puter.apps.create(name, 'https://example.com/create');
                assert(app.name === name, "created app name mismatch");
                const fetched = await puter.apps.get(name);
                assert(fetched.index_url === 'https://example.com/create', "index_url mismatch");
                pass("testCreateAndGet passed");
            } catch (error) {
                fail("testCreateAndGet failed:", error);
            } finally {
                try { await puter.apps.delete(name); } catch (e) {}
            }
        }
    },
    {
        name: "testCreateOptionsRemap",
        description: "Create with camelCase options and verify snake_case fields are stored",
        test: async function() {
            const name = appsName('remap');
            try {
                await puter.apps.create({
                    name,
                    indexURL: 'https://example.com/remap',
                    maximizeOnStart: true,
                    filetypeAssociations: ['.txt', 'image/png'],
                });
                const fetched = await puter.apps.get(name);
                assert(Boolean(fetched.maximize_on_start) === true, "maximize_on_start not stored");
                // Extensions are canonicalized to the bare lowercase form on
                // write ('.txt' → 'txt'); MIME types pass through unchanged.
                assert(JSON.stringify(fetched.filetype_associations) === JSON.stringify(['txt', 'image/png']), "filetype_associations not stored");
                pass("testCreateOptionsRemap passed");
            } catch (error) {
                fail("testCreateOptionsRemap failed:", error);
            } finally {
                try { await puter.apps.delete(name); } catch (e) {}
            }
        }
    },
    {
        name: "testCreateValidationErrorShape",
        description: "Create without a name throws a backward-compatible { code, error:{code} } error",
        test: async function() {
            try {
                await puter.apps.create({ indexURL: 'https://example.com/x' });
                fail("testCreateValidationErrorShape failed: no error thrown");
            } catch (error) {
                assert(error.code === 'invalid_request', "top-level code should be invalid_request");
                assert(error.error && error.error.code === 'invalid_request', "legacy nested error.code should be invalid_request");
                assert(error instanceof Error, "error should be an Error instance");
                pass("testCreateValidationErrorShape passed: " + error.message);
            }
        }
    },
    {
        name: "testUpdate",
        description: "Update an app's index URL and verify the change",
        test: async function() {
            const name = appsName('update');
            try {
                await puter.apps.create(name, 'https://example.com/before');
                const updated = await puter.apps.update(name, { indexURL: 'https://example.com/after' });
                assert(updated.index_url === 'https://example.com/after', "index_url not updated");
                pass("testUpdate passed");
            } catch (error) {
                fail("testUpdate failed:", error);
            } finally {
                try { await puter.apps.delete(name); } catch (e) {}
            }
        }
    },
    {
        name: "testList",
        description: "List apps and confirm a freshly created app appears",
        test: async function() {
            const name = appsName('list');
            try {
                await puter.apps.create(name, 'https://example.com/list');
                const apps = await puter.apps.list();
                assert(Array.isArray(apps), "list should resolve to an array");
                assert(apps.some(a => a.name === name), "created app should appear in list");
                pass("testList passed");
            } catch (error) {
                fail("testList failed:", error);
            } finally {
                try { await puter.apps.delete(name); } catch (e) {}
            }
        }
    },
    {
        name: "testCheckName",
        description: "checkName reports a taken name differently from an available one",
        test: async function() {
            const name = appsName('checkname');
            try {
                await puter.apps.create(name, 'https://example.com/cn');
                const taken = await puter.apps.checkName(name);
                const available = await puter.apps.checkName(appsName('surely-free'));
                assert(JSON.stringify(taken) !== JSON.stringify(available), "taken and available should differ");
                pass("testCheckName passed");
            } catch (error) {
                fail("testCheckName failed:", error);
            } finally {
                try { await puter.apps.delete(name); } catch (e) {}
            }
        }
    },
    {
        name: "testGetDeveloperProfile",
        description: "getDeveloperProfile resolves once with an object (single-parse fix)",
        test: async function() {
            try {
                const profile = await puter.apps.getDeveloperProfile();
                assert(profile && typeof profile === 'object', "profile should be an object");
                pass("testGetDeveloperProfile passed");
            } catch (error) {
                fail("testGetDeveloperProfile failed:", error);
            }
        }
    },
];
