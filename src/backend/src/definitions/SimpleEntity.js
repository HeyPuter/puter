const { Context } = require("../util/context");

module.exports = function SimpleEntity ({ name, methods, fetchers }) {
    const create = function (values) {
        const entity = { values };
        Object.assign(entity, methods);
        for ( const fetcher_name in fetchers ) {
            entity['fetch_' + fetcher_name] = async function () {
                if ( this.values.hasOwnProperty(fetcher_name) ) {
                    return this.values[fetcher_name];
                }
                const value = await fetchers[fetcher_name].call(this);
                this.values[fetcher_name] = value;
                return value;
            }
        }
        entity.context = values.context ?? Context.get();
        entity.services = entity.context.get('services');
        return entity;
    };

    create.name = name;
    return create;
};
