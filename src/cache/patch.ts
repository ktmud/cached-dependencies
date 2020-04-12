/**
 * Monkey patch to safely import and use @action/cache modules
 */
import * as utils from '@actions/cache/src/utils/actionUtils';
import * as core from '@actions/core';
import * as fs from 'fs';
import * as os from 'os';

interface KeyValueStore {
  [key: string]: any;
}

const { logWarning, isValidEvent } = utils;
const { getState, saveState } = core;

/**
 * The default `core.saveState` only writes states as command output, and
 * `core.getState` is only possible to read the state in a later step via ENV
 * variables.
 *
 * So we use a temp file to save and load states, so to allow persistent
 * states within the same step.
 */
const stateStore = `${os.tmpdir()}/cached-dependencies-state.json`;
const states: KeyValueStore = {};

/**
 * Load states from the persistent store.
 */
function loadStates() {
  try {
    Object.assign(
      states,
      JSON.parse(fs.readFileSync(stateStore, { encoding: 'utf-8' })),
    );
    core.info(`Load states from: ${stateStore}`)
  } catch (error) {
    // pass
    if (error.code !== 'ENOENT') {
      logWarning(`Could not load states: ${stateStore}`)
      logWarning(error.message);
    }
  }
}

/**
 * Save states to the persistent storage.
 */
function persistState(name: string, value: any) {
  if (value === null || value === '') {
    delete states[name];
  } else {
    // make sure value is always string
    states[name] = typeof value === 'string' ? value : JSON.stringify(value);
  }

  // always load before write, in case some other store action is running
  // in parallel.
  loadStates();

  // persist state in the temp file
  fs.writeFileSync(stateStore, JSON.stringify(states, null, 2), {
    encoding: 'utf-8',
  });
  saveState(name, value);
}

/**
 * Get states from persistent store, fallback to "official" states.
 */
function obtainState(name: string) {
  loadStates();
  return states[name] || getState(name);
}

export function beginImport() {
  Object.defineProperty(utils, 'isValidEvent', { value: () => false });
  Object.defineProperty(utils, 'logWarning', { value: () => {} });
}

export function doneImport() {
  Object.defineProperty(utils, 'isValidEvent', { value: isValidEvent });
  Object.defineProperty(utils, 'logWarning', { value: logWarning });

  Object.defineProperty(core, 'saveState', { value: persistState });
  Object.defineProperty(core, 'getState', { value: obtainState });
}
