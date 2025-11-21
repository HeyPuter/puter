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
const { PassThrough, Readable, Transform } = require('stream');
const { TeePromise } = require('@heyputer/putility').libs.promise;
const crypto = require('crypto');

class StreamBuffer extends TeePromise {
    constructor () {
        super();

        this.stream = new PassThrough();
        this.buffer_ = '';

        this.stream.on('data', (chunk) => {
            this.buffer_ += chunk.toString();
        });

        this.stream.on('end', () => {
            this.resolve(this.buffer_);
        });

        this.stream.on('error', (err) => {
            this.reject(err);
        });
    }
}

const stream_to_the_void = stream => {
    stream.on('data', () => {
    });
    stream.on('end', () => {
    });
    stream.on('error', () => {
    });
};

/**
 * This will split a stream (on the read side) into `n` streams.
 * The slowest reader will determine the speed the the source stream
 * is consumed at to avoid buffering.
 *
 * @param {*} source
 * @param {*} n
 * @returns
 */
const pausing_tee = (source, n) => {
    const { PassThrough } = require('stream');

    const ready_ = [];
    const streams_ = [];
    let first_ = true;
    for ( let i = 0 ; i < n ; i++ ) {
        ready_.push(true);
        const stream = new PassThrough();
        streams_.push(stream);
        stream.on('drain', () => {
            ready_[i] = true;
            if ( first_ ) {
                source.resume();
                first_ = false;
            }
            if ( ready_.every(v => !!v) ) source.resume();
        });
    }

    source.on('data', (chunk) => {
        ready_.forEach((v, i) => {
            ready_[i] = streams_[i].write(chunk);
        });
        if ( ! ready_.every(v => !!v) ) {
            source.pause();
            return;
        }
    });

    source.on('end', () => {
        for ( let i = 0 ; i < n ; i++ ) {
            streams_[i].end();
        }
    });

    source.on('error', (err) => {
        for ( let i = 0 ; i < n ; i++ ) {
            streams_[i].emit('error', err);
        }
    });

    return streams_;
};

/**
 * A debugging stream transform that logs the data it receives.
 */
class LoggingStream extends Transform {
    constructor (options) {
        super(options);
        this.count = 0;
    }

    _transform (chunk, encoding, callback) {
        const stream_id = this.id ?? 'unknown';
        console.log(`[DATA@${stream_id}] :: ${chunk.length} (${this.count++})`);
        this.push(chunk);
        callback();
    }
}

// logs stream activity
const logging_stream = source => {
    const stream = new LoggingStream();
    if ( source.id ) stream.id = source.id;
    source.pipe(stream);
    return stream;
};

/**
 * Returns a readable stream that emits the data from `originalDataStream`,
 * replacing the data at position `offset` with the data from `newDataStream`.
 * When the `newDataStream` is consumed, the `originalDataStream` will continue
 * emitting data.
 *
 * Note: `originalDataStream` will be paused until `newDataStream` is consumed.
 *
 * @param {*} originalDataStream
 * @param {*} newDataStream
 * @param {*} offset
 */
