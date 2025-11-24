const BaseService = require('./BaseService');

const path_ = require('node:path');
const net = require('node:net');
const fs = require('node:fs');

const SOCKET_INTRO = `Nice, you've found the dev socket!
This is a convenient debugging/diagnosis interface to Puter's backend
that only runs in development mode. Any line of text sent over the socket
stream beginning with the character \`{\` of \`[\` MUST be a valid JSON
value; that goes for both incoming and outgoing messages.

Try entering the 'help' command.
`;

class DevSocketService extends BaseService {
    async ['__on_boot.consolidation'] () {
        this.sock = process.env.DEV_SOCKET_PATH ??
            path_.join(process.cwd(), 'dev.sock');

        try {
            fs.unlinkSync(this.sock);
        } catch ( _err ) {
            // NOOP
        }

        const svc_command = this.services.get('commands');

        const server = net.createServer(conn => {

            conn.setEncoding('utf8');
            conn.write(`${SOCKET_INTRO }\n`);

            let buf = '';
            conn.on('data', (chunk) => {
                buf += chunk;
                let nl;
                while ( (nl = buf.indexOf('\n')) >= 0 ) {
                    let line = buf.slice(0, nl); buf = buf.slice(nl + 1);
                    line = line.trim();

                    const logoutputs = [];
                    const logfn = (...a) => {
                        logoutputs.push(a.join(' '));
                        conn.write(`${JSON.stringify(a) }\n`);
                    };
                    const log = {
                        log: logfn,
                        info: logfn,
                        warn: logfn,
                        error: logfn,
                    };
                    svc_command.executeRawCommand(line, log);
                }
            });
        });

        server.listen(this.sock, () => {
            fs.chmodSync(this.sock, 0o600);
        });
        process.on('beforeExit', this.cleanup_.bind(this));
    }

    cleanup_ () {
        if ( this.cleaned_up ) return;
        this.cleaned_up = true;

        fs.unlinkSync(this.sock);
    }
}

module.exports = {
    DevSocketService,
};
