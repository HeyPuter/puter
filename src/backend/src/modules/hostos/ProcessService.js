const BaseService = require('../../services/BaseService');

class ProxyLogger {
    constructor (log) {
        this.log = log;
    }
    attach (stream) {
        let buffer = '';
        stream.on('data', (chunk) => {
            buffer += chunk.toString();
            let lineEndIndex = buffer.indexOf('\n');
            while ( lineEndIndex !== -1 ) {
                const line = buffer.substring(0, lineEndIndex);
                this.log(line);
                buffer = buffer.substring(lineEndIndex + 1);
                lineEndIndex = buffer.indexOf('\n');
            }
        });

        stream.on('end', () => {
            if ( buffer.length ) {
                this.log(buffer);
            }
        });
    }
}

class ProcessService extends BaseService {
    static CONCERN = 'workers';

    static MODULES = {
        path: require('path'),
        spawn: require('child_process').spawn,
    };

    _construct () {
        this.instances = [];
    }

    async _init (args) {
        this.args = args;

        process.on('exit', () => {
            this.exit_all_();
        });
    }

    log_ (name, isErr, line) {
        let txt = `[${name}:`;
        txt += isErr
            ? '\x1B[34;1m2\x1B[0m'
            : '\x1B[32;1m1\x1B[0m';
        txt += `] ${ line}`;
        this.log.info(txt);
    }

    async exit_all_ () {
        for ( const { proc } of this.instances ) {
            proc.kill();
        }
    }

    async start ({ name, fullpath, command, args, env }) {
        this.log.info(`Starting ${name} in ${fullpath}`);
        const env_processed = { ...(env ?? {}) };
        for ( const k in env_processed ) {
            if ( typeof env_processed[k] !== 'function' ) continue;
            env_processed[k] = env_processed[k]({
                global_config: this.global_config,
            });
        }
        this.log.debug('command',
                        { command, args });
        const proc = this.modules.spawn(command, args, {
            shell: true,
            env: {
                ...process.env,
                ...env_processed,
            },
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
        });
    }
}

module.exports = ProcessService;
