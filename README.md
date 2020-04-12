# cached-dependencies

[![](https://github.com/ktmud/cached-dependencies/workflows/Tests/badge.svg)](https://github.com/ktmud/cached-dependencies/actions?query=workflow%3ATests) [![codecov](https://codecov.io/gh/ktmud/cached-dependencies/branch/master/graph/badge.svg)](https://codecov.io/gh/ktmud/cached-dependencies)

Enable **multi-layer cache** and **command shorthands** in any workflows.

Manage multiple cache targets in one step. Use either the built-in cache configs for npm, yarn, and pip, or write your own. Create a bash command library to easily reduce redudencies across workflows. Most useful for building webapps that require multi-stage building processes.

This is your all-in-one action for everything related to setting up dependencies with cache.

## Usage

### Getting started

Let's set up a simple Python app with both `~/.pip` and `~/.npm` cached in one simple step:

```yaml
jobs:
  cypress:
    name: Cypress
    runs-on: ubuntu-latest
    steps:
    - name: Checkout code
      uses: actions/checkout@v2
    - name: Install dependencies
      uses: ktmud/cached-dependencies@v1
      with:
        parallel: true
        run: |
          npm-install
          npm-build

          pip-install
          python ./bin/manager.py fill_test_data
```

Here, the predefined `npm-install`, `npm-build` and `pip-install` commands will automatically manage `npm` and `pip` cache for you. They are also running in parallel by `node` child processes, so things can be even faster.

There is also a `yarn-install` command which handles installing npm pacakges with `yarn`.

### Cache configs

Under the hood, this action uses [@actions/cache](https://github.com/marketplace/actions/cache] to manage the cache storage. But instead of being able to defining only one cache at a time and specify the configs in the `yaml` file, you manage all caches in a spearate JS file: `.github/workflows/caches.js`. Here is what's used in default:

```js
module.exports = {
  pip: {
    path: [`${process.env.HOME}/.pip`],
    hashFiles: ['requirements*.txt'],
    keyPrefix: 'pip-',
    restoreKeys: 'pip-',
  },
  npm: {
    path: [`${process.env.HOME}/.npm`],
    hashFiles: [`package-lock.json`],
    keyPrefix: 'npm-',
    restoreKeys: 'npm-',
  },
  yarn: {
    path: [`${process.env.HOME}/.npm`],
    hashFiles: [`yarn.lock`],
    keyPrefix: 'yarn-',
    restoreKeys: 'yarn-',
  },
}
```

In which `hashFiles` and `keyPrefix` will be used to compute the `key` input used in [@actions/cache](https://github.com/marketplace/actions/cache). `restoreKeys` will defaults to be `keyPrefix` if not specified.

It is recommended to always use absolute paths in these configs so you can share the configs across different worflows more easily (in case you want to start the action in different working directories).

To use the caches, utilize the predefined `cache-store` and `cache-save` commands:

```yaml
steps:
- uses: actions/checkout@v2
- uses: ktmud/cached-dependencies@v1
  with:
    parallel: true
    run: |
      cache-restore npm
      npm restore
      cache-save npm

      cache-restore pip
      pip install -r requirements.txt
      cache-save pip
```

### Command shortcuts

As aforementioned, you can define command shortcuts to be used in the `run` input. All the predefined shortcuts can be found [here](https://github.com/ktmud/cached-dependencies/blob/master/src/scripts/bashlib.sh).

You can customize these shortcuts or add new shortcuts in `.github/workflows/bashlib.sh`. For example, if you want to install additional packages for `pip`, simply add this to the bashlib file:

```bash
# override the default `pip-install` command
pip-install() {
  cd $GITHUB_WORKSPACE

  cache-restore pip

  echo "::group::pip install"
  pip install -r requirements.txt

  # install additional pip packages
  pip install -r requirements-dev.txt
  pip install -e ".[postgres,mysql]"
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

When `parallel` is set to `true`, the `run` inputs will be split into an array of commands and passed to `Promise.all(...)` to execute in parallel.

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
