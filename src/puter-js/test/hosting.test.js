/* eslint-disable */
// TODO: Make these more compatible with eslint
// Hand-run in the browser harness. Each test provisions its own root directory
// (the subdomain driver requires one) and cleans up the subdomain afterward.
const hostName = (s) => `hostingtest${s}${Date.now()}`;

async function makeDir(name) {
    const user = await puter.auth.getUser();
    const dir = `/${user.username}/hosting-test-${name}-${Date.now()}`;
    await puter.fs.mkdir(dir, { createMissingParents: true });
    return dir;
}

window.hostingTests = [
    {
        name: "testCreateAndGet",
        description: "Create a subdomain and read it back by name",
        test: async function() {
            const sub = hostName('cg');
            try {
                const dir = await makeDir('cg');
                const created = await puter.hosting.create(sub, dir);
                assert(created.subdomain === sub, "created subdomain mismatch");
                const fetched = await puter.hosting.get(sub);
                assert(fetched.subdomain === sub, "fetched subdomain mismatch");
                pass("testCreateAndGet passed");
            } catch (error) {
                fail("testCreateAndGet failed:", error);
            } finally {
                try { await puter.hosting.delete(sub); } catch (e) {}
            }
        }
    },
    {
        name: "testFullHostNormalization",
        description: "Passing '<name>.puter.site' stores just the label and is retrievable by it",
        test: async function() {
            const sub = hostName('fh');
            try {
                const dir = await makeDir('fh');
                const created = await puter.hosting.create(`${sub}.puter.site`, dir);
                assert(created.subdomain === sub, "full host should be stripped to the label");
                const byHost = await puter.hosting.get(`${sub}.puter.com`);
                assert(byHost.subdomain === sub, "get should normalize a full host too");
                pass("testFullHostNormalization passed");
            } catch (error) {
                fail("testFullHostNormalization failed:", error);
            } finally {
                try { await puter.hosting.delete(sub); } catch (e) {}
            }
        }
    },
    {
        name: "testUpdate",
        description: "Repoint a subdomain to a new directory",
        test: async function() {
            const sub = hostName('up');
            try {
                const dirA = await makeDir('up-a');
                const dirB = await makeDir('up-b');
                await puter.hosting.create(sub, dirA);
                const updated = await puter.hosting.update(sub, dirB);
                assert(updated.subdomain === sub, "update should return the subdomain");
                pass("testUpdate passed");
            } catch (error) {
                fail("testUpdate failed:", error);
            } finally {
                try { await puter.hosting.delete(sub); } catch (e) {}
            }
        }
    },
    {
        name: "testList",
        description: "List subdomains and confirm a created one appears",
        test: async function() {
            const sub = hostName('ls');
            try {
                const dir = await makeDir('ls');
                await puter.hosting.create(sub, dir);
                const sites = await puter.hosting.list();
                assert(Array.isArray(sites), "list should resolve to an array");
                assert(sites.some(s => s.subdomain === sub), "created subdomain should appear");
                pass("testList passed");
            } catch (error) {
                fail("testList failed:", error);
            } finally {
                try { await puter.hosting.delete(sub); } catch (e) {}
            }
        }
    },
    {
        name: "testDelete",
        description: "Delete a subdomain and confirm get then rejects",
        test: async function() {
            const sub = hostName('del');
            try {
                const dir = await makeDir('del');
                await puter.hosting.create(sub, dir);
                await puter.hosting.delete(sub);
                // `fail()` throws, so it must not be called inside a try whose
                // catch reports a pass — the throw would be caught there and
                // the failure reported as success.
                let resolved = false;
                try {
                    await puter.hosting.get(sub);
                    resolved = true;
                } catch (e) {
                    // Expected: the subdomain is gone.
                }
                assert(!resolved, "get of a deleted subdomain should reject");
                pass("testDelete passed");
            } catch (error) {
                fail("testDelete failed:", error);
            }
        }
    },
];
