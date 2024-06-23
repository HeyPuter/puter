const request_examples = [
    {
        name: 'entity storage app read',
        fetch: async (args) => {
            return await fetch(`${window.api_origin}/drivers/call`, {
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${puter.authToken}`,
                },
                body: JSON.stringify({
                    interface: 'puter-apps',
                    method: 'read',
                    args,
                }),
                method: "POST",
            });
        },
        out: async (resp) => {
            const data = await resp.json();
            if ( ! data.success ) return data;
            return data.result;
        },
        exec: async function exec (...a) {
            const resp = await this.fetch(...a);
            return await this.out(resp);
        },
    },
    {
        name: 'entity storage app select all',
        fetch: async () => {
            return await fetch(`${window.api_origin}/drivers/call`, {
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${puter.authToken}`,
                },
                body: JSON.stringify({
                    interface: 'puter-apps',
                    method: 'select',
                    args: { predicate: [] },
                }),
                method: "POST",
            });
        },
        out: async (resp) => {
            const data = await resp.json();
            if ( ! data.success ) return data;
            return data.result;
        },
        exec: async function exec (...a) {
            const resp = await this.fetch(...a);
            return await this.out(resp);
        },
    },
    {
        name: 'grant permission from a user to a user',
        fetch: async (user, perm) => {
            return await fetch(`${window.api_origin}/auth/grant-user-user`, {
            "headers": {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${puter.authToken}`,
            },
            "body": JSON.stringify({
                target_username: user,
                permission: perm,
            }),
            "method": "POST",
            });
        },
        out: async (resp) => {
            const data = await resp.json();
            return data;
        },
        exec: async function exec (...a) {
            const resp = await this.fetch(...a);
            return await this.out(resp);
        },
    }
];

globalThis.reqex = request_examples;

globalThis.service_script(api => {
    api.on_ready(() => {
    });
});