const offset_write_stream = ({
    originalDataStream, newDataStream, offset,
    replace_length = 0,
}) => {
    const passThrough = new PassThrough();
    let remaining = offset;
    let new_end = false;
    let org_end = false;
    let replaced_bytes = 0;

    let last_state = null;
    const implied = {
        get state () {
            const state =
                remaining > 0 ? STATE_ORIGINAL_STREAM :
                    new_end && org_end ? STATE_END :
                        new_end ? STATE_CONTINUE :
                            STATE_NEW_STREAM ;
            // (comment to reset indentation)
            if ( state !== last_state ) {
                last_state = state;
                if ( state.on_enter ) state.on_enter();
            }
            return state;
        },
    };

    let defer_buffer = Buffer.alloc(0);
    let new_stream_early_buffer = Buffer.alloc(0);

    const original_stream_on_data = chunk => {
        console.log('original stream data', chunk.length, implied.state);
        console.log('received from original:', chunk.toString());

        if ( implied.state === STATE_NEW_STREAM ) {
            console.warn('original stream is not paused');
            defer_buffer = Buffer.concat([defer_buffer, chunk]);
            return;
        }

        if (
            implied.state === STATE_ORIGINAL_STREAM &&
            chunk.length >= remaining
        ) {
            defer_buffer = chunk.slice(remaining);
            console.log('deferred:', defer_buffer.toString());
            chunk = chunk.slice(0, remaining);
        }

        if (
            implied.state === STATE_CONTINUE &&
            replaced_bytes < replace_length
        ) {
            const remaining_replacement = replace_length - replaced_bytes;
            if ( chunk.length <= remaining_replacement ) {
                console.log('skipping chunk', chunk.toString());
                replaced_bytes += chunk.length;
                return; // skip the chunk
            }
            console.log('skipping part of chunk', chunk.slice(0, remaining_replacement).toString());
            chunk = chunk.slice(remaining_replacement);

            // `+= remaining_replacement` and `= replace_length` are equivalent
            // at this point.
            replaced_bytes += remaining_replacement;
        }

        remaining -= chunk.length;
        console.log('pushing from org stream:', chunk.toString());
        passThrough.push(chunk);
        implied.state;
    };

    const STATE_ORIGINAL_STREAM = {
        on_enter: () => {
            console.log('STATE_ORIGINAL_STREAM');
            newDataStream.pause();
        },
    };
    const STATE_NEW_STREAM = {
        on_enter: () => {
            console.log('STATE_NEW_STREAM');
            originalDataStream.pause();
            originalDataStream.off('data', original_stream_on_data);
            newDataStream.resume();
        },
    };
    const STATE_CONTINUE = {
        on_enter: () => {
            console.log('STATE_CONTINUE');
            if ( defer_buffer.length > 0 ) {
                const remaining_replacement = replace_length - replaced_bytes;
                if ( replaced_bytes < replace_length ) {
                    if ( defer_buffer.length <= remaining_replacement ) {
                        console.log('skipping deferred', defer_buffer.toString());
                        replaced_bytes += defer_buffer.length;
                        defer_buffer = Buffer.alloc(0);
                    } else {
                        console.log('skipping deferred', defer_buffer.slice(0, remaining_replacement).toString());
                        defer_buffer = defer_buffer.slice(remaining_replacement);
                        replaced_bytes += remaining_replacement;
                    }
                }
                console.log('pushing deferred:', defer_buffer.toString());
                passThrough.push(defer_buffer);
            }
            // originalDataStream.pipe(passThrough);
            originalDataStream.on('data', original_stream_on_data);
            originalDataStream.resume();
        },
    };
    const STATE_END = {
        on_enter: () => {
            console.log('STATE_END');
            passThrough.end();
        },
    };

    implied.state;

    originalDataStream.on('data', original_stream_on_data);
    originalDataStream.on('end', () => {
        console.log('original stream end');
        org_end = true;
        implied.state;
    });

    newDataStream.on('data', chunk => {
        console.log('new stream data', chunk.toString());

        if ( implied.state === STATE_NEW_STREAM ) {
            console.log('pushing from new stream', chunk.toString());
            passThrough.push(chunk);
            return;
        }

        console.warn('new stream is not paused');
        new_stream_early_buffer = Buffer.concat([new_stream_early_buffer, chunk]);
    });
    newDataStream.on('end', () => {
        console.log('new stream end', implied.state);

        new_end = true;
        implied.state;
    });

    return passThrough;
};

class ProgressReportingStream extends Transform {
    constructor (options, { total, progress_callback }) {
        super(options);
        this.total = total;
        this.loaded = 0;
        this.progress_callback = progress_callback;
    }

    _transform (chunk, encoding, callback) {
        this.loaded += chunk.length;
        this.progress_callback({
            loaded: this.loaded,
            uploaded: this.loaded,
            total: this.total,
        });
        this.push(chunk);
        callback();
    }
}

const progress_stream = (source, { total, progress_callback }) => {
    const stream = new ProgressReportingStream({}, { total, progress_callback });
    source.pipe(stream);
    return stream;
};

class SizeLimitingStream extends Transform {
    constructor (options, { limit }) {
        super(options);
        this.limit = limit;
        this.loaded = 0;
    }

    _transform (chunk, encoding, callback) {
        this.loaded += chunk.length;
        if ( this.loaded > this.limit ) {
            const excess = this.loaded - this.limit;
            chunk = chunk.slice(0, chunk.length - excess);
        }
        this.push(chunk);
        if ( this.loaded >= this.limit ) {
            this.end();
        }
        callback();
    }
}

const size_limit_stream = (source, { limit }) => {
    const stream = new SizeLimitingStream({}, { limit });
    source.pipe(stream);
    return stream;
};

class SizeMeasuringStream extends Transform {
    constructor (options, probe) {
        super(options);
        this.probe = probe;
        this.loaded = 0;
    }

    _transform (chunk, encoding, callback) {
        this.loaded += chunk.length;
        this.probe.amount = this.loaded;
        this.push(chunk);
        callback();
    }
}

