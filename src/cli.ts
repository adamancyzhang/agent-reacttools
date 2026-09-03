import { parseArgs } from './args.js';
import { CdpClient } from './cdp/client.js';
import { resolvePage } from './cdp/attach.js';
import { resolveConnection } from './cdp/connect.js';
import { runFind } from './commands/find.js';
import { runInspect } from './commands/inspect.js';
import { runQuery } from './commands/query.js';
import { runStyle } from './commands/style.js';
import { runTree, TREE_DEFAULT_FIELDS } from './commands/tree.js';
import type { Ctx } from './ctx.js';
import { UsageError, errorEnvelope, errorText } from './errors.js';
import { FIELDS, parseFields } from './fields.js';
import { renderFindText, renderInspectText, renderQueryText, renderStyleText, renderTreeText } from './output/text.js';
import { VERSION } from './version.js';

export const USAGE = `agent-reacttools — inspect React components in a live browser over CDP

Usage:
  agent-reacttools <command> [args] [flags]

Commands:
  tree                 Print the React component tree of the page
  inspect <query>      Dump one component. query = component name | source
                       file substring | CSS selector | XPath | visible text
  find <name|path>     Locate components by name or source-file substring and
                       print their parent chains
  query <xpath|css>    Collect DOM elements matching an XPath expression or CSS
                       selector, with their owning components
  style <xpath|css>    Dump the computed style of an element

Flags:
  --cdp <port|url>     Browser debugging endpoint: port, host:port, http(s)://
                       or ws(s):// URL. Default: 127.0.0.1:9222
  --tab <selector>     Pick a page: t1/t2... (1-based), exact title, or URL
                       substring
  --json               Machine-readable single-line JSON on stdout
  --depth <n>          Max tree depth (default 8, no upper limit)  [tree]
  --fields <list>      Comma-separated: props,hooks,memo,context,state,file,dom
                                                                [tree|inspect]
  --compact            Name and DOM only                          [tree]
  --limit <n>          Max collected matches (default 50)         [query]
  --all                Include every computed style property     [style]
  --help               Show this help
  --version            Show version`;

const COMMANDS = ['tree', 'inspect', 'find', 'query', 'style'] as const;

type Result = Awaited<
  | ReturnType<typeof runTree>
  | ReturnType<typeof runInspect>
  | ReturnType<typeof runFind>
  | ReturnType<typeof runQuery>
  | ReturnType<typeof runStyle>
>;

function printResult(command: string, result: Result, flags: Record<string, string | boolean>): void {
  if (flags.json) {
    console.log(JSON.stringify({ ok: true, ...result }));
    return;
  }
  switch (command) {
    case 'tree': {
      const treeResult = result as Awaited<ReturnType<typeof runTree>>;
      console.log(renderTreeText(treeResult.react, flags, parseFields(flags.fields) ?? TREE_DEFAULT_FIELDS));
      break;
    }
    case 'inspect':
      console.log(
        renderInspectText(
          result as Awaited<ReturnType<typeof runInspect>>,
          parseFields(flags.fields) ?? [...FIELDS],
        ),
      );
      break;
    case 'find':
      console.log(renderFindText(result as Awaited<ReturnType<typeof runFind>>));
      break;
    case 'query':
      console.log(renderQueryText(result as Awaited<ReturnType<typeof runQuery>>));
      break;
    case 'style':
      console.log(renderStyleText(result as Awaited<ReturnType<typeof runStyle>>));
      break;
  }
}

export async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (e) {
    console.error(errorText(e));
    return 2;
  }
  const { command, positionals, flags } = parsed;

  if (flags.help) {
    console.log(USAGE);
    return 0;
  }
  if (flags.version) {
    console.log(VERSION);
    return 0;
  }
  if (!command) {
    console.error(USAGE);
    return 2;
  }

  const json = !!flags.json;
  try {
    if (!(COMMANDS as readonly string[]).includes(command)) {
      throw new UsageError(`Unknown command "${command}". Run with --help.`);
    }
    if (command !== 'tree') {
      if (positionals.length !== 1) throw new UsageError(`Command "${command}" requires exactly one query argument.`);
    } else if (positionals.length > 0) {
      throw new UsageError('Command "tree" takes no arguments.');
    }

    const conn = await resolveConnection(flags, { requireUsablePage: true });
    const client = await CdpClient.connect(conn.wsUrl);
    let result: Result;
    try {
      const page = await resolvePage(client, conn.level, flags.tab);
      const ctx: Ctx = { client, sessionId: page.sessionId, page };
      if (command === 'tree') result = await runTree(ctx, flags);
      else if (command === 'inspect') result = await runInspect(ctx, positionals[0]!, flags);
      else if (command === 'find') result = await runFind(ctx, positionals[0]!, flags);
      else if (command === 'query') result = await runQuery(ctx, positionals[0]!, flags);
      else result = await runStyle(ctx, positionals[0]!, flags);
    } finally {
      client.close();
    }
    printResult(command, result, flags);
    return 0;
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(errorText(e));
      return 2;
    }
    if (json) console.log(JSON.stringify(errorEnvelope(e)));
    console.error(errorText(e));
    return 1;
  }
}
