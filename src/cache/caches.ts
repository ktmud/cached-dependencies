/*
 * Default cache configs
 */
export interface CacheConfig {
  path: string[];
  hashFiles: string[];
  keyPrefix?: string;
  restoreKeys?: string[];
}

export interface CacheConfigs {
  [cacheName: string]: CacheConfig;
}

export default {
  pip: {
    path: [`${process.env.HOME}/.pip`],
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
