import '@heyputer/backend/src/services/User.js';
declare module '../../packages/puter/src/backend/src/services/User.d.ts' {
    export interface IUser {
        stripe_customer_id?: string;
    }
}