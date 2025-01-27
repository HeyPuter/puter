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
import { JumpLocation, LabelCommand, GroupEndCommand } from './command.js';
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
        let i = 0;
        while (i < this.commands.length) {
            const command = this.commands[i];
            command.updateMatchState(context);
            const result = await command.runCommand(context);
            switch (result) {
                case JumpLocation.Label: {
                    const label = context.jumpParameter;
                    context.jumpParameter = null;
                    const foundIndex = this.commands.findIndex(c => c instanceof LabelCommand && c.label === label);
                    if (foundIndex === -1) {
                        // TODO: Check for existence of labels during parsing too.
                        throw new Error(`Label ':${label}' not found.`);
                    }
                    i = foundIndex;
                    break;
                }
                case JumpLocation.GroupEnd: {
                    const groupId = context.jumpParameter;
                    context.jumpParameter = null;
                    const foundIndex = this.commands.findIndex(c => c instanceof GroupEndCommand && c.id === groupId);
                    if (foundIndex === -1) {
                        // TODO: Check for matching groups during parsing too.
                        throw new Error(`Matching } for group #${groupId} not found.`);
                    }
                    i = foundIndex;
                    break;
                }
                case JumpLocation.Quit:
                    return CycleResult.Quit;
                case JumpLocation.QuitSilent:
                    return CycleResult.QuitSilent;
                case JumpLocation.StartOfCycle:
                    i = 0;
                    continue;
                case JumpLocation.EndOfCycle:
                    return CycleResult.Continue;
                case JumpLocation.None:
                    i++;
                    break;
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
