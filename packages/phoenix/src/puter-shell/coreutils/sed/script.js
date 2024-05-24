/*
 * Copyright (C) 2024  Puter Technologies Inc.
 *
 * This file is part of Phoenix Shell.
 *
 * Phoenix Shell is free software: you can redistribute it and/or modify
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
import { JumpLocation } from './command.js';
import { fileLines } from '../../../util/file.js';

const CycleResult = {
    Continue: Symbol('Continue'),
    Quit: Symbol('Quit'),
    QuitSilent: Symbol('QuitSilent'),
};

export class Script {
    constructor(commands) {
        this.commands = commands;
    }

    async runCycle(context) {
        for (let i = 0; i < this.commands.length; i++) {
            const command = this.commands[i];
            command.updateMatchState(context);
            const result = await command.runCommand(context);
            switch (result) {
                case JumpLocation.Label:
                    // TODO: Implement labels
                    break;
                case JumpLocation.Quit:
                    return CycleResult.Quit;
                case JumpLocation.QuitSilent:
                    return CycleResult.QuitSilent;
                case JumpLocation.StartOfCycle:
                    i = -1; // To start at 0 after the loop increment.
                    continue;
                case JumpLocation.EndOfCycle:
                    return CycleResult.Continue;
                case JumpLocation.None:
                    continue;
            }
        }
    }

    async run(ctx) {
        const { out, err } = ctx.externs;
        const { positionals, values } = ctx.locals;

        const context = {
            out: ctx.externs.out,
            patternSpace: '',
            holdSpace: '\n',
            lineNumber: 1,
            queuedOutput: '',
        };

        // All remaining positionals are file paths to process.
        for (const relPath of positionals) {
            context.lineNumber = 1;
            for await (const line of fileLines(ctx, relPath)) {
                context.patternSpace = line.replace(/\n$/, '');
                const result = await this.runCycle(context);
                switch (result) {
                    case CycleResult.Quit: {
                        if (!values.quiet) {
                            await out.write(context.patternSpace + '\n');
                        }
                        return;
                    }
                    case CycleResult.QuitSilent: {
                        return;
                    }
                }
                if (!values.quiet) {
                    await out.write(context.patternSpace + '\n');
                }
                if (context.queuedOutput) {
                    await out.write(context.queuedOutput + '\n');
                    context.queuedOutput = '';
                }
                context.lineNumber++;
            }
        }
    }

    dump() {
        return `SCRIPT:\n`
            + this.commands.map(command => command.dump(1)).join('');
    }
}
