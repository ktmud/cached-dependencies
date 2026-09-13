// Possible input names
export enum InputName {
  Run = 'run',
  Caches = 'caches',
  Bashlib = 'bashlib',
  Parallel = 'parallel',
}

// Directly available environment variables
export enum EnvVariable {
  GitHubEventName = 'GITHUB_EVENT_NAME',
  // Path to the node binary running this action, exposed to bash scripts so
  // that `cache-restore` and `cache-save` don't depend on the node found in
  // `PATH` (which may be too old to run the cache scripts).
  NodeBinary = 'CACHED_DEPENDENCIES_NODE',
}

export const EnvVariableNames = new Set(Object.values(EnvVariable) as string[]);

export interface Inputs {
  [EnvVariable.GitHubEventName]?: string;
  [InputName.Caches]?: string;
  [InputName.Bashlib]?: string;
  [InputName.Run]?: string;
  [InputName.Parallel]?: string;
}

export const DefaultInputs = {
  [InputName.Caches]: '.github/workflows/caches.js',
  [InputName.Bashlib]: '.github/workflows/bashlib.sh',
  [InputName.Run]: 'default-setup-command',
} as Inputs;

/**
 * Inputs for a single cache action, resolved from a cache config.
 */
export interface CacheInputs {
  key: string;
  paths: string[];
  restoreKeys: string[];
}
