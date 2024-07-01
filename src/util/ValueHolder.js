/**
 * Holds an observable value.
 */
export default class ValueHolder {
    constructor (initial_value) {
        this.value_ = null;
        this.listeners_ = [];

        Object.defineProperty(this, 'value', {
            set: this.set_.bind(this),
            get: this.get_.bind(this),
        });

        if (initial_value !== undefined) {
            this.set(initial_value);
        }
    }

    static adapt (value) {
        if (value instanceof ValueHolder) {
            return value;
        } else {
            return new ValueHolder(value);
        }
    }

    set (value) {
        this.value = value;
    }

    get () {
        return this.value;
    }

    sub (listener) {
        this.listeners_.push(listener);
    }

    set_ (value) {
        const old_value = this.value_;
        this.value_ = value;
        const more = {
            holder: this,
            old_value,
        };
        this.listeners_.forEach(listener => listener(value, more));
    }

    get_ () {
        return this.value_;
    }

    map (fn) {
        const holder = new ValueHolder();
        this.sub((value, more) => holder.set(fn(value, more)));
        return holder;
    }
}
