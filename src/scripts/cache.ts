/**
 * Runner script to store/save caches by predefined configs.
 * Used in `scripts/bashlib.sh`.
 */
import { run } from '../cache';

// @ts-ignore
run(...process.argv.slice(2));
