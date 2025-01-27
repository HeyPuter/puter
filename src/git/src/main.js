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
import { parseArgs } from '@pkgjs/parseargs';
import subcommands from './subcommands/__exports__.js';
import git_command from './git-command-definition.js';
import fs from './filesystem.js';
import git from 'isomorphic-git';
import { Buffer } from 'buffer';
import { produce_usage_string, SHOW_USAGE } from './help.js';

const encoder = new TextEncoder();

window.Buffer = Buffer;
window.DEBUG = false;

window.main = async () => {
    const shell = puter.ui.parentApp();
    if (!shell) {
        await puter.ui.alert('Git must be run from a terminal. Try `git --help`');
        puter.exit();
        return;
    }

    shell.on('close', () => {
        console.log('Shell closed; exiting git...');
        puter.exit();
    });

    const stdout = (message) => {
        shell.postMessage({
            $: 'stdout',
            data: encoder.encode(message + '\n'),
        });
    };
    // TODO: Separate stderr message?
    const stderr = stdout;

    const url_params = new URL(document.location).searchParams;
    const puter_args = JSON.parse(url_params.get('puter.args')) ?? {};
    const { command_line, env } = puter_args;

    // isomorphic-git assumes the Node.js process object exists,
    // so fill-in the parts it uses.
    window.process = {
        cwd: () => env.PWD,
        platform: 'puter',
    }

    // Git's command structure is a little unusual:
    // > git [options-for-git] [subcommand [options-and-args-for-subcommand]]
    // Also, a couple of options (--help and --version) are syntactic sugar for `help` and `version` subcommands.
    // The approach here is to first try and parse these top-level options, and then based on that, run a subcommand.

    // If no raw args, just print help and exit
    const raw_args = command_line?.args ?? [];
    if (raw_args.length === 0) {
        stdout(produce_usage_string(git_command));
        puter.exit();
        return;
    }

    const { values: global_options, positionals: global_positionals } = parseArgs({
        options: git_command.args.options,
        allowPositionals: true,
        args: raw_args,
        strict: false,
    });

    let subcommand_name = null;
    let first_positional_is_subcommand = false;
    if (global_options.help) {
        subcommand_name = 'help';
    } else if (global_options.version) {
        subcommand_name = 'version';
    }

    if (global_options.debug)
        window.DEBUG = true;

    if (!subcommand_name) {
        subcommand_name = global_positionals[0];
        first_positional_is_subcommand = true;
    }

    // See if we're running a subcommand we recognize
    let exit_code = 0;
    const subcommand = subcommands[subcommand_name];
    if (!subcommand) {
        stderr(`git: '${subcommand_name}' is not a recognized git command. See 'git --help'`);
        puter.exit(1);
        return;
    }

    // Try and remove the subcommand positional arg, and any global options, from args.
    const subcommand_args = raw_args;
    const remove_arg = (arg) => {
        const index = subcommand_args.indexOf(arg);
        if (index >= 0)
            subcommand_args.splice(index, 1);

    }
    for (const option_name of Object.keys(git_command.args.options)) {
        remove_arg(`--${option_name}`);
    }
    if (first_positional_is_subcommand) {
        // TODO: This is not a 100% reliable way to do this, as it may also match the value of `--option-with-value value`
        //       But that's not a problem until we add some global options that take a value.
        remove_arg(subcommand_name);
    }

    // Parse the remaining args scoped to this subcommand, and run it.
    let parsed_args;
    try {
        parsed_args = parseArgs({
            ...subcommand.args,
            args: subcommand_args,
        });
    } catch (e) {
        stderr(produce_usage_string(subcommand));
        puter.exit(1);
        return;
    }

    const ctx = {
        io: {
            stdout,
            stderr,
        },
        fs,
        args: {
            options: parsed_args.values,
            positionals: parsed_args.positionals,
            tokens: parsed_args.tokens,
        },
        env,
    };

    try {
        exit_code = await subcommand.execute(ctx) ?? 0;
    } catch (e) {
        if (e === SHOW_USAGE) {
            stderr(produce_usage_string(subcommand));
        } else {
            stderr(`fatal: ${e.message}`);
            console.error(e);
        }
        exit_code = 1;
    }

    // TODO: Support passing an exit code to puter.exit();
    puter.exit(exit_code);
}
