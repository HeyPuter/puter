// Output helpers.
//
// Convention: status, progress, prompts and spinners go to STDERR; actual
// data (URLs, JSON, list rows) goes to STDOUT. That way `puter site list`
// can be piped without status noise contaminating the data stream.

import chalk from 'chalk';
import * as clack from '@clack/prompts';
import { canAnimate } from './env.js';

// Data → stdout
export function out(line = '') {
  console.log(line);
}

// Status → stderr
export function status(line = '') {
  console.error(line);
}

export function success(msg) {
  console.error(chalk.green('✔') + ' ' + msg);
}

export function warn(msg) {
  console.error(chalk.yellow('!') + ' ' + msg);
}

export function info(msg) {
  console.error(chalk.dim(msg));
}

// Verbose diagnostics → stderr, only when PUTER_DEBUG is set.
export function debug(...args) {
  if (process.env.PUTER_DEBUG) {
    console.error(chalk.magenta('[debug]'), ...args);
  }
}

export function url(u) {
  return chalk.cyan(u);
}

export function bold(s) {
  return chalk.bold(s);
}

export function dim(s) {
  return chalk.dim(s);
}

// Spinner that degrades to a one-line stderr message when output isn't a TTY.
export function spinner(startText) {
  if (canAnimate()) {
    const s = clack.spinner();
    s.start(startText);
    return s;
  }
  console.error(startText);
  return {
    message() {},
    stop(text) {
      if (text) console.error(text);
    },
  };
}
