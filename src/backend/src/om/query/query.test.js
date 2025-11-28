import { describe, expect, it } from 'vitest';

const {
    Eq,
    And,
    Or,
    Null,
    IsNotNull,
    Like,
    StartsWith,
    PredicateUtil,
} = require('./query');

describe('PredicateUtil', () => {
    describe('write_human_readable', () => {
        it('writes Eq predicate as key=value', () => {
            const predicate = new Eq({ key: 'name', value: 'John' });
            const result = PredicateUtil.write_human_readable(predicate);
            expect(result).toBe('name=John');
        });

        it('writes And predicate with "and" separator', () => {
            const predicate = new And({
                children: [
                    new Eq({ key: 'name', value: 'John' }),
                    new Eq({ key: 'age', value: 25 }),
                ],
            });
            const result = PredicateUtil.write_human_readable(predicate);
            expect(result).toBe('name=John and age=25');
        });

        it('writes nested And predicates', () => {
            const predicate = new And({
                children: [
                    new Eq({ key: 'name', value: 'John' }),
                    new Eq({ key: 'age', value: 25 }),
                    new Eq({ key: 'city', value: 'NYC' }),
                ],
            });
            const result = PredicateUtil.write_human_readable(predicate);
            expect(result).toBe('name=John and age=25 and city=NYC');
        });

        it('writes Or predicate with "or" separator', () => {
            const predicate = new Or({
                children: [
                    new Eq({ key: 'status', value: 'active' }),
                    new Eq({ key: 'status', value: 'pending' }),
                ],
            });
            const result = PredicateUtil.write_human_readable(predicate);
            expect(result).toBe('status=active or status=pending');
        });

        it('writes StartsWith predicate', () => {
            const predicate = new StartsWith({ key: 'email', value: 'admin' });
            const result = PredicateUtil.write_human_readable(predicate);
            expect(result).toBe('email starts with "admin"');
        });

        it('writes IsNotNull predicate', () => {
            const predicate = new IsNotNull({ key: 'verified_at' });
            const result = PredicateUtil.write_human_readable(predicate);
            expect(result).toBe('verified_at is not null');
        });

        it('writes Like predicate', () => {
            const predicate = new Like({ key: 'name', value: '%John%' });
            const result = PredicateUtil.write_human_readable(predicate);
            expect(result).toBe('name like "%John%"');
        });

        it('writes Null predicate as empty string', () => {
            const predicate = new Null();
            const result = PredicateUtil.write_human_readable(predicate);
            expect(result).toBe('');
        });

        it('writes complex nested predicates', () => {
            const predicate = new And({
                children: [
                    new Eq({ key: 'status', value: 'active' }),
                    new Or({
                        children: [
                            new Eq({ key: 'role', value: 'admin' }),
                            new Eq({ key: 'role', value: 'moderator' }),
                        ],
                    }),
                ],
            });
            const result = PredicateUtil.write_human_readable(predicate);
            expect(result).toBe('status=active and role=admin or role=moderator');
        });
    });

    describe('simplify', () => {
        it('simplifies nested And predicates', () => {
            const predicate = new And({
                children: [
                    new And({
                        children: [
                            new Eq({ key: 'a', value: 1 }),
                            new Eq({ key: 'b', value: 2 }),
                        ],
                    }),
                    new Eq({ key: 'c', value: 3 }),
                ],
            });
            const result = PredicateUtil.simplify(predicate);
            expect(result).toBeInstanceOf(And);
            expect(result.children.length).toBe(3);
            expect(result.children[0]).toBeInstanceOf(Eq);
            expect(result.children[1]).toBeInstanceOf(Eq);
            expect(result.children[2]).toBeInstanceOf(Eq);
        });

        it('simplifies And with single child', () => {
            const predicate = new And({
                children: [
                    new Eq({ key: 'a', value: 1 }),
                ],
            });
            const result = PredicateUtil.simplify(predicate);
            expect(result).toBeInstanceOf(Eq);
            expect(result.key).toBe('a');
        });

        it('simplifies And with Null children', () => {
            const predicate = new And({
                children: [
                    new Eq({ key: 'a', value: 1 }),
                    new Null(),
                    new Eq({ key: 'b', value: 2 }),
                ],
            });
            const result = PredicateUtil.simplify(predicate);
            expect(result).toBeInstanceOf(And);
            expect(result.children.length).toBe(2);
        });

        it('simplifies And with all Null children to Null', () => {
            const predicate = new And({
                children: [
                    new Null(),
                    new Null(),
                ],
            });
            const result = PredicateUtil.simplify(predicate);
            expect(result).toBeInstanceOf(Null);
        });

        it('simplifies nested Or predicates', () => {
            const predicate = new Or({
                children: [
                    new Or({
                        children: [
                            new Eq({ key: 'a', value: 1 }),
                            new Eq({ key: 'b', value: 2 }),
                        ],
                    }),
                    new Eq({ key: 'c', value: 3 }),
                ],
            });
            const result = PredicateUtil.simplify(predicate);
            expect(result).toBeInstanceOf(Or);
            expect(result.children.length).toBe(3);
        });

        it('returns non-composite predicates unchanged', () => {
            const predicate = new Eq({ key: 'a', value: 1 });
            const result = PredicateUtil.simplify(predicate);
            expect(result).toBe(predicate);
        });
    });
});

