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

        // Send Request
        const res = await fetch(`${puter.APIOrigin}/batch`, {
            headers: {
                Authorization: `Bearer ${puter.authToken}`,
                ...(['web', 'app'].includes(puter.env) ? {
                    Origin: 'https://puter.work',
                } : {}),
            },
            method: 'POST',
            body: this.form,
        });

        return (await res.json())?.results;
    }
};
