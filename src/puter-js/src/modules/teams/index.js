import { PuterModule } from '../../lib/PuterModule.js';
import { create } from './create.js';
import { createMember } from './createMember.js';
import { del } from './delete.js';
import { deleteMemberAccount } from './deleteMemberAccount.js';
import { disableMember } from './disableMember.js';
import { enableMember } from './enableMember.js';
import { get } from './get.js';
import { list } from './list.js';
import { listAudit } from './listAudit.js';
import { listMembers } from './listMembers.js';
import { listOwnAudit } from './listOwnAudit.js';
import { resendActivation } from './resendActivation.js';
import { resetPassword } from './resetPassword.js';
import { update } from './update.js';

/** @typedef {import('../../index.js').Puter} Puter */

// Every `this`-context method exposed on the module, rebound in the
// constructor so both `puter.teams.create(...)` and destructured
// `const { create } = puter.teams` calls keep the right `this`.
const METHODS = [
    'create', 'list', 'get', 'update', 'delete',
    'listMembers', 'createMember', 'resendActivation',
    'disableMember', 'enableMember', 'resetPassword', 'deleteMemberAccount',
    'listAudit', 'listOwnAudit',
];

/**
 * The `puter.teams` module — team administration.
 *
 * Every method takes a team `uid`, never a handle: a handle is a mutable
 * label that deleting the team releases, so a stored one can later resolve
 * to a different team.
 *
 * Method implementations live in the sibling files as `this`-context functions
 * whose JSDoc (including the per-form `@overload` declarations) is the source
 * of truth for the public signatures — `types/` is generated from it, never
 * edited by hand.
 */
export class TeamsModule extends PuterModule {
    // The fields hold the unbound functions so they keep the full overloaded
    // types (`bind` erases overloads); the constructor rebinds them at runtime
    // so destructured calls keep working.
    create = create;
    list = list;
    get = get;
    update = update;
    delete = del;

    listMembers = listMembers;
    createMember = createMember;
    resendActivation = resendActivation;
    disableMember = disableMember;
    enableMember = enableMember;
    resetPassword = resetPassword;
    deleteMemberAccount = deleteMemberAccount;

    listAudit = listAudit;
    listOwnAudit = listOwnAudit;

    /** @param {Puter} puter */
    constructor (puter) {
        super(puter);

        const methods = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (
            /** @type {unknown} */ (this)
        );
        for ( const name of METHODS ) {
            methods[name] = methods[name].bind(this);
        }
    }
}

/**
 * The public face of the module: derived from the class, with the internal
 * `puter` handle and the legacy `authToken` accessor omitted.
 *
 * @typedef {import('../../lib/types.js').OmitMembers<
 *     typeof TeamsModule,
 *     'puter' | 'authToken'
 * >} TeamsConstructor
 */

export const Teams = /** @type {TeamsConstructor} */ (TeamsModule);

export default Teams;
