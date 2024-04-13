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
import { Exit } from './coreutil_lib/exit.js';
import { fileLines } from '../../util/file.js';

function makeIndent(size) {
    return '  '.repeat(size);
}

// Either a line number or a regex
class Address {
    constructor(value) {
        this.value = value;
    }

    matches(lineNumber, line) {
        if (this.value instanceof RegExp) {
            return this.value.test(line);
        }
        return this.value === lineNumber;
    }

    isLineNumberBefore(lineNumber) {
        return (typeof this.value === 'number') && this.value < lineNumber;
    }

    dump(indent) {
        if (this.value instanceof RegExp) {
            return `${makeIndent(indent)}REGEX: ${this.value}\n`;
        }
        return `${makeIndent(indent)}LINE: ${this.value}\n`;
    }
}

class AddressRange {
    // Three kinds of AddressRange:
    // - Empty (includes everything)
    // - Single (matches individual line)
    // - Range (matches lines between start and end, inclusive)
    constructor({ start, end, inverted = false } = {}) {
        this.start = start;
        this.end = end;
        this.inverted = inverted;
        this.insideRange = false;
        this.leaveRangeNextLine = false;
    }

    updateMatchState(lineNumber, line) {
        // Only ranges have a state to update
        if (!(this.start && this.end)) {
            return;
        }

        // Reset our state each time we start a new file.
        if (lineNumber === 1) {
            this.insideRange = false;
            this.leaveRangeNextLine = false;
        }

        // Leave the range if the previous line matched the end.
        if (this.leaveRangeNextLine) {
            this.insideRange = false;
            this.leaveRangeNextLine = false;
        }

        if (this.insideRange) {
            // We're inside the range, does this line end it?
            // If the end address is a line number in the past, yes, immediately.
            if (this.end.isLineNumberBefore(lineNumber)) {
                this.insideRange = false;
                return;
            }
            // If the line matches the end address, include it but leave the range on the next line.
            this.leaveRangeNextLine = this.end.matches(lineNumber, line);
        } else {
            // Does this line start the range?
            this.insideRange = this.start.matches(lineNumber, line);
        }
    }

    matches(lineNumber, line) {
        const invertIfNeeded = (value) => {
            return this.inverted ? !value : value;
        };

        // Empty - matches all lines
        if (!this.start) {
            return invertIfNeeded(true);
        }

        // Range
        if (this.end) {
            return invertIfNeeded(this.insideRange);
        }

        // Single
        return invertIfNeeded(this.start.matches(lineNumber, line));
    }

    dump(indent) {
        const inverted = this.inverted ? `${makeIndent(indent+1)}(INVERTED)\n` : '';

        if (!this.start) {
            return `${makeIndent(indent)}ADDRESS RANGE (EMPTY)\n`
                + inverted;
        }

        if (this.end) {
            return `${makeIndent(indent)}ADDRESS RANGE (RANGE):\n`
                + inverted
                + this.start.dump(indent+1)
                + this.end.dump(indent+1);
        }

        return `${makeIndent(indent)}ADDRESS RANGE (SINGLE):\n`
            + this.start.dump(indent+1)
            + inverted;
    }
}

const JumpLocation = {
    None: Symbol('None'),
    EndOfCycle: Symbol('EndOfCycle'),
    StartOfCycle: Symbol('StartOfCycle'),
    Label: Symbol('Label'),
    Quit: Symbol('Quit'),
    QuitSilent: Symbol('QuitSilent'),
};

class Command {
    constructor(addressRange) {
        this.addressRange = addressRange ?? new AddressRange();
    }

    updateMatchState(context) {
        this.addressRange.updateMatchState(context.lineNumber, context.patternSpace);
    }

    async runCommand(context) {
        if (this.addressRange.matches(context.lineNumber, context.patternSpace)) {
            return await this.run(context);
        }
        return JumpLocation.None;
    }

    async run(context) {
        throw new Error('run() not implemented for ' + this.constructor.name);
    }

    dump(indent) {
        throw new Error('dump() not implemented for ' + this.constructor.name);
    }
}

// '{}' - Group other commands
class GroupCommand extends Command {
    constructor(addressRange, subCommands) {
        super(addressRange);
        this.subCommands = subCommands;
    }

    updateMatchState(context) {
        super.updateMatchState(context);
        for (const command of this.subCommands) {
            command.updateMatchState(context);
        }
    }

    async run(context) {
        for (const command of this.subCommands) {
            const result = await command.runCommand(context);
            if (result !== JumpLocation.None) {
                return result;
            }
        }
        return JumpLocation.None;
    }

