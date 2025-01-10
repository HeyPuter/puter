import { TeePromise } from "@heyputer/putility/src/libs/promise.js";

export default {
    name: 'localsh',
    usage: 'localsh <PROFILE>',
    description: 'Run a local shell script.',
    args: {
        $: 'simple-parser',
        allowPositionals: true,
    },
    // output: 'text',
    execute: async ctx => {
        const { puterSDK } = ctx.externs;

        const resp = await fetch(`${puterSDK.APIOrigin}/local-terminal/new`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${puterSDK.authToken}`
            },
            body: JSON.stringify({
                profile: ctx.locals.positionals[0],
                args: ctx.locals.positionals.slice(1),
            })
        });

        const convert = atob;

        const { term_uuid } = await resp.json();
        const fn_stdout = ({ term_uuid: term_uuid_, base64 }) => {
            if ( term_uuid !== term_uuid_ ) return;
            ctx.externs.err.write(convert(base64));
        }
        puterSDK.fs.socket.on('local-terminal.stdout', fn_stdout);
        const fn_stderr = ({ term_uuid: term_uuid_, base64 }) => {
            if ( term_uuid !== term_uuid_ ) return;
            ctx.externs.err.write(convert(base64));
        }
        puterSDK.fs.socket.on('local-terminal.stderr', fn_stderr);

        const p = new TeePromise();

        const fn_exit = ({ term_uuid: term_uuid_ }) => {
            if ( term_uuid !== term_uuid_ ) return;
            puterSDK.fs.socket.off('local-terminal.exit', fn_exit);
            puterSDK.fs.socket.off('local-terminal.stdout', fn_stdout);
            puterSDK.fs.socket.off('local-terminal.stderr', fn_stderr);
            p.resolve();

        };
        puterSDK.fs.socket.on('local-terminal.exit', fn_exit);

        await p;
    }
}
