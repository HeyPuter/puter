// This file is pasted before user code in a puter-s2w worker. It is the worker equivilant of https://js.puter.com/v2/
function init_puter_portable(auth) {

    // For form or no body
    const headers = {
        "Authorization": auth,
        "ngrok-skip-browser-warning": "true"
    }

    // For a JSON body
    const headersAndJSON = {
        "Authorization": auth,
        "ngrok-skip-browser-warning": "true",
        "content-type": "application/json;charset=UTF-8"
    }

    globalThis.puter_pp = {
        fs: {
            read: (path) => {
                return fetch(PUTER_ENDPOINT + "/read?file=" + encodeURIComponent(path), { headers }).then(res => res.blob())
            },
            write: (path, data, options) => {
                const operation_id = crypto.randomUUID(); // SECURE CONTEXTS ONLY, wont work over http

                // Path parsing
                let directory = path.split("/");
                const fileName = directory.pop();
                directory = directory.join("/");

                if (data instanceof File) {
                    // Passthrough
                } else if (typeof (data) === "string") {
                    data = new File([data], fileName);
                } else if ((data instanceof Blob) && !(data instanceof File)) {
                    data = new File([data], fileName);
                }

                if (!options)
                    options = {};

                const operationInfo = {
                    "op": "write",
                    "dedupe_name": options.dedupeName || options.dedupe_name || false,
                    "overwrite": options.overwrite ? true : false,
                    "operation_id": operation_id,
                    "path": directory,
                    "name": fileName,
                    "item_upload_id": 0
                };

                // Replicate request exactly as puter.fs.write minus socket_id
                const writeBatchData = new FormData();
                writeBatchData.append("operation_id", operation_id);
                writeBatchData.append("fileinfo", JSON.stringify({ name: fileName, type: "application/octet-stream", size: data.size }));
                writeBatchData.append("operation", JSON.stringify(operationInfo));
                writeBatchData.append("file", data);
                return fetch(PUTER_ENDPOINT + "/batch", { method: "POST", body: writeBatchData, headers })
            },
            copy: (source, destination, options) => {
                if (!options) {
                    options = {};
                }

                passed_options = {
                    source,
                    destination,
                    overwrite: options.overwrite || undefined,
                    dedupe_name: options.dedupe_name || options.dedupeName || undefined,
                    create_missing_parents: options.create_missing_parents || options.createMissingParents || undefined,
                    new_name: options.new_name || options.new_name || undefined
                }

                return fetch(PUTER_ENDPOINT + "/copy", { method: "POST", body: JSON.stringify(passed_options), headers: headersAndJSON })

            },
            readdir: (path) => {
                return fetch(PUTER_ENDPOINT + "/readdir", { method: "POST", body: JSON.stringify({ path }), headers: headersAndJSON }).then(res => res.json())
            },
            stat: (path) => {
                return fetch(PUTER_ENDPOINT + "/stat", { method: "POST", body: JSON.stringify({ path }), headers: headersAndJSON }).then(res => res.json())
            },
            mkdir: (path, options) => {
                if (!options) {
                    options = {}
                }

                let parent = path.split("/");
                const newDir = parent.pop();
                parent = parent.join("/");

                passed_options = {
                    parent,
                    path: newDir,
                    overwrite: options.overwrite || false,
                    dedupe_name: options.dedupe_name || options.dedupeName || false,
                    create_missing_parents: options.create_missing_parents || options.createMissingParents || false
                }

                return fetch(PUTER_ENDPOINT + "/mkdir", { method: "POST", body: JSON.stringify(passed_options), headers: headersAndJSON }).then(res => res.json())
            },
            rename: (path, new_name) => {
                return fetch(PUTER_ENDPOINT + "/rename", { method: "POST", body: JSON.stringify({ path, new_name }), headers: headersAndJSON }).then(res => res.json())
            },
            move: (source, destinationPath, options) => {
                if (!options) {
                    options = {}
                }
                // Normalize
                if (destinationPath.endsWith("/")) {
                    destinationPath = destinationPath.slice(0, -1)
                }

                let destination = destinationPath.split("/");
                const new_name = destination.pop();
                destination = destination.join("/");

                passed_options = {
                    destination,
                    source,
                    new_name,
                    overwrite: options.overwrite || undefined,
                    dedupe_name: options.dedupe_name || options.dedupeName || undefined,
                    create_missing_parents: options.create_missing_parents || options.createMissingParents || undefined
                }

                return fetch(PUTER_ENDPOINT + "/move", { method: "POST", body: JSON.stringify(passed_options), headers: headersAndJSON }).then(res => res.json())
            },

        }
    }
}

