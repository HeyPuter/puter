/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Compile-time narrowing checks for PuterRouter type ergonomics.
 *
 * This file is *only* here to fail the typecheck if the const-generic
 * narrowing on `req.actor` regresses. It produces no runtime artifacts of
 * interest. Delete it whenever a real test suite for the router exists.
 */
import type { Actor } from '../actor';
import { PuterRouter } from './PuterRouter';

const r = new PuterRouter();

// No options → req.actor: Actor | undefined
r.get('/anon', (req, _res) => {
    const a: Actor | undefined = req.actor;
    void a;
    // Negative: assigning the (possibly-undefined) actor to a non-null
    // `Actor` should error. If this `@ts-expect-error` comment ever stops
    // firing, narrowing is being applied where it shouldn't be.
    // @ts-expect-error req.actor is Actor | undefined here
    const b: Actor = req.actor;
    void b;
});

// requireAuth: true → req.actor: Actor (non-null)
r.get('/auth', { requireAuth: true }, (req, _res) => {
    const a: Actor = req.actor;
    void a;
    void req.actor.user.username;
});

// requireUserActor → req.actor: Actor
r.post('/me', { requireUserActor: true }, (req, _res) => {
    const a: Actor = req.actor;
    void a;
});

// adminOnly: true → req.actor: Actor
r.post('/admin', { adminOnly: true }, (req, _res) => {
    const a: Actor = req.actor;
    void a;
});

// adminOnly: extras array → req.actor: Actor
r.post('/admin-extras', { adminOnly: ['mod'] }, (req, _res) => {
    const a: Actor = req.actor;
    void a;
});

// allowedAppIds → req.actor: Actor
r.post('/from-app', { allowedAppIds: ['app-x'] }, (req, _res) => {
    const a: Actor = req.actor;
    void a;
});

// Just a subdomain gate (no auth implied) → req.actor: Actor | undefined
r.get('/subdomain', { subdomain: 'api' }, (req, _res) => {
    const a: Actor | undefined = req.actor;
    void a;
});

// Variable-typed options (boolean, not literal true) → no narrowing,
// req.actor stays Actor | undefined. This intentionally stays loose:
// dynamic options can't be reflected at the type level.
const dynamicOpts = { requireAuth: true as boolean };
r.get('/dyn', dynamicOpts, (req, _res) => {
    const a: Actor | undefined = req.actor;
    void a;
});
