import { main } from './cli.js';

const code = await main(process.argv.slice(2));
process.exit(code);
