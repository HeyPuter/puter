import { isInteractive, canPrompt } from '../lib/env.js';
import { saveToken } from '../lib/config.js';
import { makeClient } from '../lib/client.js';
import { interactiveLogin, readStdin } from '../lib/auth.js';
import { CLIError } from '../lib/errors.js';
import * as ui from '../lib/ui.js';

const BETA_NOTICE =
  ui.dim('Note: the Puter CLI is in beta (0.x) — behavior may change.');

export async function loginCommand(opts) {
  let token;

  if (opts.withToken) {
    // Token comes from stdin, never argv. If stdin is a TTY there's nothing
    // piped in and a read would hang — fail fast with guidance instead.
    if (canPrompt()) {
      throw new CLIError(
        'No token piped in.',
        { hint: 'Usage: echo $TOKEN | puter login --with-token' },
      );
    }
    token = await readStdin();
    if (!token) {
      throw new CLIError('Empty token received on stdin.');
    }
  } else if (isInteractive() && canPrompt()) {
    token = await interactiveLogin();
  } else {
    throw new CLIError(
      'Cannot log in non-interactively without a token.',
      { hint: 'Pipe one in: echo $TOKEN | puter login --with-token' },
    );
  }

  // Verify the token before persisting it.
  const puter = makeClient(token);
  let user;
  try {
    user = await puter.auth.getUser();
  } catch (err) {
    throw new CLIError(`Token rejected: ${err.message}`);
  }

  saveToken(token);
  ui.success(`Logged in as ${ui.bold(user?.username ?? 'unknown')}`);
  ui.status(BETA_NOTICE);
}