    dump(indent) {
        return `${makeIndent(indent)}GROUP:\n`
            + this.addressRange.dump(indent+1)
            + `${makeIndent(indent+1)}CHILDREN:\n`
            + this.subCommands.map(command => command.dump(indent+2)).join('');
    }
}

// '=' - Output line number
class LineNumberCommand extends Command {
    constructor(addressRange) {
        super(addressRange);
    }

    async run(context) {
        await context.out.write(`${context.lineNumber}\n`);
        return JumpLocation.None;
    }

    dump(indent) {
        return `${makeIndent(indent)}LINE-NUMBER:\n`
            + this.addressRange.dump(indent+1);
    }
}

// 'a' - Append text
class AppendTextCommand extends Command {
    constructor(addressRange, text) {
        super(addressRange);
        this.text = text;
    }

    async run(context) {
        context.queuedOutput += this.text + '\n';
        return JumpLocation.None;
    }

    dump(indent) {
        return `${makeIndent(indent)}APPEND-TEXT:\n`
            + this.addressRange.dump(indent+1)
            + `${makeIndent(indent+1)}CONTENTS: '${this.text}'\n`;
    }
}

// 'c' - Replace line with text
class ReplaceCommand extends Command {
    constructor(addressRange, text) {
        super(addressRange);
        this.text = text;
    }

    async run(context) {
        context.patternSpace = '';
        // Output if we're either a 0-address range, 1-address range, or 2-address on the last line.
        if (this.addressRange.leaveRangeNextLine || !this.addressRange.end) {
            await context.out.write(this.text + '\n');
        }
        return JumpLocation.EndOfCycle;
    }

    dump(indent) {
        return `${makeIndent(indent)}REPLACE-TEXT:\n`
            + this.addressRange.dump(indent+1)
            + `${makeIndent(indent+1)}CONTENTS: '${this.text}'\n`;
    }
}

// 'd' - Delete pattern
class DeleteCommand extends Command {
    constructor(addressRange) {
        super(addressRange);
    }

    async run(context) {
        context.patternSpace = '';
        return JumpLocation.EndOfCycle;
    }

    dump(indent) {
        return `${makeIndent(indent)}DELETE:\n`
            + this.addressRange.dump(indent+1);
    }
}

// 'D' - Delete first line of pattern
class DeleteLineCommand extends Command {
    constructor(addressRange) {
        super(addressRange);
    }

    async run(context) {
        const [ firstLine, rest ] = context.patternSpace.split('\n', 2);
        context.patternSpace = rest ?? '';
        if (rest === undefined) {
            return JumpLocation.EndOfCycle;
        }
        return JumpLocation.StartOfCycle;
    }

    dump(indent) {
        return `${makeIndent(indent)}DELETE-LINE:\n`
            + this.addressRange.dump(indent+1);
    }
}

// 'g' - Get the held line into the pattern
class GetCommand extends Command {
    constructor(addressRange) {
        super(addressRange);
    }

    async run(context) {
        context.patternSpace = context.holdSpace;
        return JumpLocation.None;
    }

    dump(indent) {
        return `${makeIndent(indent)}GET-HELD:\n`
            + this.addressRange.dump(indent+1);
    }
}

// 'G' - Get the held line and append it to the pattern
class GetAppendCommand extends Command {
    constructor(addressRange) {
        super(addressRange);
    }

    async run(context) {
        context.patternSpace += '\n' + context.holdSpace;
        return JumpLocation.None;
    }

    dump(indent) {
        return `${makeIndent(indent)}GET-HELD-APPEND:\n`
            + this.addressRange.dump(indent+1);
    }
}

// 'h' - Hold the pattern
class HoldCommand extends Command {
    constructor(addressRange) {
        super(addressRange);
    }

    async run(context) {
        context.holdSpace = context.patternSpace;
        return JumpLocation.None;
    }

    dump(indent) {
        return `${makeIndent(indent)}HOLD:\n`
            + this.addressRange.dump(indent+1);
    }
}

// 'H' - Hold append the pattern
class HoldAppendCommand extends Command {
    constructor(addressRange) {
        super(addressRange);
    }

    async run(context) {
        context.holdSpace += '\n' + context.patternSpace;
        return JumpLocation.None;
    }

    dump(indent) {
        return `${makeIndent(indent)}HOLD-APPEND:\n`
            + this.addressRange.dump(indent+1);
    }
}

