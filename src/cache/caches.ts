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
    path: ['~/.pip'],
    hashFiles: ['requirements*.txt'],
  },
  npm: {
    path: ['~/.npm'],
    hashFiles: ['package-lock.json'],
  },
} as CacheConfigs;
