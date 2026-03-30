import { IUser } from '../User';

export interface ActorLogFields {
    uid: string;
    username?: string;
}

export class SystemActorType {
    constructor (_o?: Record<string, unknown>);
    get uid (): string;
    get_related_type (_type_class: unknown): SystemActorType;
}

export class UserActorType {
    constructor (_params: { user: IUser; session?: { uuid: string }; hasHttpOnlyCookie?: boolean });
    user: IUser;
    /** When true, this actor can access user-protected HTTP endpoints (e.g. change password). GUI tokens set this false. */
    hasHttpOnlyCookie: boolean;
    get uid (): string;
    get_related_type (_type_class: unknown): UserActorType;
}

export class AppUnderUserActorType {
    constructor (_params: { user: IUser, app: { id?: number; uid: string } });
    user: IUser;
    app: { id?: number; uid: string };
    get uid (): string;
    get_related_type (_type_class: unknown): UserActorType | AppUnderUserActorType;
}

export class AccessTokenActorType {
    constructor (_params: { authorizer: Actor, authorized?: Actor, token: string });
    authorizer: Actor;
    authorized?: Actor;
    token: string;
    get uid (): string;
    get_related_actor (): never;
}

export class SiteActorType {
    constructor (_params: { site: { name: string } });
    site: { name: string };
    get uid (): string;
}

export type ActorType =
    | SystemActorType
    | UserActorType
    | AppUnderUserActorType
    | AccessTokenActorType
    | SiteActorType;

export interface ActorInit {
    type: ActorType;
}

export class Actor {
    constructor (_init: ActorInit);
    type: ActorType & {
        user?: IUser;
        app?: { id?: number; uid: string; timestamp?: Date };
        authorizer?: Actor;
    };
    get uid (): string;
    get private_uid (): string;
    toLogFields (): ActorLogFields;
    clone (): Actor;
    get_related_actor (_type_class: unknown): Actor;
    static create (
        _type: new (_params?: Record<string, unknown>) => ActorType,
        _params?: {
            user_uid?: string;
            app_uid?: string;
            user?: IUser;
            app?: { uid: string };
            [key: string]: unknown;
        },
    ): Promise<Actor>;
    static get_system_actor (): Actor;
    static adapt (_actor?: Actor | { username?: string, uuid?: string }): Actor;
}
