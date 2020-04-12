# cached-dependencies

[![](https://github.com/ktmud/cached-dependencies/workflows/Tests/badge.svg)](https://github.com/ktmud/cached-dependencies/actions?query=workflow%3ATests) [![codecov](https://codecov.io/gh/ktmud/cached-dependencies/branch/master/graph/badge.svg)](https://codecov.io/gh/ktmud/cached-dependencies)

Enable **multi-layer cache** and **command shorthands** in any workflows.

Use either the built-in cache configs for `npm`, `yarn`, and `pip`, or write your own. Create a bash command library to easily reduce redudencies across workflows. Most useful for building webapps that require multi-stage building processes.

## Usage

### Getting started

Let's set up a simple Python app with both `pip` and `npm` cache in one simple step:

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

There is also a `yarn-install` command which handles cache restore/save for npm pacakges, too, but creates the cache keys with `yarn.lock`, instead of `package-lock.json`.

### Command shortcuts

Of course, you can customize these command shortcuts or add new ones. Simply edit `.github/workflows/bashlib.sh`:

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

### Cached layers

The `cache-restore` and `cache-save` uses [actions/cache](https://github.com/actions/cache) to manage caches. `npm` and `pip` are the name of two predefined cache layers with following configs:

```js
{
  pip: {
    path: ['~/.pip'],
    hashFiles: ['requirements*.txt'],
    keyPrefix: 'pip-',
    restoreKeys: 'pip-',
  },
  npm: {
    path: ['~/.npm'],
    hashFiles: [`package-lock.json`],
    keyPrefix: 'npm-',
    restoreKeys: 'npm-',
  },
}
```

You can override these by editing `.github/workflows/caches.js`. For example, if you want to use `yarn.lock` instead of `package-lock.json`:

```js
module.exports = {
  npm: {
    path: ['~/.npm'],
    // It is recommended to always use absolute paths in these configs.
    hashFiles: [`${process.env.GITHUB_WORKSPACE}/yarn.lock`],
    keyPrefix: 'npm-',
    restoreKeys: 'npm-',
  },
}
```

Don't forget to also update the `npm-install` shortcut as shown in previous section.

### Default setup command

When `run` is not provided:

```yaml
jobs:
  name: Test Job
  steps:
    - name: Install dependencies
      uses: ktmud/cached-depdencies@v1
```

You must configure a `default-setup-command` in `.github/workflows/bashlib.sh`. For example, we can install pip and npm at the same time:

```bash
default-setup-command() {
  pip-install & npm-install
}
```

### Use different config locations

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

The scripts and documentation in this project are released under [the MIT License](LICENSE).
