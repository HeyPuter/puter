module.exports = class TestFactory {
    static cartesian (
        name,
        coverageModel,
        { each, init }
    ) {
        const do_ = async t => {
            const states = coverageModel.states;
            
            if ( init ) await init(t);

            for ( let i=0 ; i < states.length ; i++ ) {
                const state = states[i];

                await t.case(`case ${i}`, async () => {
                    console.log('state', state);
                    await each(t, state, i);
                })
            }
        };

        return {
            name,
            do: do_,
        };
    }
}
