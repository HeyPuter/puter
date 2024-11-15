/**
 * Filters a permission reading so that it does not contain paths through the
 * specified user. This operation is performed recursively on all paths in the
 * reading.
 * 
 * This does not prevent all possible cycles. To prevent all cycles, this filter
 * must by applied on each reading for a permission holder, specifying the
 * permission issuer as the user to filter out.
 */
const remove_paths_through_user = ({ reading, user }) => {
    const no_cycle_reading = [];

    for ( let i = 0 ; i < reading.length ; i++ ) {
        const node = reading[i];

        console.log('checking node...', node);

        if ( node.$ === 'path' ) {
            if (
                node.issuer_username === user.username
            ) {
                console.log('filtered out one');
                // process.exit(0);
                continue;
            }

            node.reading = remove_paths_through_user({
                reading: node.reading,
                user,
            });
        }

        no_cycle_reading.push(node);
    }

    console.log('\x1B[36;1m ====', reading.length - no_cycle_reading.length, 'nodes filtered out ====\x1B[0m');

    return no_cycle_reading;
};

const reading_has_terminal = ({ reading }) => {
    for ( let i = 0 ; i < reading.length ; i++ ) {
        const node = reading[i];
        if ( node.has_terminal ) {
            return true;
        }
        if ( node.$ === 'option' ) {
            return true;
        }
    }

    return false;
};

module.exports = {
    remove_paths_through_user,
    reading_has_terminal,
};
