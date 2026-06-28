#!/usr/bin/env node
import { runSafeNpm } from '../safe-npm.js';

runSafeNpm(process.argv.slice(2));