// 'i' - Insert text
class InsertTextCommand extends Command {
    constructor(addressRange, text) {
        super(addressRange);
        this.text = text;
    }

    async run(context) {
        await context.out.write(this.text + '\n');
        return JumpLocation.None;
    }

    dump(indent) {
        return `${makeIndent(indent)}INSERT-TEXT:\n`
            + this.addressRange.dump(indent+1)
            + `${makeIndent(indent+1)}CONTENTS: '${this.text}'\n`;
    }
}

// 'l' - Print pattern in debug format
class DebugPrintCommand extends Command {
    constructor(addressRange) {
        super(addressRange);
    }

    async run(context) {
        let output = '';
        for (const c of context.patternSpace) {
            if (c < ' ') {
                const charCode = c.charCodeAt(0);
                switch (charCode) {
                    case 0x07: output += '\\a'; break;
                    case 0x08: output += '\\b'; break;
                    case 0x0C: output += '\\f'; break;
                    case 0x0A: output += '$\n'; break;
                    case 0x0D: output += '\\r'; break;
                    case 0x09: output += '\\t'; break;
                    case 0x0B: output += '\\v'; break;
                    default: {
                        const octal = charCode.toString(8);
                        output += '\\' + '0'.repeat(3 - octal.length) + octal;
                    }
                }
            } else if (c === '\\') {
                output += '\\\\';
            }  else {
                output += c;
            }
        }
        await context.out.write(output);
        return JumpLocation.None;
    }

    dump(indent) {
        return `${makeIndent(indent)}DEBUG-PRINT:\n`
            + this.addressRange.dump(indent+1);
    }
}

// 'p' - Print pattern
class PrintCommand extends Command {
    constructor(addressRange) {
        super(addressRange);
    }

    async run(context) {
        await context.out.write(context.patternSpace);
        return JumpLocation.None;
    }

    dump(indent) {
        return `${makeIndent(indent)}PRINT:\n`
            + this.addressRange.dump(indent+1);
    }
}

// 'P' - Print first line of pattern
class PrintLineCommand extends Command {
    constructor(addressRange) {
        super(addressRange);
    }

    async run(context) {
        const firstLine = context.patternSpace.split('\n', 2)[0];
        await context.out.write(firstLine);
        return JumpLocation.None;
    }

    dump(indent) {
        return `${makeIndent(indent)}PRINT-LINE:\n`
            + this.addressRange.dump(indent+1);
    }
}

// 'q' - Quit
class QuitCommand extends Command {
    constructor(addressRange) {
        super(addressRange);
    }

    async run(context) {
        return JumpLocation.Quit;
    }

    dump(indent) {
        return `${makeIndent(indent)}QUIT:\n`
            + this.addressRange.dump(indent+1);
    }
}

// 'Q' - Quit, suppressing the default output
class QuitSilentCommand extends Command {
    constructor(addressRange) {
        super(addressRange);
    }

    async run(context) {
        return JumpLocation.QuitSilent;
    }

    dump(indent) {
        return `${makeIndent(indent)}QUIT-SILENT:\n`
            + this.addressRange.dump(indent+1);
    }
}

// 'x' - Exchange hold and pattern
class ExchangeCommand extends Command {
    constructor(addressRange) {
        super(addressRange);
    }

    async run(context) {
        const oldPattern = context.patternSpace;
        context.patternSpace = context.holdSpace;
        context.holdSpace = oldPattern;
        return JumpLocation.None;
    }

    dump(indent) {
        return `${makeIndent(indent)}EXCHANGE:\n`
            + this.addressRange.dump(indent+1);
    }
}

// 'y' - Transliterate characters
class TransliterateCommand extends Command {
    constructor(addressRange, inputCharacters, replacementCharacters) {
        super(addressRange);
        this.inputCharacters = inputCharacters;
        this.replacementCharacters = replacementCharacters;

        if (inputCharacters.length !== replacementCharacters.length) {
            throw new Error('inputCharacters and replacementCharacters must be the same length!');
        }
    }

    async run(context) {
        let newPatternSpace = '';
        for (let i = 0; i < context.patternSpace.length; ++i) {
            const char = context.patternSpace[i];
            const replacementIndex = this.inputCharacters.indexOf(char);
            if (replacementIndex !== -1) {
                newPatternSpace += this.replacementCharacters[replacementIndex];
                continue;
            }
            newPatternSpace += char;
        }
        context.patternSpace = newPatternSpace;
        return JumpLocation.None;
    }

