import type { CdpClient } from './cdp/client.js';
import type { PageInfo } from './cdp/attach.js';

/** Everything a command needs to reach the inspected page. */
export interface Ctx {
  client: CdpClient;
  sessionId: string | null;
  page: PageInfo;
}
