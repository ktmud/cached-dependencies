/**
 * Runner script to restore/save caches by predefined configs.
 * Used in `scripts/bashlib.sh`.
 */
import { run } from '../cache/index.js';

run(...process.argv.slice(2));
