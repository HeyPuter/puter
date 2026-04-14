export async function runWithConcurrencyLimit<TInput, TOutput> (
    values: TInput[],
    concurrency: number,
    worker: (value: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
    if ( values.length === 0 ) {
        return [];
    }

    const limit = Math.max(1, concurrency);
    const results = new Array<TOutput>(values.length);
    let nextIndex = 0;

    const runWorker = async () => {
        while ( true ) {
            const index = nextIndex;
            if ( index >= values.length ) {
                return;
            }
            nextIndex++;
            const value = values[index];
            if ( value === undefined ) {
                throw new Error(`Missing value at index ${index}`);
            }
            results[index] = await worker(value, index);
        }
    };

    const workerCount = Math.min(limit, values.length);
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    return results;
}

export async function runWithConcurrencyLimitSettled<TInput, TOutput> (
    values: TInput[],
    concurrency: number,
    worker: (value: TInput, index: number) => Promise<TOutput>,
): Promise<PromiseSettledResult<TOutput>[]> {
    if ( values.length === 0 ) {
        return [];
    }

    const limit = Math.max(1, concurrency);
    const results = new Array<PromiseSettledResult<TOutput>>(values.length);
    let nextIndex = 0;

    const runWorker = async () => {
        while ( true ) {
            const index = nextIndex;
            if ( index >= values.length ) {
                return;
            }
            nextIndex++;
            const value = values[index];
            if ( value === undefined ) {
                throw new Error(`Missing value at index ${index}`);
            }

            try {
                const output = await worker(value, index);
                results[index] = {
                    status: 'fulfilled',
                    value: output,
                };
            } catch ( error ) {
                results[index] = {
                    status: 'rejected',
                    reason: error,
                };
            }
        }
    };

    const workerCount = Math.min(limit, values.length);
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    return results;
}
