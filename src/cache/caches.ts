/**
 * Default cache configs
 */
import * as os from 'os';

export interface CacheConfig {
  path: string[];
  hashFiles: string[];
  keyPrefix?: string;
  restoreKeys?: string[];
}

export interface CacheConfigs {
  [cacheName: string]: CacheConfig;
}

const platform = os.platform() as 'linux' | 'darwin' | 'win32';
const pathByPlatform = {
  linux: {
    pip: [`${process.env.HOME}/.cache/pip`],
  },
  darwin: {
    pip: [`${process.env.HOME}/Library/Caches/pip`],
  },
  win32: {
    pip: [`${process.env.HOME}\\AppData\\Local\\pip\\Cache`],
  },
};

export default {
  pip: {
    path: pathByPlatform[platform].pip,
    hashFiles: ['requirements*.txt'],
  },
  npm: {
    path: [`${process.env.HOME}/.npm`],
    hashFiles: [`${process.env.HOME}/package-lock.json`],
  },
  yarn: {
    path: [`${process.env.HOME}/.npm`],
    hashFiles: [`${process.env.HOME}/yarn.lock`],
  },
} as CacheConfigs;
