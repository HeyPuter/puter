import putility from '@heyputer/putility';

export const TFilesystem = 'TFilesystem';

// TODO: UNUSED (eventually putility will support these definitions)
//       This is here so that the idea is not forgotten.
export const IFilesystem = {
    methods: {
        stat: {
            parameters: {
                path: {
                    alias: 'uid',
                },
            },
        },
    },

};

export class ProxyFilesystem extends putility.AdvancedBase {
    static PROPERTIES = {
        delegate: () => {
        },
    };
    // TODO: constructor implied by properties
    constructor ({ delegate }) {
        super();
        this.delegate = delegate;
    }
    static IMPLEMENTS = {
        [TFilesystem]: {
            stat: async function (o) {
                return this.delegate.stat(o);
            },
            readdir: async function (o) {
                return this.delegate.readdir(o);
            },
        },
    };
}
