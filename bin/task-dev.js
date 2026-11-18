#!/usr/bin/env node
import { main } from '../lib/cli.js';

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