describe('Predicate classes', () => {
    describe('Eq', () => {
        it('checks equality', async () => {
            const predicate = new Eq({ key: 'status', value: 'active' });
            const entity = {
                get: async (key) => key === 'status' ? 'active' : null,
            };
            const result = await predicate.check(entity);
            expect(result).toBe(true);
        });

        it('fails when not equal', async () => {
            const predicate = new Eq({ key: 'status', value: 'active' });
            const entity = {
                get: async (key) => key === 'status' ? 'inactive' : null,
            };
            const result = await predicate.check(entity);
            expect(result).toBe(false);
        });
    });

    describe('StartsWith', () => {
        it('checks if string starts with value', async () => {
            const predicate = new StartsWith({ key: 'email', value: 'admin' });
            const entity = {
                get: async (key) => key === 'email' ? 'admin@example.com' : null,
            };
            const result = await predicate.check(entity);
            expect(result).toBe(true);
        });

        it('fails when string does not start with value', async () => {
            const predicate = new StartsWith({ key: 'email', value: 'admin' });
            const entity = {
                get: async (key) => key === 'email' ? 'user@example.com' : null,
            };
            const result = await predicate.check(entity);
            expect(result).toBe(false);
        });
    });

    describe('IsNotNull', () => {
        it('checks if value is not null', async () => {
            const predicate = new IsNotNull({ key: 'verified_at' });
            const entity = {
                get: async (key) => key === 'verified_at' ? '2025-01-01' : null,
            };
            const result = await predicate.check(entity);
            expect(result).toBe(true);
        });

        it('fails when value is null', async () => {
            const predicate = new IsNotNull({ key: 'verified_at' });
            const entity = {
                get: async (key) => null,
            };
            const result = await predicate.check(entity);
            expect(result).toBe(false);
        });
    });

    describe('Like', () => {
        it('matches pattern with wildcards', async () => {
            const predicate = new Like({ key: 'name', value: '%John%' });
            const entity = {
                get: async (key) => key === 'name' ? 'John Doe' : null,
            };
            const result = await predicate.check(entity);
            expect(result).toBe(true);
        });

        it('fails when pattern does not match', async () => {
            const predicate = new Like({ key: 'name', value: '%Jane%' });
            const entity = {
                get: async (key) => key === 'name' ? 'John Doe' : null,
            };
            const result = await predicate.check(entity);
            expect(result).toBe(false);
        });

        it('is case insensitive', async () => {
            const predicate = new Like({ key: 'name', value: '%john%' });
            const entity = {
                get: async (key) => key === 'name' ? 'JOHN DOE' : null,
            };
            const result = await predicate.check(entity);
            expect(result).toBe(true);
        });
    });

    describe('Or', () => {
        it('returns true if any child matches', async () => {
            const predicate = new Or({
                children: [
                    new Eq({ key: 'status', value: 'active' }),
                    new Eq({ key: 'status', value: 'pending' }),
                ],
            });
            const entity = {
                get: async (key) => key === 'status' ? 'pending' : null,
                check: async (pred) => await pred.check(entity),
            };
            const result = await predicate.check(entity);
            expect(result).toBe(true);
        });

        it('returns false if no children match', async () => {
            const predicate = new Or({
                children: [
                    new Eq({ key: 'status', value: 'active' }),
                    new Eq({ key: 'status', value: 'pending' }),
                ],
            });
            const entity = {
                get: async (key) => key === 'status' ? 'inactive' : null,
                check: async (pred) => await pred.check(entity),
            };
            const result = await predicate.check(entity);
            expect(result).toBe(false);
        });
    });

    describe('Predicate.and', () => {
        it('creates an And predicate', () => {
            const pred1 = new Eq({ key: 'a', value: 1 });
            const pred2 = new Eq({ key: 'b', value: 2 });
            const result = pred1.and(pred2);
            expect(result).toBeInstanceOf(And);
            expect(result.children).toEqual([pred1, pred2]);
        });
    });
});
