export class SQLBatcher {

    dbPool;
    maxTimeInQueue;
    maxBatchSize;
    queue = [];
    timeouts = [];
    constructor (dbPool, maxTimeInQueue = 20, maxBatchSize = 50) {
        this.dbPool = dbPool;
        this.maxTimeInQueue = maxTimeInQueue;
        this.maxBatchSize = maxBatchSize;
    }

    async execute (sql, values) {
        return this.query(sql, values);
    }

    promise () {
        return this;
    }

    #createPublicBatchError () {
        const error = new Error('Database operation failed');
        error.code = 'dbBatchFailed';
        return error;
    }

    async query (sql, values) {
        const { promise, resolve, reject } = Promise.withResolvers();

        this.queue.push({
            sql,
            values,
            resolve,
            reject,
            timestamp: Date.now(),
        });

        if ( this.queue.length === 1 ) {
            this.timeouts.push(setTimeout(() => {
                this.flush(this.queue.splice(0, this.queue.length));
            }, this.maxTimeInQueue));
        } else if ( this.queue.length >= this.maxBatchSize ) {
            this.flush(this.queue.splice(0, this.maxBatchSize));
        }

        return promise;
    }

    async flush (batch) {
        const timeout = this.timeouts.shift();
        if ( timeout && !timeout._destroyed ) {
            clearTimeout(timeout);
        }
        if ( batch.length === 0 ) return;

        const query = `${batch.map(b => b.sql.replace(/;+\s*$/, '')).join(';')}; SELECT 1`; // SELECT 1 forces mysql2 to return array
        const values = batch.map(b => b.values ?? []).flat();

        try {
            const [results, fields] = await this.dbPool.promise().query(query, values);

            for ( let i = 0; i < batch.length; i++ ) {
                const b = batch[i];
                b.resolve([results[i], fields?.[i]]);
            }
        } catch ( error ) {
            console.warn('Error in SQLBatcher flush:', error);
            for ( const b of batch ) {
                b.reject(this.#createPublicBatchError());
            }
        }
    }
}