    dump(indent) {
        return `${makeIndent(indent)}TRANSLITERATE:\n`
            + this.addressRange.dump(indent+1)
            + `${makeIndent(indent+1)}FROM '${this.inputCharacters}'\n`
            + `${makeIndent(indent+1)}TO   '${this.replacementCharacters}'\n`;
    }
}

// 'z' - Zap, delete the pattern without ending cycle
class ZapCommand extends Command {
    constructor(addressRange) {
        super(addressRange);
    }

    async run(context) {
        context.patternSpace = '';
        return JumpLocation.None;
    }

    dump(indent) {
        return `${makeIndent(indent)}ZAP:\n`
            + this.addressRange.dump(indent+1);
    }
}

const CycleResult = {
    Continue: Symbol('Continue'),
    Quit: Symbol('Quit'),
    QuitSilent: Symbol('QuitSilent'),
};

class Script {
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

    dump() {
        return `SCRIPT:\n`
            + this.commands.map(command => command.dump(1)).join('');
    }
}

function parseScript(scriptString) {
    const commands = [];

    // Generate a hard-coded script for now.
    // TODO: Actually parse input!

    commands.push(new TransliterateCommand(new AddressRange(), 'abcdefABCDEF', 'ABCDEFabcdef'));
    // commands.push(new ZapCommand(new AddressRange({start: new Address(1), end: new Address(10)})));
    // commands.push(new HoldAppendCommand(new AddressRange({start: new Address(1), end: new Address(10)})));
    // commands.push(new GetCommand(new AddressRange({start: new Address(11)})));
    // commands.push(new DebugPrintCommand(new AddressRange()));

    // commands.push(new ReplaceCommand(new AddressRange({start: new Address(3), end: new Address(30)}), "LOL"));

    // commands.push(new GroupCommand(new AddressRange({ start: new Address(5), end: new Address(10) }), [
    //     // new LineNumberCommand(),
    //     // new TextCommand(new AddressRange({ start: new Address(8) }), "Well hello friends! :^)"),
    //     new QuitCommand(new AddressRange({ start: new Address(8) })),
    //     new NoopCommand(new AddressRange()),
    //     new PrintCommand(new AddressRange({ start: new Address(2), end: new Address(14) })),
    // ]));

    // commands.push(new LineNumberCommand(new AddressRange({ start: new Address(5), end: new Address(10) })));
    // commands.push(new PrintCommand());
    // commands.push(new NoopCommand());
    // commands.push(new PrintCommand());

    return new Script(commands);
}

export default {
    name: 'sed',
    usage: 'sed [OPTIONS] [SCRIPT] FILE...',
    description: 'Filter and transform text, line by line.\n\n' +
        'Treats the first positional argument as the SCRIPT if no -e options are provided. ' +
        'If a FILE is `-`, read standard input.',
    input: {
        syncLines: true
    },
    args: {
        $: 'simple-parser',
        allowPositionals: true,
        options: {
            expression: {
                description: 'Specify an additional script to execute. May be specified multiple times.',
                type: 'string',
                short: 'e',
                multiple: true,
                default: [],
            },
            quiet: {
                description: 'Suppress default printing of selected lines.',
                type: 'boolean',
                short: 'n',
                default: false,
            },
        }
    },
    execute: async ctx => {
        const { out, err } = ctx.externs;
        const { positionals, values } = ctx.locals;

        if (positionals.length < 1) {
            await err.write('sed: No inputs given\n');
            throw new Exit(1);
        }

        // "If any -e or -f options are specified, the script of editing commands shall initially be empty. The commands
        // specified by each -e or -f option shall be added to the script in the order specified. When each addition is
        // made, if the previous addition (if any) was from a -e option, a <newline> shall be inserted before the new
        // addition. The resulting script shall have the same properties as the script operand, described in the
        // OPERANDS section."
        // TODO: -f loads scripts from a file
        let scriptString = '';
        if (values.expression.length > 0) {
            scriptString = values.expression.join('\n');
        } else {
            scriptString = positionals.shift();
        }

        const script = parseScript(scriptString);
        await out.write(script.dump());

        const context = {
            out: out,
            patternSpace: '',
            holdSpace: '\n',
            lineNumber: 1,
            queuedOutput: '',
        }

        // All remaining positionals are file paths to process.
        for (const relPath of positionals) {
            context.lineNumber = 1;
            for await (const line of fileLines(ctx, relPath)) {
                context.patternSpace = line.replace(/\n$/, '');
                const result = await script.runCycle(context);
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
};
