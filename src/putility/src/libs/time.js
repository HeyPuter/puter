/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 */

class TimeUnit {
    static valueOf () {
        return this.value;
    }
}

class MILLISECOND extends TimeUnit {
    static value = 1;
}

class SECOND extends TimeUnit {
    static value = 1000 * MILLISECOND;
}

class MINUTE extends TimeUnit {
    static value = 60 * SECOND;
}

class HOUR extends TimeUnit {
    static value = 60 * MINUTE;
}

class DAY extends TimeUnit {
    static value = 24 * HOUR;
}

const module_epoch = Date.now();
const module_epoch_d = new Date();

/**
 * Displays the current time in only the level of detail necessary based on
 * the time this module was loaded. i.e. If this module was loaded on
 * 2025-01-01 10:32:40, 5 minutes later this function would return "10:37:40",
 * one day later this function would return "02 10:32:40", and one month later
 * this function would return "02-01 10:32:40".
 * @param {*} now - current time as Date object
 */
const display_time = (now) => {
    const pad2 = n => String(n).padStart(2, '0');

    const yyyy = now.getFullYear();
    const mm   = pad2(now.getMonth() + 1);
    const dd   = pad2(now.getDate());
    const HH   = pad2(now.getHours());
    const MM   = pad2(now.getMinutes());
    const SS   = pad2(now.getSeconds());
    const time = `${HH}:${MM}:${SS}`;

    const needYear  = yyyy !== module_epoch_d.getFullYear();
    const needMonth = needYear || (now.getMonth() !== module_epoch_d.getMonth());
    const needDay   = needMonth || (now.getDate() !== module_epoch_d.getDate());

    if ( needYear ) return `${yyyy}-${mm}-${dd} ${time}`;
    if ( needMonth ) return `${mm}-${dd} ${time}`;
    if ( needDay ) return `${dd} ${time}`;
    return time; // same calendar day as first log
};

module.exports = {
    MILLISECOND,
    SECOND,
    MINUTE,
    HOUR,
    DAY,
    module_epoch,
    module_epoch_d,
    display_time,
};