/**
 * Pass in a source stream and a probe object. The source stream you pass
 * will be the return value for chaining stream transforms/controllers.
 * The probe object will have the property `probe.amount` set to a number
 * of bytes consumed so far each time a chunk is read from the stream. When
 * the stream is consumed fully `probe.amount` will contain the total number
 * of bytes read.
 * @param {*} source - source stream
 * @param {*} probe - probe object with `amount` property (you make this)
 * @returns source
 */
const size_measure_stream = (source, probe = {}) => {
    const stream = new SizeMeasuringStream({}, probe);
    source.pipe(stream);
    return stream;
};

class StuckDetectorStream extends Transform {
    constructor (options, {
        timeout,
        on_stuck,
        on_unstuck,
    }) {
        super(options);
        this.timeout = timeout;
        this.stuck_ = false;
        this.on_stuck = on_stuck;
        this.on_unstuck = on_unstuck;
        this.last_chunk_time = Date.now();

        this._start_timer();
    }

    _start_timer () {
        if ( this.timer ) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            if ( this.stuck_ ) return;
            this.stuck_ = true;
            this.on_stuck();
        }, this.timeout);
    }

    _transform (chunk, encoding, callback) {
        if ( this.stuck_ ) {
            this.stuck_ = false;
            this.on_unstuck();
        }
        this._start_timer();
        this.push(chunk);
        callback();
    }

    _flush (callback) {
        clearTimeout(this.timer);
        callback();
    }
}

const stuck_detector_stream = (source, {
    timeout,
    on_stuck,
    on_unstuck,
}) => {
    const stream = new StuckDetectorStream({}, {
        timeout,
        on_stuck,
        on_unstuck,
    });
    source.pipe(stream);
    return stream;
};

const string_to_stream = (str, chunk_size) => {
    const s = new Readable();
    s._read = () => {
    }; // redundant? see update below
    // split string into chunks
    const chunks = [];
    for ( let i = 0; i < str.length; i += chunk_size ) {
        chunks.push(str.slice(i, Math.min(i + chunk_size, str.length)));
    }
    // push each chunk onto the readable stream
    chunks.forEach((chunk) => {
        s.push(chunk);
    });
    s.push(null);
    return s;
};

async function* chunk_stream (
    stream,
    chunk_size = 1024 * 1024 * 5,
    expected_chunk_time,
) {
    let buffer = Buffer.alloc(chunk_size);
    let offset = 0;

    const chunk_time_ewma = expected_chunk_time !== undefined
        ? expected_chunk_time
        : null;

    for await ( const chunk of stream ) {
        if ( globalThis.average_chunk_size ) {
            globalThis.average_chunk_size.put(chunk.length);
        }
        let remaining = chunk_size - offset;
        let amount = Math.min(remaining, chunk.length);

        chunk.copy(buffer, offset, 0, amount);
        offset += amount;

        while ( offset >= chunk_size ) {
            yield buffer;

            buffer = Buffer.alloc(chunk_size);
            offset = 0;

            if ( amount < chunk.length ) {
                const leftover = chunk.length - amount;
                const next_amount = Math.min(leftover, chunk_size);
                chunk.copy(buffer, offset, amount, amount + next_amount);
                offset += next_amount;
                amount += next_amount;
            }
        }

        if ( chunk_time_ewma !== null ) {
            const chunk_time = chunk_time_ewma.get();
            const sleep_time = (chunk.length / chunk_size) * chunk_time / 2;
            await new Promise(resolve => setTimeout(resolve, sleep_time));
        }
    }

    if ( offset > 0 ) {
        yield buffer.subarray(0, offset); // Yield remaining chunk if it's not empty.
    }
}

const stream_to_buffer = async (stream) => {
    const chunks = [];
    for await ( const chunk of stream ) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
};

const buffer_to_stream = (buffer) => {
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);
    return stream;
};

const hashing_stream = (source) => {
    const hash = crypto.createHash('sha256');
    const stream = new Transform({
        transform (chunk, encoding, callback) {
            hash.update(chunk);
            this.push(chunk);
            callback();
        },
    });

    source.pipe(stream);

    const hashPromise = new Promise((resolve, reject) => {
        source.on('end', () => {
            resolve(hash.digest('hex'));
        });
        source.on('error', reject);
    });

    return {
        stream,
        hashPromise,
    };
};

module.exports = {
    StreamBuffer,
    stream_to_the_void,
    pausing_tee,
    logging_stream,
    offset_write_stream,
    progress_stream,
    size_limit_stream,
    size_measure_stream,
    stuck_detector_stream,
    string_to_stream,
    chunk_stream,
    stream_to_buffer,
    buffer_to_stream,
    hashing_stream,
};
