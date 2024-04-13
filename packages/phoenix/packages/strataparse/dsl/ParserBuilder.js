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
import { SingleParserFactory } from "../parse.js";

export class ParserConfigDSL extends SingleParserFactory {
    constructor (parserFactory, cls) {
        super();
        this.parserFactory = parserFactory;
        this.cls_ = cls;
        this.parseParams_ = {};
        this.grammarParams_ = {
            assign: {},
        };
    }

    parseParams (obj) {
        Object.assign(this.parseParams_, obj);
        return this;
    }

    assign (obj) {
        Object.assign(this.grammarParams_.assign, obj);
        return this;
    }

    create () {
        return this.parserFactory.create(
            this.cls_, this.parseParams_, this.grammarParams_,
        );
    }
}

export class ParserBuilder {
    constructor ({
        parserFactory,
        parserRegistry,
    }) {
        this.parserFactory = parserFactory;
        this.parserRegistry = parserRegistry;
        this.parserAPI_ = null;
    }

    get parserAPI () {
        if ( this.parserAPI_ ) return this.parserAPI_;

        const parserAPI = {};

        const parsers = this.parserRegistry.parsers;
        for ( const parserId in parsers ) {
            const parserCls = parsers[parserId];
            parserAPI[parserId] =
                this.createParserFunction(parserCls);
        }

        return this.parserAPI_ = parserAPI;
    }

    createParserFunction (parserCls) {
        if ( parserCls.hasOwnProperty('createFunction') ) {
            return parserCls.createFunction({
                parserFactory: this.parserFactory
            });
        }

        return params => {
            const configDSL = new ParserConfigDSL(parserCls)
            configDSL.parseParams(params);
            return configDSL;
        };
    }

    def (def) {
        const a = this.parserAPI;
        return def(a);
    }
}