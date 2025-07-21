class ProviderContext {
    constructor ({ inputs, evaluatingSet, memo } = {}) {
        this.inputs = inputs ?? {};
        this.evaluatingSet = evaluatingSet ?? new Set();
        this.memo = memo ?? {};
    }
    
    sub (inputs) {
        const allInputs = {};
        Object.assign(allInputs, this.inputs);
        Object.assign(allInputs, inputs);

        return new ProviderContext({
            inputs: allInputs,
            evaluatingSet: this.evaluatingSet,
            memo: this.memo,
        });
    }
    
    get (key) {
        return this.inputs[key];
    }
    
    getAvailableInputsSet () {
        return new Set([
            ...Object.getOwnPropertySymbols(this.inputs),
            ...Object.keys(this.inputs),
        ]);;
    }
    
    startEvaluating (outputType) {
        if ( this.evaluatingSet.has(outputType) ) {
            // TODO: diagnostic information in error
            throw new Error('cyclic evaluation');
        }
        
        this.evaluatingSet.add(outputType);
    }
    
    stopEvaluating (outputType) {
        if ( ! this.evaluatingSet.has(outputType) ) {
            // TODO: diagnostic information in error
            throw new Error('internal error: evaluation hasn\'t started');
        }
        
        this.evaluatingSet.delete(outputType);
    }
}

export class Registry {
    constructor () {
        this.singleValueProviders_ = {};
    }
    
    getDefineAPI () {
        const registry = this;

        const define = {
            howToGet (outputType) {
                const provider = { outputType, inputTypes: [] };
                
                if ( ! registry.singleValueProviders_[outputType] ) {
                    registry.singleValueProviders_[outputType] = [];
                }
                
                registry.singleValueProviders_[outputType].push(provider);
                
                const defineProviderAPI = {
                    from (...inputTypes) {
                        provider.inputTypes = inputTypes;
                        return this;
                    },
                    provided (predicateFn) {
                        provider.predicate = predicateFn;
                        return this;
                    },
                    as (fn) {
                        provider.fn = fn;
                        return this;
                    },
                };
                
                return defineProviderAPI;
            }
        };
        return define;
    }
    
    getObtainAPI (parentContext) {
        const registry = this;

        if ( ! parentContext ) parentContext = new ProviderContext();

        return async (outputType, inputs = {}) => {
            const context = parentContext.sub(inputs);
            
            // We might already have this value
            if ( context.get(outputType) ) {
                return context.get(outputType);
            }

            const providers = this.singleValueProviders_[outputType];
            if ( !providers || providers.length === 0 ) {
                throw new Error(`No providers found for output type: ${outputType.toString()}`);
            }
            
            const availableInputs = context.getAvailableInputsSet();
            
            const applicableProviders = [];
            for ( const provider of providers ) {
                if ( ! provider.fn ) {
                    // TODO: warn incomplete provider
                    continue;
                }
                
                if ( ! provider.inputTypes ) {
                    // TODO: warn incomplete provider
                    continue;
                }
                
                let canSatisfyRequiredInputs = true;
                for ( const neededInputType of provider.inputTypes ) {
                    if ( ! availableInputs.has(neededInputType) ) {
                        canSatisfyRequiredInputs = false;
                        break;
                    }
                }
                
                if ( canSatisfyRequiredInputs ) {
                    applicableProviders.push(provider);
                }
            }
            
            if ( applicableProviders.length === 0 ) {
                // TODO: diagnostic information in error message
                console.log('???', outputType, inputs, registry.singleValueProviders_);
                throw new Error(`no applicable providers: ` + outputType.description);
            }
            
            // Randomly order providers to prevent reliance on order
            const shuffledProviders = [...applicableProviders].sort(() => Math.random() - 0.5);

            const providerAPI = {
                get: valueType => context.get(valueType),
                obtain: registry.getObtainAPI(context),
                memo: context.memo,
            };
            
            for ( const provider of shuffledProviders ) {
                if ( provider.predicate ) {
                    const predicateResult = await provider.predicate(providerAPI);
                    if ( ! predicateResult ) continue;
                }
                
                return await provider.fn(providerAPI);
            }
            
            // TODO: diagnostic information in error message
            throw new Error(`no applicable providers (2)`);
        }
    }
}
