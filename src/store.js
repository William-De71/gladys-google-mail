// -----------------------------------------------------------------------------
// The persistent state of the integration, in /data/state.json (the only
// writable place of the container): OAuth tokens, the pending authorization
// (state + PKCE verifier, kept across a restart between "Connect" and the
// return from Google) and the Gmail history cursor.
//
// Written atomically (temporary file + rename) with 0600 permissions. A
// missing or unreadable file is an empty state, never a crash.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const FILE_NAME = 'state.json';
const EMPTY = Object.freeze({
  tokens: { accessToken: '', refreshToken: '', expiresAt: 0, clientId: '', scope: '' },
  pendingAuth: { state: '', verifier: '' },
  history: { id: '', at: 0, account: '' },
});

/**
 * @description A small JSON store in a directory.
 * @param {string} directory - The directory (/data in production).
 * @returns {object} `{ load, save, get }`.
 */
function createStore(directory) {
  const file = join(directory, FILE_NAME);
  let data = structuredClone(EMPTY);
  let writing = Promise.resolve();

  return {
    /** @returns {object} A copy of the current state. */
    get: () => structuredClone(data),

    /**
     * @description Read the file (an absent or broken file is an empty state).
     * @returns {Promise<object>} The state.
     */
    async load() {
      try {
        const parsed = JSON.parse(await readFile(file, 'utf8'));
        data = {
          tokens: { ...EMPTY.tokens, ...(parsed?.tokens ?? {}) },
          pendingAuth: { ...EMPTY.pendingAuth, ...(parsed?.pendingAuth ?? {}) },
          history: { ...EMPTY.history, ...(parsed?.history ?? {}) },
        };
      } catch {
        data = structuredClone(EMPTY);
      }
      return structuredClone(data);
    },

    /**
     * @description Merge a part of the state and write the file, one write
     * at a time.
     * @param {object} patch - `{ tokens?, pendingAuth?, history? }` (shallow per section).
     * @returns {Promise<void>}
     */
    save(patch) {
      for (const section of Object.keys(EMPTY)) {
        if (patch[section]) {
          data[section] = { ...data[section], ...patch[section] };
        }
      }
      const snapshot = JSON.stringify(data);
      writing = writing
        .catch(() => {})
        .then(async () => {
          await mkdir(directory, { recursive: true });
          const temporary = `${file}.tmp`;
          await writeFile(temporary, snapshot, { mode: 0o600 });
          await rename(temporary, file);
        });
      return writing;
    },
  };
}

export { createStore, EMPTY, FILE_NAME };
