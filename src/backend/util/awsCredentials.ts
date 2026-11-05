/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

type CredentialChain = ReturnType<typeof fromNodeProviderChain>;

export type AwsCredentials =
    { accessKeyId: string; secretAccessKey: string } | CredentialChain;

let chain: CredentialChain | null = null;

/**
 * Credentials for an AWS client from a `{ access_key, secret_key,
 * useCredentialChain }` config block, or null when it has neither. The default
 * chain is one shared provider that refreshes temporary credentials itself.
 */
export const awsCredentialsFrom = (
    conf:
        | {
              access_key?: unknown;
              secret_key?: unknown;
              useCredentialChain?: unknown;
          }
        | undefined,
): AwsCredentials | null => {
    if (conf?.useCredentialChain === true) {
        chain ??= fromNodeProviderChain();
        return chain;
    }
    const accessKeyId = conf?.access_key;
    const secretAccessKey = conf?.secret_key;
    if (
        typeof accessKeyId === 'string' &&
        accessKeyId &&
        typeof secretAccessKey === 'string' &&
        secretAccessKey
    ) {
        return { accessKeyId, secretAccessKey };
    }
    return null;
};
