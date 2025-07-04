import { describe, it, expect } from 'vitest';

describe('opmath', () => {
    describe('TimeWindow', () => {
        it('clears old entries', () => {
            const { TimeWindow } = require('./opmath');
            let now_value = 0;
            const now = () => now_value;
            const window = new TimeWindow({ window_duration: 1000, now });
            
            window.add(1);
            window.add(2);
            window.add(3);

            now_value = 900;

            window.add(4);
            window.add(5);
            window.add(6);

            expect(window.get()).toEqual([1, 2, 3, 4, 5, 6]);

            now_value = 1100;

            window.add(7);
            window.add(8);
            window.add(9);

            expect(window.get()).toEqual([4, 5, 6, 7, 8, 9]);

            now_value = 2000;

            expect(window.get()).toEqual([7, 8, 9]);

            now_value = 2200;

            expect(window.get()).toEqual([]);
        })
    })
});