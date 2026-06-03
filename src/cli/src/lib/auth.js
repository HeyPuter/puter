// Authentication flows + the gate every authenticated command goes through.

import * as clack from '@clack/prompts';
import { isInteractive, canPrompt } from './env.js';
import { getToken, saveToken } from './config.js';
import { makeClient, getAuthTokenViaBrowser } from './client.js';
import { CLIError } from './errors.js';

function bailIfCancelled(value) {
  if (clack.isCancel(value)) {
    throw new CLIError('Cancelled.');
  }
  return value;
}

// Read a token from stdin (the `--with-token` model — keeps it out of argv,
// shell history and `ps`).
export async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').trim();
}

// Interactive login. Web-browser flow only — username/password login is no
// longer supported by the platform. Returns a token.
export async function interactiveLogin() {
  try {
    return await getAuthTokenViaBrowser();
  } catch (err) {
    throw new CLIError(`Web login failed: ${err.message}`, {
      hint: 'You can instead run: echo $TOKEN | puter login --with-token',
    });
  }
}

// The gate: resolve a token (env → stored → inline login) and return a client.
export async function ensureClient() {
  let token = getToken();
  if (!token) {
    if (isInteractive() && canPrompt()) {
      const proceed = bailIfCancelled(
        await clack.confirm({ message: 'Not logged in — log in now?' }),
      );
      if (!proceed) {
        throw new CLIError('Not authenticated.');
      }
      token = await interactiveLogin();
      saveToken(token);
    } else {
      throw new CLIError(
        'Not authenticated.',
        { hint: "Set PUTER_AUTH_TOKEN or run 'puter login'." },
      );
    }
  }
  return makeClient(token);
}
