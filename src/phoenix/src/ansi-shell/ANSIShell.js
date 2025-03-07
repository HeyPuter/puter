/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
import { ConcreteSyntaxError } from "./ConcreteSyntaxError.js";
import { Pipeline } from "./pipeline/Pipeline.js";

export class ANSIShell extends EventTarget {
    constructor (ctx) {
        super();

        this.ctx = ctx;
        this.variables_ = {};
        this.config = ctx.externs.config;

        this.debugFeatures = {};

        const self = this;
        this.variables = new Proxy(this.variables_, {
            get (target, k) {
                return Reflect.get(target, k);
            },
            set (target, k, v) {
                const oldval = target[k];
                const retval = Reflect.set(target, k, v);
                self.dispatchEvent(new CustomEvent('shell-var-change', {
                    key: k,
                    oldValue: oldval,
                    newValue: target[k],
                }))
                return retval;
            }
        })

        this.addEventListener('signal.window-resize', evt => {
            this.variables.size = evt.detail;
        })

        this.env = {};

        this.initializeReasonableDefaults();
    }

    export_ (k, v) {
        if ( typeof v === 'function' ) {
            Object.defineProperty(this.env, k, {
                enumerable: true,
                get: v
            })
            return;
        }
        this.env[k] = v;
    }

    initializeReasonableDefaults() {
        const { env } = this.ctx.platform;
        const home = env.get('HOME');
        const user = env.get('USER');
        this.variables.pwd = home;
        this.variables.home = home;
        this.variables.user = user;

        this.variables.host = env.get('HOSTNAME');

        // Computed values
        Object.defineProperty(this.env, 'PWD', {
            enumerable: true,
            get: () => this.variables.pwd,
            set: v => { this.variables.pwd = v }
        })
        Object.defineProperty(this.env, 'ROWS', {
            enumerable: true,
            get: () => this.variables.size?.rows ?? 0
        })
        Object.defineProperty(this.env, 'COLS', {
            enumerable: true,
            get: () => {
                const v = this.variables.size?.cols ?? 0
                return v;
            }
        })

        this.export_('LANG', 'en_US.UTF-8');
        this.export_('PS1', '[\\u@\\h \\w]\\$ ');

        for ( const k in env.getEnv() ) {
            console.log('setting', k, env.get(k));
            this.export_(k, env.get(k));
        }

        // Default values
        this.export_('HOME', () => this.variables.home);
        this.export_('USER', () => this.variables.user);
        this.export_('TERM', 'xterm-256color');
        this.export_('TERM_PROGRAM', 'puter-ansi');
        // TODO: determine how localization will affect this
        // TODO: add TERM_PROGRAM_VERSION
        // TODO: add OLDPWD
    }

    async doPromptIteration() {
        if ( globalThis.force_eot && this.ctx.platform.name === 'node' ) {
            process.exit(0);
        }
        const { readline } = this.ctx.externs;
        // DRY: created the same way in runPipeline
        const executionCtx = this.ctx.sub({
            vars: this.variables,
            env: this.env,
            locals: {
                pwd: this.variables.pwd,
            },
            shell: this,
        });
        this.ctx.externs.echo.off();
        const input = await readline(
            this.expandPromptString(this.env.PS1),
            executionCtx,
        );
        this.ctx.externs.echo.on();

        if ( input.trim() === '' ) {
            this.ctx.externs.out.write('');
            return;
        }

        // Specially-processed inputs for debug features
        if ( input.startsWith('%%%') ) {
            this.ctx.externs.out.write('%%%: interpreting as debug instruction\n');
            const [prefix, flag, onOff] = input.split(' ');
            const isOn = onOff === 'on' ? true : false;
            this.ctx.externs.out.write(
                `%%%: Setting ${JSON.stringify(flag)} to ` +
                (isOn ? 'ON' : 'OFF') + '\n'
            )
            this.debugFeatures[flag] = isOn;
            return; // don't run as a pipeline
        }

        // TODO: catch here, but errors need to be more structured first
        try {
            await this.runPipeline(input);
        } catch (e) {
            if ( e instanceof ConcreteSyntaxError ) {
                const here = e.print_here(input);
                this.ctx.externs.out.write(here + '\n');
            }
            this.ctx.externs.out.write('error: ' + e.message + '\n');
            console.log(e);
            this.ctx.locals.exit = -1;
            return;
        }
    }

    readtoken (str) {
        return this.ctx.externs.parser.parseLineForProcessing(str);
    }

    async runPipeline (cmdOrTokens) {
        const tokens = typeof cmdOrTokens === 'string'
            ? (() => {
                // TODO: move to doPromptIter with better error objects
                try {
                    return this.readtoken(cmdOrTokens)
                } catch (e) {
                    this.ctx.externs.out.write('error: ' +
                        e.message + '\n');
                    return;
                }
            })()
            : cmdOrTokens ;

        if ( tokens.length === 0 ) return;

        if ( tokens.length > 1 ) {
            // TODO: as exception instead, and more descriptive
            this.ctx.externs.out.write(
                "something went wrong...\n"
            );
            return;
        }

        let ast = tokens[0];

        // Left the code below here (commented) because I think it's
        // interesting; the AST now always has a pipeline at the top
        // level after recent changes to the parser.

        // // wrap an individual command in a pipeline
        // // TODO: should this be done here, or elsewhere?
        // if ( ast.$ === 'command' ) {
        //     ast = {
        //         $: 'pipeline',
        //         components: [ast]
        //     };
        // }
        
        if ( this.debugFeatures['show-ast'] ) {
            this.ctx.externs.out.write(
                JSON.stringify(tokens, undefined, '  ') + '\n'
            );
            return;
        }

        const executionCtx = this.ctx.sub({
            shell: this,
            vars: this.variables,
            env: this.env,
            locals: {
                pwd: this.variables.pwd,
            }
        });
        
        const pipeline = await Pipeline.createFromAST(executionCtx, ast);
        
        await pipeline.execute(executionCtx);

        // Store exit code for the next pipeline
        // TODO: This feels like a hacky way of doing this.
        this.ctx.locals.exit = executionCtx.locals.exit;
        if ( this.ctx.locals.exit ) {
            this.ctx.externs.out.write(`Exited with code ${this.ctx.locals.exit}\n`);
        }
    }

    expandPromptString (str) {
        str = str.replace('\\u', this.variables.user);
        str = str.replace('\\w', this.variables.pwd);
        str = str.replace('\\h', this.variables.host);
        str = str.replace('\\$', '$');
        return str;
    }

    async outputANSI (ctx) {
        await ctx.iterate(async item => {
            ctx.externs.out.write(item.name + '\n');
        });
    }
}
