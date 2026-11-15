import { describe, expect, it } from 'vitest';
import check_password_strength from './checkPasswordStrength.js';

describe('check_password_strength', () => {
    it('passes a password that meets every criterion', () => {
        expect(check_password_strength('Abcdefg1!').overallPass).toBe(true);
    });

    it.each(['Abcdefg1~', 'Abcdefg1`', 'Abcdefg 1', 'Abcdefg1€', 'Abcdefg1£'])('counts any symbol, punctuation, or space as special: %s', (password) => {
        const result = check_password_strength(password);
        expect(result.report.hasSpecialChar.pass).toBe(true);
        expect(result.overallPass).toBe(true);
    });

    it('does not count letters or digits as special', () => {
        const result = check_password_strength('Abcdéfg12');
        expect(result.report.hasSpecialChar.pass).toBe(false);
        expect(result.overallPass).toBe(false);
    });

    it.each([
        ['Abc1!', 'minLength'],
        ['abcdefg1!', 'hasUpperCase'],
        ['ABCDEFG1!', 'hasLowerCase'],
        ['Abcdefgh!', 'hasNumber'],
    ])('fails %s on %s', (password, criterion) => {
        const result = check_password_strength(password);
        expect(result.report[criterion].pass).toBe(false);
        expect(result.overallPass).toBe(false);
    });
});
