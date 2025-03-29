class Convert {
    constructor(context) {
        this.authToken = context.authToken;
        this.APIOrigin = context.APIOrigin;
        this.appID = context.appID;
    }

    setAuthToken(authToken) {
        this.authToken = authToken;
    }

    setAPIOrigin(APIOrigin) {
        this.APIOrigin = APIOrigin;
    }

    convert = async (...args) => {
        let options = {};
        const requestParams = {};
        
        const usage = 'usage: convert({ source, dest, from, to }) or ' +
            'convert(source, dest)';

        // If args is a single object, assume it is the options object
        if (typeof args[0] === 'object' && args[0] !== null) {
            Object.assign(requestParams, args.shift());
        } else {
            if ( args.length < 2 ) throw new Error(usage);

            requestParams.source = args.shift();
            const dest = args.shift();
            if ( ! dest.includes('.') ) {
                throw new Error('cannot infer type for: ' + args[1]);
            }
            requestParams.to = (a => a.slice(a.lastIndexOf('.')+1))(dest);
            requestParams.dest = dest;
        }
        
        if ( args.length ) options.success = args.shift();
        if ( args.length ) options.error = args.shift();

        try {
            const response = await fetch(`${this.APIOrigin}/drivers/call`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`
                },
                body: JSON.stringify({
                    interface: 'convert-files',
                    method: 'convert',
                    args: requestParams,
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Conversion failed');
            }

            // Get the blob from the response
            const blob = await response.blob();

            if (options.success && typeof options.success === 'function') {
                options.success(blob);
            }

            return blob;

        } catch (error) {
            if (options.error && typeof options.error === 'function') {
                options.error(error);
            }
            throw error;
        }
    }
}

export default Convert;