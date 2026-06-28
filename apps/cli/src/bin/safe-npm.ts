#!/usr/bin/env node
import { runSafeNpm } from '../index.js';

runSafeNpm(process.argv.slice(2));