function inits2w() {
    // https://unpkg.com/path-to-regexp@8.2.0/dist/index.js
    const DEFAULT_DELIMITER = "/";
    const NOOP_VALUE = (value) => value;
    const ID_START = /^[$_\p{ID_Start}]$/u;
    const ID_CONTINUE = /^[$\u200c\u200d\p{ID_Continue}]$/u;
    const DEBUG_URL = "https://git.new/pathToRegexpError";
    const SIMPLE_TOKENS = {
        // Groups.
        "{": "{",
        "}": "}",
        // Reserved.
        "(": "(",
        ")": ")",
        "[": "[",
        "]": "]",
        "+": "+",
        "?": "?",
        "!": "!",
    };
    /**
     * Escape text for stringify to path.
     */
    function escapeText(str) {
        return str.replace(/[{}()\[\]+?!:*]/g, "\\$&");
    }
    /**
     * Escape a regular expression string.
     */
    function escape(str) {
        return str.replace(/[.+*?^${}()[\]|/\\]/g, "\\$&");
    }
    /**
     * Tokenize input string.
     */
    function* lexer(str) {
        const chars = [...str];
        let i = 0;
        function name() {
            let value = "";
            if (ID_START.test(chars[++i])) {
                value += chars[i];
                while (ID_CONTINUE.test(chars[++i])) {
                    value += chars[i];
                }
            }
            else if (chars[i] === '"') {
                let pos = i;
                while (i < chars.length) {
                    if (chars[++i] === '"') {
                        i++;
                        pos = 0;
                        break;
                    }
                    if (chars[i] === "\\") {
                        value += chars[++i];
                    }
                    else {
                        value += chars[i];
                    }
                }
                if (pos) {
                    throw new TypeError(`Unterminated quote at ${pos}: ${DEBUG_URL}`);
                }
            }
            if (!value) {
                throw new TypeError(`Missing parameter name at ${i}: ${DEBUG_URL}`);
            }
            return value;
        }
        while (i < chars.length) {
            const value = chars[i];
            const type = SIMPLE_TOKENS[value];
            if (type) {
                yield { type, index: i++, value };
            }
            else if (value === "\\") {
                yield { type: "ESCAPED", index: i++, value: chars[i++] };
            }
            else if (value === ":") {
                const value = name();
                yield { type: "PARAM", index: i, value };
            }
            else if (value === "*") {
                const value = name();
                yield { type: "WILDCARD", index: i, value };
            }
            else {
                yield { type: "CHAR", index: i, value: chars[i++] };
            }
        }
        return { type: "END", index: i, value: "" };
    }
    class Iter {
        constructor(tokens) {
            this.tokens = tokens;
        }
        peek() {
            if (!this._peek) {
                const next = this.tokens.next();
                this._peek = next.value;
            }
            return this._peek;
        }
        tryConsume(type) {
            const token = this.peek();
            if (token.type !== type)
                return;
            this._peek = undefined; // Reset after consumed.
            return token.value;
        }
        consume(type) {
            const value = this.tryConsume(type);
            if (value !== undefined)
                return value;
            const { type: nextType, index } = this.peek();
            throw new TypeError(`Unexpected ${nextType} at ${index}, expected ${type}: ${DEBUG_URL}`);
        }
        text() {
            let result = "";
            let value;
            while ((value = this.tryConsume("CHAR") || this.tryConsume("ESCAPED"))) {
                result += value;
            }
            return result;
        }
    }
    /**
     * Tokenized path instance.
     */
    class TokenData {
        constructor(tokens) {
            this.tokens = tokens;
        }
    }
    /**
     * Parse a string for the raw tokens.
     */
    function parse(str, options = {}) {
        const { encodePath = NOOP_VALUE } = options;
        const it = new Iter(lexer(str));
        function consume(endType) {
            const tokens = [];
            while (true) {
                const path = it.text();
                if (path)
                    tokens.push({ type: "text", value: encodePath(path) });
                const param = it.tryConsume("PARAM");
                if (param) {
                    tokens.push({
                        type: "param",
                        name: param,
                    });
                    continue;
                }
                const wildcard = it.tryConsume("WILDCARD");
                if (wildcard) {
                    tokens.push({
                        type: "wildcard",
                        name: wildcard,
                    });
                    continue;
                }
                const open = it.tryConsume("{");
                if (open) {
                    tokens.push({
                        type: "group",
                        tokens: consume("}"),
                    });
                    continue;
                }
                it.consume(endType);
                return tokens;
            }
        }
        const tokens = consume("END");
        return new TokenData(tokens);
    }
    /**
     * Compile a string to a template function for the path.
     */
    function compile(path, options = {}) {
        const { encode = encodeURIComponent, delimiter = DEFAULT_DELIMITER } = options;
        const data = path instanceof TokenData ? path : parse(path, options);
        const fn = tokensToFunction(data.tokens, delimiter, encode);
        return function path(data = {}) {
            const [path, ...missing] = fn(data);
            if (missing.length) {
                throw new TypeError(`Missing parameters: ${missing.join(", ")}`);
            }
            return path;
        };
    }
    function tokensToFunction(tokens, delimiter, encode) {
        const encoders = tokens.map((token) => tokenToFunction(token, delimiter, encode));
        return (data) => {
            const result = [""];
            for (const encoder of encoders) {
                const [value, ...extras] = encoder(data);
                result[0] += value;
                result.push(...extras);
            }
            return result;
        };
    }
    /**
     * Convert a single token into a path building function.
     */
    function tokenToFunction(token, delimiter, encode) {
        if (token.type === "text")
            return () => [token.value];
        if (token.type === "group") {
            const fn = tokensToFunction(token.tokens, delimiter, encode);
            return (data) => {
                const [value, ...missing] = fn(data);
                if (!missing.length)
                    return [value];
                return [""];
            };
        }
        const encodeValue = encode || NOOP_VALUE;
        if (token.type === "wildcard" && encode !== false) {
            return (data) => {
                const value = data[token.name];
                if (value == null)
                    return ["", token.name];
                if (!Array.isArray(value) || value.length === 0) {
                    throw new TypeError(`Expected "${token.name}" to be a non-empty array`);
                }
                return [
                    value
                        .map((value, index) => {
                            if (typeof value !== "string") {
                                throw new TypeError(`Expected "${token.name}/${index}" to be a string`);
                            }
                            return encodeValue(value);
                        })
                        .join(delimiter),
                ];
            };
        }
        return (data) => {
            const value = data[token.name];
            if (value == null)
                return ["", token.name];
            if (typeof value !== "string") {
                throw new TypeError(`Expected "${token.name}" to be a string`);
            }
            return [encodeValue(value)];
        };
    }
    /**
     * Transform a path into a match function.
     */
    function match(path, options = {}) {
        const { decode = decodeURIComponent, delimiter = DEFAULT_DELIMITER } = options;
        const { regexp, keys } = pathToRegexp(path, options);
        const decoders = keys.map((key) => {
            if (decode === false)
                return NOOP_VALUE;
            if (key.type === "param")
                return decode;
            return (value) => value.split(delimiter).map(decode);
        });
        return function match(input) {
            const m = regexp.exec(input);
            if (!m)
                return false;
            const path = m[0];
            const params = Object.create(null);
            for (let i = 1; i < m.length; i++) {
                if (m[i] === undefined)
                    continue;
                const key = keys[i - 1];
                const decoder = decoders[i - 1];
                params[key.name] = decoder(m[i]);
            }
            return { path, params };
        };
    }
    function pathToRegexp(path, options = {}) {
        const { delimiter = DEFAULT_DELIMITER, end = true, sensitive = false, trailing = true, } = options;
        const keys = [];
        const sources = [];
        const flags = sensitive ? "" : "i";
        const paths = Array.isArray(path) ? path : [path];
        const items = paths.map((path) => path instanceof TokenData ? path : parse(path, options));
        for (const { tokens } of items) {
            for (const seq of flatten(tokens, 0, [])) {
                const regexp = sequenceToRegExp(seq, delimiter, keys);
                sources.push(regexp);
            }
        }
        let pattern = `^(?:${sources.join("|")})`;
        if (trailing)
            pattern += `(?:${escape(delimiter)}$)?`;
        pattern += end ? "$" : `(?=${escape(delimiter)}|$)`;
        const regexp = new RegExp(pattern, flags);
        return { regexp, keys };
    }
    /**
     * Generate a flat list of sequence tokens from the given tokens.
     */
    function* flatten(tokens, index, init) {
        if (index === tokens.length) {
            return yield init;
        }
        const token = tokens[index];
        if (token.type === "group") {
            const fork = init.slice();
            for (const seq of flatten(token.tokens, 0, fork)) {
                yield* flatten(tokens, index + 1, seq);
            }
        }
        else {
            init.push(token);
        }
        yield* flatten(tokens, index + 1, init);
    }
    /**
     * Transform a flat sequence of tokens into a regular expression.
     */
    function sequenceToRegExp(tokens, delimiter, keys) {
        let result = "";
        let backtrack = "";
        let isSafeSegmentParam = true;
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            if (token.type === "text") {
                result += escape(token.value);
                backtrack += token.value;
                isSafeSegmentParam || (isSafeSegmentParam = token.value.includes(delimiter));
                continue;
            }
            if (token.type === "param" || token.type === "wildcard") {
                if (!isSafeSegmentParam && !backtrack) {
                    throw new TypeError(`Missing text after "${token.name}": ${DEBUG_URL}`);
                }
                if (token.type === "param") {
                    result += `(${negate(delimiter, isSafeSegmentParam ? "" : backtrack)}+)`;
                }
                else {
                    result += `([\\s\\S]+)`;
                }
                keys.push(token);
                backtrack = "";
                isSafeSegmentParam = false;
                continue;
            }
        }
        return result;
    }
    function negate(delimiter, backtrack) {
        if (backtrack.length < 2) {
            if (delimiter.length < 2)
                return `[^${escape(delimiter + backtrack)}]`;
            return `(?:(?!${escape(delimiter)})[^${escape(backtrack)}])`;
        }
        if (delimiter.length < 2) {
            return `(?:(?!${escape(backtrack)})[^${escape(delimiter)}])`;
        }
        return `(?:(?!${escape(backtrack)}|${escape(delimiter)})[\\s\\S])`;
    }
    /**
     * Stringify token data into a path string.
     */
    function stringify(data) {
        return data.tokens
            .map(function stringifyToken(token, index, tokens) {
                if (token.type === "text")
                    return escapeText(token.value);
                if (token.type === "group") {
                    return `{${token.tokens.map(stringifyToken).join("")}}`;
                }
                const isSafe = isNameSafe(token.name) && isNextNameSafe(tokens[index + 1]);
                const key = isSafe ? token.name : JSON.stringify(token.name);
                if (token.type === "param")
                    return `:${key}`;
                if (token.type === "wildcard")
                    return `*${key}`;
                throw new TypeError(`Unexpected token: ${token}`);
            })
            .join("");
    }
    function isNameSafe(name) {
        const [first, ...rest] = name;
        if (!ID_START.test(first))
            return false;
        return rest.every((char) => ID_CONTINUE.test(char));
    }
    function isNextNameSafe(token) {
        if ((token === null || token === void 0 ? void 0 : token.type) !== "text")
            return true;
        return !ID_CONTINUE.test(token.value[0]);
    }

    // s2w router itself:
    const s2w = {
        routing: true,
        map: new Map(),
        custom(eventName, route, eventListener) {
            const matchExp = match(route);
            if (!this.map.has(eventName)) {
                this.map.set(eventName, [[matchExp, eventListener]])
            } else {
                this.map.get(eventName).push([matchExp, eventListener])
            }
        },
        get(...args) {
            this.custom("GET", ...args)
        },
        post(...args) {
            this.custom("POST", ...args)
        },
        options(...args) {
            this.custom("OPTIONS", ...args)
        },
        put(...args) {
            this.custom("PUT", ...args)
        },
        delete(...args) {
            this.custom("DELETE", ...args)
        },
        route(event) {
            const mappings = this.map.get(event.request.method);
            const url = new URL(event.request.url);
            try {
                for (const mapping of mappings) {
                    // return new Response(JSON.stringify(mapping))
                    const results = mapping[0](url.pathname)
                    if (results) {
                        event.params = results.params;
                        return mapping[1](event);
                    }
                }
            } catch (e) {
                return new Response(e, {status: 500, statusText: "Server Error"})
            }

            return new Response("Path not found", {status: 404, statusText: "Not found"});
        }
    }
    globalThis.s2w = s2w;
    self.addEventListener("fetch", (event)=> {
        if (!s2w.routing)
            return false;
        event.respondWith(s2w.route(event));
    })
}

inits2w()
init_puter_portable(puter_auth);
