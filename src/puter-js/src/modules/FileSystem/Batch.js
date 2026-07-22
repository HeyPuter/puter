import { fetchUrl } from '../../lib/networkUtils.js';

export default puter => class Batch {
    constructor () {
        this.form = new FormData();
        this.operations = [];
    }

    move (source, destination, new_name) {
        this.operations.push({
            op: 'move',
            source,
            destination,
            new_name,
        });
        return this; // for chaining
    }

    // alias for `delete`
    rm (...a) {
        return this.delete(...a);
    }

    delete (...paths) {
        for ( const path of paths ) {
            this.operations.push({
                op: 'delete',
                path,
            });
        }
    }

    async send () {
        // Prepare Form
        for ( const operation of this.operations ) {
            this.form.append('operation', JSON.stringify(operation));
        }

        // Send Request. The Content-Type (multipart boundary) is set by the
        // transport from the FormData body, so it is not passed explicitly.
        const res = await fetchUrl(`${puter.APIOrigin}/batch`, {
            method: 'POST',
            includePuterAuth: true,
            body: this.form,
        });

        return (await res.json())?.results;
    }
};
