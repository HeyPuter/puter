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
import { ParserRegistry } from './dsl/ParserRegistry.js';
import { PStratum } from './strata.js';

export {
    Parser,
    ParseResult,
    ParserFactory,
} from './parse.js';

import WhitespaceParserImpl from './parse_impls/whitespace.js';
import LiteralParserImpl from './parse_impls/literal.js';
import StrUntilParserImpl from './parse_impls/StrUntilParserImpl.js';

export {
    MergeWhitespacePStratumImpl,
} from './strata_impls/MergeWhitespacePStratumImpl.js'

import {
    SequenceParserImpl,
    ChoiceParserImpl,
    RepeatParserImpl,
    NoneParserImpl,
} from './parse_impls/combinators.js';

export {
    WhitespaceParserImpl,
    LiteralParserImpl,
    SequenceParserImpl,
    ChoiceParserImpl,
    RepeatParserImpl,
    StrUntilParserImpl,
}

export {
    PStratum,
    TerminalPStratumImplType,
    DelegatingPStratumImplType,
} from './strata.js';

export {
    BytesPStratumImpl,
    StringPStratumImpl
} from './strata_impls/terminals.js';

export {
    default as FirstRecognizedPStratumImpl,
} from './strata_impls/FirstRecognizedPStratumImpl.js';

export {
    default as ContextSwitchingPStratumImpl,
} from './strata_impls/ContextSwitchingPStratumImpl.js';

export { ParserBuilder } from './dsl/ParserBuilder.js';

export class StrataParseFacade {
    static getDefaultParserRegistry() {
        const r = new ParserRegistry();
        r.register('sequence', SequenceParserImpl);
        r.register('choice', ChoiceParserImpl);
        r.register('repeat', RepeatParserImpl);
        r.register('literal', LiteralParserImpl);
        r.register('none', NoneParserImpl);

        return r;
    }
}

export class StrataParser {
    constructor () {
        this.strata = [];
        this.error = null;
    }
    add (stratum) {
        if ( ! ( stratum instanceof PStratum ) ) {
            stratum = new PStratum(stratum);
        }

        // TODO: verify that terminals don't delegate
        // TODO: verify the delegating strata delegate
        if ( this.strata.length > 0 ) {
            const delegate = this.strata[this.strata.length - 1];
            stratum.setDelegate(delegate);
        }

        this.strata.push(stratum);
    }
    next () {
        return this.strata[this.strata.length - 1].next();
    }
    parse () {
        let done, value;
        const result = [];
        for ( ;; ) {
            ({ done, value } =
                this.strata[this.strata.length - 1].next());
            if ( done ) break
            result.push(value);
        }
        if ( value ) {
            this.error = value;
        }
        return result;
    }
}
