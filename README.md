# cached-dependencies

[![](https://github.com/ktmud/cached-dependencies/workflows/Tests/badge.svg)](https://github.com/ktmud/cached-dependencies/actions?query=workflow%3ATests) [![codecov](https://codecov.io/gh/ktmud/cached-dependencies/branch/master/graph/badge.svg)](https://codecov.io/gh/ktmud/cached-dependencies)

Enable **multi-layer cache** and **shortcut commands** in any workflows.

Manage multiple cache targets in one step. Use either the built-in cache configs for npm, yarn, and pip, or write your own. Create a bash command library to easily reduce redudencies across workflows. Most useful for building webapps that require multi-stage building processes.

This is your all-in-one action for everything related to setting up dependencies with cache.

## Requirements

- The action runs on the `node24` runtime bundled with the GitHub Actions runner.
- The `cache-restore` and `cache-save` commands always use the same Node.js binary that runs the action, so the Node.js version you set up with `actions/setup-node` (or whatever `node` is in `PATH`) does not matter.
- Linux, macOS and Windows runners are supported. On Windows, commands run in the Git Bash that ships with the runner, so `run` and `bashlib` are still written in bash.
- Caches are stored via the [`@actions/cache`](https://github.com/actions/toolkit/tree/main/packages/cache) toolkit and share the same storage, limits and eviction policies as [actions/cache](https://github.com/actions/cache).

## Inputs

- **run**: bash commands to run, allows shortcut commands
- **caches**: path to a JS module (CommonJS or ESM) that defines cache targets, defaults to `.github/workflows/caches.js`
- **bashlib**: path to a BASH scripts that defines shortcut commands, defaults to `.github/workflows/bashlib.sh`
- **parallel**: whether to run the commands in parallel with node subprocesses

## Examples

Following workflow sets up dependencies for a typical Python web app with both `~/.pip` and `~/.npm` cache configured in one simple step:

```yaml
jobs:
  build_and_test:
    runs-on: ubuntu-latest
    steps:
    - name: Checkout code
      uses: actions/checkout@v2
    - name: Install dependencies
      uses: ktmud/cached-dependencies@v1
      with:
        run: |
          npm-install
          npm run build

          pip-install
          python ./bin/manager.py fill_test_data
```

Here we used predefined `npm-install` and `pip-install` commands to install dependencies with correponding caches.

You may also replace `npm-install` with `yarn-install` to install npm pacakges with `yarn.lock`.

```yaml
- name: Install dependencies
  uses: ktmud/cached-dependencies@v1
  with:
    run: |
      yarn-install
      yarn build

      pip-install
      python ./bin/manager.py fill_test_data
```

See below for more details.

## Usage

### Cache configs

Under the hood, we use the [@actions/cache](https://github.com/actions/toolkit/tree/main/packages/cache) toolkit (the same library that powers [actions/cache](https://github.com/marketplace/actions/cache)) to manage cache storage. But instead of defining only one cache at a time and specify them in workflow YAMLs, you manage all caches in a spearate JS file: `.github/workflows/caches.js`.

Here is [the default configuration](https://github.com/ktmud/cached-dependencies/blob/master/src/cache/caches.ts) for Linux (the `pip` and `npm` cache paths are adjusted for macOS and Windows):

```js
module.exports = {
  pip: {
    path: [`${process.env.HOME}/.cache/pip`],
    hashFiles: ['requirements*.txt'],
    keyPrefix: 'pip-',
    restoreKeys: 'pip-',
  },
  npm: {
    path: [`${HOME}/.npm`],
    hashFiles: [
      `package-lock.json`,
      `*/*/package-lock.json`,
      `!node_modules/*/package-lock.json`,
    ],
  },
  yarn: {
    path: [`${HOME}/.npm`],
   // */* is for supporting lerna monorepo with depth=2
    hashFiles: [`yarn.lock`, `*/*/yarn.lock`, `!node_modules/*/yarn.lock`],
  },
}
```

In which `hashFiles` and `keyPrefix` will be used to compute the primary cache key used in [@actions/cache](https://github.com/marketplace/actions/cache). `keyPrefix` will default to `${cacheName}-` and `restoreKeys` will default to `keyPrefix` if not specified.

It is recommended to always use absolute paths in these configs so you can share them across different worflows more easily (in case you the action is called from different working directories).

#### How cache keys are computed

The primary key is `${keyPrefix}${hash}`, where `hash` is the SHA256 of:

1. the SHA256 of every file matched by `hashFiles`, concatenated in glob order (this is how GitHub's built-in `hashFiles()` expression works, too), plus
2. the list of `path`s, so that a cache is automatically invalidated when you change which directories to cache.

Runner specific directories in `path` (`$GITHUB_WORKSPACE`, `$RUNNER_TEMP`, `$RUNNER_TOOL_CACHE`, `$HOME` and `~`) are replaced with placeholders before hashing, so the same config generates the same key on hosted and self-hosted runners even when they check out the repository to different locations.

#### Specify when to restore and save

With the predefined `cache-restore` and `cache-save` bash commands, you have full flexibility on when to restore and save cache:

```yaml
steps:
- uses: actions/checkout@v2
- uses: ktmud/cached-dependencies@v1
  with:
    run: |
      cache-restore npm
      npm install
      cache-save npm

      cache-restore pip
      pip install -r requirements.txt
      cache-save pip
```

`cache-save` is skipped when `cache-restore` found a cache with the exact same primary key. It is also fine to call `cache-save` without a prior `cache-restore`, e.g. to save build artifacts to be reused by later jobs.

#### Check whether a cache exists

`cache-check` looks up a cache without downloading it. It exits with `0` when a cache with the exact primary key exists, `2` when only one of the `restoreKeys` matched, and `1` when no cache was found. This is useful when one job prepares the cache and other jobs only need to know whether the preparation is still up to date:

```yaml
steps:
- uses: actions/checkout@v2
- uses: ktmud/cached-dependencies@v1
  with:
    run: |
      if cache-check npm; then
        echo "Dependencies are already cached, skip installing"
      else
        npm-install
      fi
```

Note that the predefined commands run with `set -e`, so use `cache-check` inside an `if` (or append `|| true`) to avoid failing the step on a cache miss.

#### Invalidate or re-upload a cache

Caches are immutable: once a key has been saved, `cache-save` will not overwrite it. To replace a bad cache, either

- delete it from the **Actions > Caches** page of your repository (or with `gh cache delete <key>`) and re-run the workflow, or
- change the `keyPrefix` of the cache config (e.g. `npm-v2-`) to start over with a fresh key.

### Shortcut commands

All predefined shortcut commands can be found [here](https://github.com/ktmud/cached-dependencies/blob/master/src/scripts/bashlib.sh). You can also customize them or add new ones in `.github/workflows/bashlib.sh`.

For example, if you want to install additional packages for before saving `pip` cache, simply add this to the `bashlib.sh` file:

```bash
# override the default `pip-install` command
pip-install() {
  cd $GITHUB_WORKSPACE

  cache-restore pip

  echo "::group::pip install"
  pip install -r requirements.txt      # prod requirements
  pip install -r requirements-dev.txt  # dev requirements
  pip install -e ".[postgres,mysql]"   # current pacakge with some extras
  echo "::endgroup::"

  cache-save pip
}
```

### Default setup command

When `run` is not provided:

```yaml
jobs:
  name: Build
  steps:
    - name: Install dependencies
      uses: ktmud/cached-depdencies@v1
```

You must provide a `default-setup-command` in the bashlib. For example,

```bash
default-setup-command() {
  pip-install & npm-install
}
```

This will start installing pip and npm dependencies at the same time.

### Customize config locations

Both the two config files, `.github/workflows/bashlib.sh` and `.github/workflows/caches.js`, can be placed in other locations:

```yaml
- uses: ktmud/cached-dependencies@v1
  with:
    caches: ${{ github.workspace }}/.github/configs/caches.js
    bashlib: ${{ github.workspace }}/.github/configs/bashlib.sh
```

### Run commands in parallel

When `parallel` is set to `true`, the `run` input will be split into an array of commands and passed to `Promise.all(...)` to execute in parallel. For example,

```yaml
- uses: ktmud/cached-dependencies@v1
  with:
    parallel: true
    run: |
      pip-install
      npm-install
```

is equivalent to

```yaml
- uses: ktmud/cached-dependencies@v1
  with:
    run: |
      pip-install & npm-install
```

If one or more of your commands must spread across multiple lines, you can add a new line between the parallel commands. Each command within a parallel group will still run sequentially.

```yaml
- uses: ktmud/cached-dependencies@v1
  with:
    run: |
      cache-restore pip
      pip install requirements*.txt
      # additional pip packages
      pip install package1 package2 pacakge2
      cache-save pip

      npm-install

      cache-restore cypress
      cd cypress/ && npm install
      cache-save cypress
```

## License

This project is released under [the MIT License](LICENSE).
