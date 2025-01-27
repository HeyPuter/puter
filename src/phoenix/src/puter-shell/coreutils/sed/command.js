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
import { AddressRange } from './address.js';
import { makeIndent } from './utils.js';

export const JumpLocation = {
    None: Symbol('None'),
    EndOfCycle: Symbol('EndOfCycle'),
    StartOfCycle: Symbol('StartOfCycle'),
    Label: Symbol('Label'),
    GroupEnd: Symbol('GroupEnd'),
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
export class GroupStartCommand extends Command {
    constructor(addressRange, id) {
        super(addressRange);
        this.id = id;
    }

    async runCommand(context) {
        if (!this.addressRange.matches(context.lineNumber, context.patternSpace)) {
            context.jumpParameter = this.id;
            return JumpLocation.GroupEnd;
        }
        return JumpLocation.None;
    }

    dump(indent) {
        return `${makeIndent(indent)}GROUP-START: #${this.id}\n`
            + this.addressRange.dump(indent+1);
    }
}
export class GroupEndCommand extends Command {
    constructor(id) {
        super();
        this.id = id;
    }

    async run(context) {
        return JumpLocation.None;
    }

    dump(indent) {
        return `${makeIndent(indent)}GROUP-END: #${this.id}\n`;
    }
}

// ':' - Label
export class LabelCommand extends Command {
    constructor(label) {
        super();
        this.label = label;
    }

    async run(context) {
        return JumpLocation.None;
    }

    dump(indent) {
        return `${makeIndent(indent)}LABEL:\n`
            + this.addressRange.dump(indent+1)
            + `${makeIndent(indent+1)}NAME: ${this.label}\n`;
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

// 'b' - Branch to label
// 't' - Branch if substitution successful
// 'T' - Branch if substitution unsuccessful
export class BranchCommand extends Command {
    constructor(addressRange, label, substitutionCondition) {
        super(addressRange);
        this.label = label;
        this.substitutionCondition = substitutionCondition;
    }

    async run(context) {
        if (typeof this.substitutionCondition === 'boolean') {
            if (context.substitutionResult !== this.substitutionCondition)
                return JumpLocation.None;
        }

        if (this.label) {
            context.jumpParameter = this.label;
            return JumpLocation.Label;
        }
        return JumpLocation.EndOfCycle;
    }

    dump(indent) {
        return `${makeIndent(indent)}BRANCH:\n`
            + `${makeIndent(indent+1)}CONDITION: ${this.substitutionCondition ?? 'ALWAYS'}\n`
            + this.addressRange.dump(indent+1)
            + `${makeIndent(indent+1)}LABEL: ${this.label ? `'${this.label}'` : 'END'}\n`;
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
// 'D' - Delete first line of pattern
export class DeleteCommand extends Command {
    constructor(addressRange, firstLine = false) {
        super(addressRange);
        this.firstLine = firstLine;
    }

    async run(context) {
        if (this.firstLine) {
            const [ first, rest ] = context.patternSpace.split('\n', 2);
            context.patternSpace = rest ?? '';
            if (rest === undefined)
                return JumpLocation.EndOfCycle;
            return JumpLocation.StartOfCycle;
        }
        context.patternSpace = '';
        return JumpLocation.EndOfCycle;
    }

    dump(indent) {
        return `${makeIndent(indent)}DELETE: ${this.firstLine ? 'LINE' : 'ALL'}\n`
            + this.addressRange.dump(indent+1);
    }
}

// 'g' - Get the held line into the pattern
// 'G' - Get the held line and append it to the pattern
export class GetCommand extends Command {
    constructor(addressRange, append = false) {
        super(addressRange);
        this.append = append;
    }

    async run(context) {
        if (this.append) {
            context.patternSpace += '\n' + context.holdSpace;
        } else {
            context.patternSpace = context.holdSpace;
        }
        return JumpLocation.None;
    }

    dump(indent) {
        return `${makeIndent(indent)}GET-HELD: ${this.append ? 'APPEND' : 'ALL'}\n`
            + this.addressRange.dump(indent+1);
    }
}

// 'h' - Hold the pattern
// 'H' - Hold append the pattern
export class HoldCommand extends Command {
    constructor(addressRange, append = false) {
        super(addressRange);
        this.append = append;
    }

    async run(context) {
        if (this.append) {
            context.holdSpace += '\n' + context.patternSpace;
        } else {
            context.holdSpace = context.patternSpace;
        }
        return JumpLocation.None;
    }

    dump(indent) {
        return `${makeIndent(indent)}HOLD: ${this.append ? 'APPEND' : 'ALL'}\n`
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
        await context.out.write(output + '\n');
        return JumpLocation.None;
    }

    dump(indent) {
        return `${makeIndent(indent)}DEBUG-PRINT:\n`
            + this.addressRange.dump(indent+1);
    }
}

// 'p' - Print pattern
// 'P' - Print first line of pattern
export class PrintCommand extends Command {
    constructor(addressRange, firstLine = false) {
        super(addressRange);
        this.firstLine = firstLine;
    }

    async run(context) {
        if (this.firstLine) {
            const firstLine = context.patternSpace.split('\n', 2)[0];
            await context.out.write(firstLine + '\n');
        } else {
            await context.out.write(context.patternSpace + '\n');
        }
        return JumpLocation.None;
    }

    dump(indent) {
        return `${makeIndent(indent)}PRINT: ${this.firstLine ? 'LINE' : 'ALL'}\n`
            + this.addressRange.dump(indent+1);
    }
}

// 'q' - Quit
// 'Q' - Quit, suppressing the default output
export class QuitCommand extends Command {
    constructor(addressRange, silent) {
        super(addressRange);
        this.silent = silent;
    }

    async run(context) {
        return this.silent ? JumpLocation.QuitSilent : JumpLocation.Quit;
    }

    dump(indent) {
        return `${makeIndent(indent)}QUIT:\n`
            + this.addressRange.dump(indent+1)
            + `${makeIndent(indent+1)}SILENT = '${this.silent}'\n`;
    }
}

// 's' - Substitute
export class SubstituteFlags {
    constructor({ global = false, nthOccurrence = null, print = false, writeToFile = null } = {}) {
        this.global = global;
        this.nthOccurrence = nthOccurrence;
        this.print = print;
        this.writeToFile = writeToFile;
    }
}
export class SubstituteCommand extends Command {
    constructor(addressRange, regex, replacement, flags = new SubstituteFlags()) {
        if (!(flags instanceof SubstituteFlags)) {
            throw new Error('flags provided to SubstituteCommand must be an instance of SubstituteFlags');
        }
        super(addressRange);
        this.regex = regex;
        this.replacement = replacement;
        this.flags = flags;
    }

    async run(context) {
        if (this.flags.global) {
            // replaceAll() requires that the regex have the g flag
            const regex = new RegExp(this.regex, 'g');
            context.substitutionResult = regex.test(context.patternSpace);
            context.patternSpace = context.patternSpace.replaceAll(regex, this.replacement);
        } else if (this.flags.nthOccurrence && this.flags.nthOccurrence !== 1) {
            // Note: For n=1, it's easier to use the "replace first match" path below instead.

            // matchAll() requires that the regex have the g flag
            const matches = [...context.patternSpace.matchAll(new RegExp(this.regex, 'g'))];
            const nthMatch = matches[this.flags.nthOccurrence - 1]; // n is 1-indexed
            if (nthMatch !== undefined) {
                // To only replace the Nth match:
                // - Split the string in two, at the match position
                // - Run the replacement on the second half
                // - Combine that with the first half again
                const firstHalf = context.patternSpace.substring(0, nthMatch.index);
                const secondHalf = context.patternSpace.substring(nthMatch.index);
                context.patternSpace = firstHalf + secondHalf.replace(this.regex, this.replacement);
                context.substitutionResult = true;
            } else {
                context.substitutionResult = false;
            }
        } else {
            context.substitutionResult = this.regex.test(context.patternSpace);
            context.patternSpace = context.patternSpace.replace(this.regex, this.replacement);
        }

        if (context.substitutionResult) {
            if  (this.flags.print) {
                await context.out.write(context.patternSpace + '\n');
            }

            if (this.flags.writeToFile) {
                // TODO: Implement this.
            }
        }

        return JumpLocation.None;
    }

    dump(indent) {
        return `${makeIndent(indent)}SUBSTITUTE:\n`
            + this.addressRange.dump(indent+1)
            + `${makeIndent(indent+1)}REGEX       '${this.regex}'\n`
            + `${makeIndent(indent+1)}REPLACEMENT '${this.replacement}'\n`
            + `${makeIndent(indent+1)}FLAGS       ${JSON.stringify(this.flags)}\n`;
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
