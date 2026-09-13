#!/bin/bash
# -----------------------------------------------
# Predefined command shortcuts
# -----------------------------------------------

# Exit on any command fails
set -e

bashSource=${BASH_SOURCE[${#BASH_SOURCE[@]} - 1]:-${(%):-%x}}
cacheScript="$(dirname "$(dirname "$(dirname "$bashSource")")")/dist/scripts/cache"
# Use the same node binary that runs the action (set by the action itself),
# fallback to whatever `node` is in PATH when running the scripts manually.
cacheNode="${CACHED_DEPENDENCIES_NODE:-node}"

print-cachescript-path() {
  echo "$cacheScript"
}

cache-restore() {
  "$cacheNode" "$cacheScript" restore "$1"
}

cache-save() {
  "$cacheNode" "$cacheScript" save "$1"
}

# check whether a cache exists without downloading it, exits with 0 when a
# cache with the exact primary key exists, 2 when only a restore key matched,
# and 1 when no cache was found.
cache-check() {
  "$cacheNode" "$cacheScript" check "$1"
}

# install python packages
pip-install() {
  cache-restore pip
  echo "::group::Install Python pacakges"
  pip install -r requirements.txt # install dependencies
  pip install -e . # install current directory as editable python package
  echo "::endgroup"
  cache-save pip
}

# install npm packages
npm-install() {
  cache-restore npm
  echo "::group::Install npm pacakges"
  echo "npm: $(npm --version)"
  echo "node: $(node --version)"
  npm ci
  echo "::endgroup::"
  cache-save npm
}

# install npm packages via yarn
yarn-install() {
  cache-restore yarn
  echo "::group::Install npm pacakges via yarn"
  echo "npm: $(npm --version)"
  echo "node: $(node --version)"
  echo "yarn: $(yarn --version)"
  yarn
  echo "::endgroup::"
  cache-save yarn
}

# default setup will install both pip and npm pacakges at the same time
default-setup-command() {
  echo 'Please provide `run` commands or configure `default-setup-command`.'
  exit 1
}
