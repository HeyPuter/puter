const axios = require('axios');
const YAML = require('yaml');

const fs = require('node:fs');
const path_ = require('node:path');
const url = require('node:url');
const https = require('node:https');
const Assert = require('./Assert');
const log_error = require('./log_error');

module.exports = class TestSDK {
    constructor (conf, context) {
        this.conf = conf;
        this.context = context;
        this.cwd = `/${conf.username}`;
        this.httpsAgent = new https.Agent({
            rejectUnauthorized: false
        })
        const url_origin = new url.URL(conf.url).origin;
        this.headers_ = {
            'Origin': url_origin,
            'Authorization': `Bearer ${conf.token}`
        };

        this.installAPIMethodShorthands_();

        this.assert = new Assert();

        this.sdks = {};

        this.results = [];
        this.failCount = 0;
        this.caseCount = 0;
        this.nameStack = [];

        this.packageResults = [];

        this.benchmarkResults = [];
    }

    async get_sdk (name) {
        return await this.sdks[name].create();
    }

    // === test related methods ===

    async runTestPackage (testDefinition) {
        this.nameStack.push(testDefinition.name);
        this.packageResults.push({
            name: testDefinition.name,
            failCount: 0,
            caseCount: 0,
        });
        const imported = {};
        for ( const key of Object.keys(testDefinition.import ?? {}) ) {
            imported[key] = this.sdks[key];
        }
        await testDefinition.do(this, imported);
        this.nameStack.pop();
    }

    async runBenchmark (benchDefinition) {
        const strid = '' +
            '\x1B[35;1m[bench]\x1B[0m' +
            this.nameStack.join(` \x1B[36;1m->\x1B[0m `);
        process.stdout.write(strid + ' ... \n');

        this.nameStack.push(benchDefinition.name);
        let results;
        this.benchmarkResults.push(results = {
            name: benchDefinition.name,
            start: Date.now(),
        });
        try {
            await benchDefinition.do(this);
        } catch (e) {
            results.error = e;
        } finally {
            results.end = Date.now();
            const dur = results.end - results.start;
            process.stdout.write(`...\x1B[32;1m[${dur}]\x1B[0m\n`);
        }
    }

    recordResult (result) {
        const pkg = this.packageResults[this.packageResults.length - 1];
        this.caseCount++;
        pkg.caseCount++;
        if ( ! result.success ) {
            this.failCount++;
            pkg.failCount++;
        }
        this.results.push(result);
    }

    async case (id, fn) {
        this.nameStack.push(id);

        // Always reset cwd at the beginning of a test suite to prevent it 
        // from affected by others.
        if (this.nameStack.length === 1) {
            this.resetCwd();
        }

        const tabs = Array(this.nameStack.length - 2).fill('  ').join('');
        const strid = tabs + this.nameStack.join(` \x1B[36;1m->\x1B[0m `);
        process.stdout.write(strid + ' ... \n');

        try {
            await fn(this.context);
        } catch (e) {
            process.stdout.write(`${tabs}...\x1B[31;1m[FAIL]\x1B[0m\n`);
            this.recordResult({
                strid,
                e,
                success: false,
            });
            log_error(e);
            return;
        } finally {
            this.nameStack.pop();
        }

        process.stdout.write(`${tabs}...\x1B[32;1m[PASS]\x1B[0m\n`);
        this.recordResult({
            strid,
            success: true
        });
    }

    quirk (msg) {
        console.log(`\x1B[33;1mignoring known quirk: ${msg}\x1B[0m`);
    }

    // === information display methods ===

    printTestResults () {
        console.log(`\n\x1B[33;1m=== Test Results ===\x1B[0m`);

        let tbl = {};
        for ( const pkg of this.packageResults ) {
            tbl[pkg.name] = {
                passed: pkg.caseCount - pkg.failCount,
                failed: pkg.failCount,
                total: pkg.caseCount,
            }
        }
        console.table(tbl);

        process.stdout.write(`\x1B[36;1m${this.caseCount} tests were run\x1B[0m - `);
        if ( this.failCount > 0 ) {
            console.log(`\x1B[31;1m✖ ${this.failCount} tests failed!\x1B[0m`);
        } else {
            console.log(`\x1B[32;1m✔ All tests passed!\x1B[0m`)
        }
    }

    printBenchmarkResults () {
        console.log(`\n\x1B[33;1m=== Benchmark Results ===\x1B[0m`);

        let tbl = {};
        for ( const bench of this.benchmarkResults ) {
            tbl[bench.name] = {
                time: bench.end - bench.start,
                error: bench.error ? bench.error.message : '',
            }
        }
        console.table(tbl);
    }

    // === path related methods ===

    cd (path) {
        this.cwd = path_.posix.join(this.cwd, path);
    }

    resetCwd () {
        // TODO (xiaochen): update the hardcoded path to a global constant
        this.cwd = '/admin/api_test';
    }

    resolve (path) {
        if ( path.startsWith('$') ) return path;
        if ( path.startsWith('/') ) return path;
        return path_.posix.join(this.cwd, path);
    }

    // === API calls ===

    installAPIMethodShorthands_ () {
        const p = this.resolve.bind(this);
        this.read = async path => {
            const res = await this.get('read', { path: p(path) });
            return res.data;
        }
        this.mkdir = async (path, opts) => {
            const res = await this.post('mkdir', {
                path: p(path),
                ...(opts ?? {})
            });
            return res.data;
        };
        // parent + path format: {"parent": "/foo", "path":"bar", args...}
        // this is used by puter-js (puter.fs.mkdir("/foo/bar"))
        this.mkdir_v2 = async (parent, path, opts) => {
            const res = await this.post('mkdir', {
                parent: p(parent),
                path: path, // "path" arg should remain relative in this api
                ...(opts ?? {})
            });
            return res.data;
        }
        this.write = async (path, bin, params) => {
            path = p(path);
            params = params ?? {};
            let mime = 'text/plain';
            if ( params.hasOwnProperty('mime') ) {
                mime = params.mime;
                delete params.mime;
            }
            let name = path_.posix.basename(path);
            path = path_.posix.dirname(path);
            params.path = path;
            const res = await this.upload('write', name, mime, bin, params);
            return res.data;
        }
        this.stat = async (path, params) => {
            path = p(path);
            const res = await this.post('stat', { ...params, path });
            return res.data;
        }
        this.statu = async (uid, params) => {
            const res = await this.post('stat', { ...params, uid });
            return res.data;
        }
        this.readdir = async (path, params) => {
            path = p(path);
            const res = await this.post('readdir', {
                ...params,
                path
            })
            return res.data;
        }
        this.delete = async (path, params) => {
            path = p(path);
            const res = await this.post('delete', {
                ...params,
                paths: [path]
            });
            return res.data;
        }
        this.move = async (src, dst, params = {}) => {
            src = p(src);
            dst = p(dst);
            const destination = path_.dirname(dst);
            const source = src;
            const new_name = path_.basename(dst);
            console.log('move', { destination, source, new_name });
            const res = await this.post('move', {
                ...params,
                destination,
                source,
                new_name,
            });
            return res.data;
        }
    }

    getURL (...path) {
        const apiURL = new url.URL(this.conf.url);
        apiURL.pathname = path_.posix.join(
            apiURL.pathname,
            ...path
        );
        return apiURL.href;
    };

    // === HTTP methods ===

    get (ep, params) {
        return axios.request({
            httpsAgent: this.httpsAgent,
            method: 'get',
            url: this.getURL(ep),
            params,
            headers: {
                ...this.headers_
            }
        });
    }

    post (ep, params) {
        return axios.request({
            httpsAgent: this.httpsAgent,
            method: 'post',
            url: this.getURL(ep),
            data: params,
            headers: {
                ...this.headers_,
                'Content-Type': 'application/json',
            }
        })
    }

    upload (ep, name, mime, bin, params) {
        const adapt_file = (bin, mime) => {
            if ( typeof bin === 'string' ) {
                return new Blob([bin], { type: mime });
            }
            return bin;
        };
        const fd = new FormData();
        for ( const k in params ) fd.append(k, params[k]);
        const blob = adapt_file(bin, mime);
        fd.append('size', blob.size);
        fd.append('file', adapt_file(bin, mime), name)
        return axios.request({
            httpsAgent: this.httpsAgent,
            method: 'post',
            url: this.getURL(ep),
            data: fd,
            headers: {
                ...this.headers_,
                'Content-Type': 'multipart/form-data'
            },
        });
    }

    async batch (ep, ops, bins) {
        const adapt_file = (bin, mime) => {
            if ( typeof bin === 'string' ) {
                return new Blob([bin], { type: mime });
            }
            return bin;
        };
        const fd = new FormData();

        fd.append('original_client_socket_id', '');
        fd.append('socket_id', '');
        fd.append('operation_id', '');

        let fileI = 0;
        for ( let i=0 ; i < ops.length ; i++ ) {
            const op = ops[i];

            fd.append('operation', JSON.stringify(op));
        }

        const files = [];

        for ( let i=0 ; i < ops.length ; i++ ) {
            const op = ops[i];

            if ( op.op === 'mkdir' ) continue;
            if ( op.op === 'mktree' ) continue;

            let mime = op.mime ?? 'text/plain';
            const file = adapt_file(bins[fileI++], mime);
            fd.append('fileinfo', JSON.stringify({
                size: file.size,
                name: op.name,
                mime,
            }));
            files.push({
                op, file,
            })

            delete op.name;
        }

        for ( const file of files ) {
            const { op, file: blob } = file;
            fd.append('file', blob, op.name);
        }

        const res = await axios.request({
            httpsAgent: this.httpsAgent,
            method: 'post',
            url: this.getURL(ep),
            data: fd,
            headers: {
                ...this.headers_,
                'Content-Type': 'multipart/form-data'
            },
        });
        return res.data.results;
    }

    batch_json (ep, ops, bins) {
        return axios.request({
            httpsAgent: this.httpsAgent,
            method: 'post',
            url: this.getURL(ep),
            data: ops,
            headers: {
                ...this.headers_,
                'Content-Type': 'application/json',
            },
        });
    }
}