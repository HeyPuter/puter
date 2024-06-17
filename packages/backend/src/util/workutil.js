class WorkList {
    constructor () {
        this.locked_ = false;
        this.items = [];
    }
    
    list () {
        return [...this.items];
    }
    
    clear_invalid () {
        const new_items = [];
        for ( let i=0 ; i < this.items.length ; i++ ) {
            const item = this.items[i];
            if ( item.invalid ) continue;
            new_items.push(item);
        }
        this.items = new_items;
    }
    
    push (item) {
        if ( this.locked_ ) {
            throw new Error(
                'work items were already locked in; what are you doing?'
            );
        }
        this.items.push(item);
    }
    
    lockin () {
        this.locked_ = true;
    }
}

module.exports = {
    WorkList,
};
