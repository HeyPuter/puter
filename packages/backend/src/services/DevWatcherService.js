const BaseService = require("./BaseService");

class ProxyLogger {
    constructor (log) {
        this.log = log;
    }
    attach (stream) {
        let buffer = '';
        stream.on('data', (chunk) => {
            buffer += chunk.toString();
            let lineEndIndex = buffer.indexOf('\n');
            while (lineEndIndex !== -1) {
                const line = buffer.substring(0, lineEndIndex);
                this.log(line);
                buffer = buffer.substring(lineEndIndex + 1);
                lineEndIndex = buffer.indexOf('\n');
            }
        });

        stream.on('end', () => {
            if (buffer.length) {
                this.log(buffer);
            }
        });
    }
}

/**
 * @description
 * This service is used to run webpack watchers.
 */
class DevWatcherService extends BaseService {
    static MODULES = {
        path: require('path'),
        spawn: require('child_process').spawn,
    };

    _construct () {
        this.instances = [];
    }

    async _init (args) {
        const { root, commands } = args;

        process.on('exit', () => {
            this.exit_all_();
        })

        for ( const entry of commands ) {
            const { name, directory, command, args } = entry;
            const fullpath = this.modules.path.join(
                root, directory);
            this.start_({ name, fullpath, command, args });
        }
    }

    log_ (name, isErr, line) {
        let txt = `[${name}:`;
        txt += isErr
            ? `\x1B[31;1merr\x1B[0m`
            : `\x1B[32;1mout\x1B[0m`;
        txt += '] ' + line;
        this.log.info(txt);
    }

    async start_ ({ name, fullpath, command, args }) {
        this.log.info(`Starting ${name} in ${fullpath}`);
        const proc = this.modules.spawn(command, args, {
            shell: true,
            env: process.env,
            cwd: fullpath,
        });
        this.instances.push({
            name, proc,
        });
        const out = new ProxyLogger((line) => this.log_(name, false, line));
        out.attach(proc.stdout);
        const err = new ProxyLogger((line) => this.log_(name, true, line));
        err.attach(proc.stderr);
        proc.on('exit', () => {
            this.log.info(`[${name}:exit] Process exited (${proc.exitCode})`);
            this.instances = this.instances.filter((inst) => inst.proc !== proc);
        })
    }

    async exit_all_ () {
        for ( const { proc } of this.instances ) {
            proc.kill();
        }
    }
};

module.exports = DevWatcherService;
