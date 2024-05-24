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
import { AddressRange } from './address.js';
import { makeIndent } from './utils.js';

export const JumpLocation = {
    None: Symbol('None'),
    EndOfCycle: Symbol('EndOfCycle'),
    StartOfCycle: Symbol('StartOfCycle'),
    Label: Symbol('Label'),
    Quit: Symbol('Quit'),
    QuitSilent: Symbol('QuitSilent'),
};

export class Command {
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
export class GroupCommand extends Command {
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
export class LineNumberCommand extends Command {
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
export class AppendTextCommand extends Command {
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
export class ReplaceCommand extends Command {
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
export class DeleteCommand extends Command {
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
export class DeleteLineCommand extends Command {
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
export class GetCommand extends Command {
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
export class GetAppendCommand extends Command {
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
export class HoldCommand extends Command {
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
export class HoldAppendCommand extends Command {
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
export class InsertTextCommand extends Command {
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
export class DebugPrintCommand extends Command {
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
export class PrintCommand extends Command {
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
export class PrintLineCommand extends Command {
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
export class QuitCommand extends Command {
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
export class QuitSilentCommand extends Command {
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
export class ExchangeCommand extends Command {
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
export class TransliterateCommand extends Command {
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
export class ZapCommand extends Command {
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
