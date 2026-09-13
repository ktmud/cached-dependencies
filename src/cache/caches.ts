/**
 * Default cache configs
 */
import * as os from 'os';
import * as path from 'path';

export interface CacheConfig {
  path: string[] | string;
  hashFiles: string[] | string;
  keyPrefix?: string;
  restoreKeys?: string[] | string;
}

export interface CacheConfigs {
  [cacheName: string]: CacheConfig;
}

// `os.homedir()` honors `$HOME` on Linux/macOS and `%USERPROFILE%` on Windows
const HOME = os.homedir();
const LOCALAPPDATA =
  process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
const platform = os.platform();
const pathByPlatform: {
  [platform: string]: { pip: string; npm: string };
} = {
  linux: {
    pip: `${HOME}/.cache/pip`,
    npm: `${HOME}/.npm`,
  },
  darwin: {
    pip: `${HOME}/Library/Caches/pip`,
    npm: `${HOME}/.npm`,
  },
  win32: {
    pip: path.join(LOCALAPPDATA, 'pip', 'Cache'),
    npm: path.join(LOCALAPPDATA, 'npm-cache'),
  },
};
const platformPaths = pathByPlatform[platform] || pathByPlatform.linux;

export default {
  pip: {
    path: platformPaths.pip,
    hashFiles: 'requirements*.txt',
  },
  npm: {
    path: platformPaths.npm,
    hashFiles: [
      `package-lock.json`,
      // support lerna monorepo with depth=2
      `*/*/package-lock.json`,
      `!node_modules/*/package-lock.json`,
    ],
  },
  yarn: {
    path: `${HOME}/.npm`,
    hashFiles: [`yarn.lock`, `*/*/yarn.lock`, `!node_modules/*/yarn.lock`],
  },
} as CacheConfigs;
