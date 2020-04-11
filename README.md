# setup-webapp

[![](https://github.com/ktmud/setup-webapp/workflows/Tests/badge.svg)](https://github.com/ktmud/setup-webapp/actions?query=workflow%3ATests)

A [Github Action](https://help.github.com/en/actions) to enable **multi-layer cache** and **command shorthands** for any workflow. Mostly useful for webapps where frontend and backend services need to be built separately.

Using predefined shortcuts and cache layers, you can split workflows and manage caches with minimal redudant code.

## Example

A simple Python app that setups pip cache and npm cache at the same time:

```yaml
jobs:
  cypress:
    name: Cypress
    runs-on: ubuntu-latest
    steps:
    - name: Checkout code
      uses: actions/checkout@v2
    - name: Install dependencies
      uses: ktmud/setup-webapp@v1
      with:
        parallel: true
        run: |
          npm-install
          npm-build

          pip-install
          python ./bin/manager.py fill_test_data
```

Here, the predefined `npm-install`, `npm-build` and `pip-install` commands will automatically manage `npm` and `pip` cache for you. They are also running in parallel by `node` child processes, so things can be even faster.

Of course, you can customize these commands or add new ones. Simply edit `.github/workflows/bashlib.sh` and override these commands:

```bash
pip-install() {
  cd $GITHUB_WORKSPACE

  cache-restore pip
  pip install -r requirements*.txt

  # install additional packages
  pip install -e ".[postgres,mysql]"

  cache-save pip
}

npm-install() {
  echo "npm: $(npm --version)"
  echo "node: $(node --version)"

  # use a subfolder for the frontend code
  cd $GITHUB_WORKSPACE/client/

  cache-restore npm
  npm ci
  cache-save npm
}
```

The `cache-restore` and `cache-save` uses [actions/cache](https://github.com/actions/cache) to manage caches. `npm` and `pip` are two predefined cache layers with following configs:

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
    hashFiles: ['package-lock.json'],
    keyPrefix: 'npm-',
    restoreKeys: 'npm-',
  },
}
```

You can override these by editing `.github/workflows/caches.js`.

### Use different config location

Both the two config files above can be placed in other locations:

```yaml
- uses: ktmud/setup-webapp@v1
  with:
    run: |
      npm-install
      npm-build
      pip-install
```

### Run commands in parallel

When `parallel` is set to `true`, the `run` inputs will be split into an array of commands and passed to `Promise.all(...)` to execute in parallel.

If one or more of your commands must spread across multiple lines, you can add a new line between the parallel commands. Each command within a parallel group will still run sequentially.

```yaml
- uses: ktmud/setup-webapp@v1
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
