/**
 * Refresh the README screenshots from a running dashboard, using a local
 * Chrome in headless mode driven over the DevTools protocol (no extra deps).
 *
 *   npm run demo:agent            # or whydid serve with a real LLM configured
 *   npx tsx scripts/screenshots.ts [--lang en|zh] [--skip-agent]
 *
 * Env: WHYDID_URL (default http://localhost:8787), CHROME (path to the
 * Chrome binary; defaults to the macOS install). The agent shot asks a real
 * question, so it uses whatever LLM the server is configured with.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.WHYDID_URL ?? 'http://localhost:8787';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const args = process.argv.slice(2);
const lang = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : 'en';
const skipAgent = args.includes('--skip-agent');
const OUT = 'docs/screenshots';
const suffix = lang === 'en' ? '' : `.${lang}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForJson<T>(url: string, tries = 50): Promise<T> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return (await r.json()) as T;
    } catch {
      // Chrome is still starting.
    }
    await sleep(200);
  }
  throw new Error(`No answer from ${url}`);
}

class Cdp {
  private id = 0;
  private pending = new Map<number, (v: { result?: unknown; error?: { message: string } }) => void>();
  private constructor(private ws: WebSocket) {
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message: string } };
      if (msg.id !== undefined) this.pending.get(msg.id)?.(msg);
    };
  }
  static async open(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    return new Cdp(ws);
  }
  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result as T)));
    });
  }
  async eval<T = unknown>(expression: string): Promise<T> {
    const r = await this.send<{ result: { value: T }; exceptionDetails?: { text: string } }>('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
  close(): void {
    this.ws.close();
  }
}

async function shot(cdp: Cdp, name: string): Promise<void> {
  const { data } = await cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
  const file = join(OUT, `${name}${suffix}.png`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  process.stdout.write(`saved ${file}\n`);
}

async function go(cdp: Cdp, hash: string, settleMs = 2500): Promise<void> {
  await cdp.send('Page.navigate', { url: `${BASE}/${hash}` });
  await sleep(settleMs);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const busy = await fetch(`http://localhost:${PORT}/json/version`).then(() => true, () => false);
  if (busy) throw new Error(`Port ${PORT} is in use, probably a Chrome left over from an earlier run.`);
  const profile = mkdtempSync(join(tmpdir(), 'whydid-shots-'));
  // Own process group, so the browser's helper processes are stopped together.
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--hide-scrollbars',
    '--window-size=1440,900',
    'about:blank',
  ], { detached: true, stdio: 'ignore' });
  try {
    const targets = await waitForJson<Array<{ type: string; webSocketDebuggerUrl: string }>>(`http://localhost:${PORT}/json/list`);
    const page = targets.find((t) => t.type === 'page');
    if (!page) throw new Error('No page target.');
    const cdp = await Cdp.open(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });

    // Language and a clean agent session, set before the app reads them.
    await go(cdp, '#/b/model_output', 500);
    await cdp.eval(`localStorage.setItem('whydid.lang', '${lang}'); localStorage.removeItem('whydid.agent.session'); localStorage.setItem('whydid.admin.tab', 'boards'); true`);

    // Same URL again would be a same-document navigation; reload so the app reads the new settings.
    await cdp.send('Page.reload');
    await sleep(3500);
    await shot(cdp, 'model-output-board');

    await go(cdp, '#/b/product_events', 3500);
    await shot(cdp, 'product-events-board');

    if (!skipAgent) {
      await go(cdp, '#/b/model_output', 3500);
      const question = lang === 'zh' ? '近 7 天忠实度为什么下降了？' : 'Why did faithfulness drop in the last 7 days?';
      await cdp.eval(`(() => {
        const open = [...document.querySelectorAll('header button')].find((b) => b.getAttribute('title') === 'Agent');
        if (open && !document.querySelector('textarea')) open.click();
        return true;
      })()`);
      await sleep(800);
      await cdp.eval(`(() => {
        const ta = document.querySelector('textarea');
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        set.call(ta, ${JSON.stringify(question)});
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
      await sleep(300);
      await cdp.eval(`document.querySelector('textarea').parentElement.querySelector('button').click(), true`);
      for (let i = 0; i < 120; i++) {
        await sleep(1000);
        const done = await cdp.eval<boolean>(`!!document.querySelector('.prose-agent') && !document.querySelector('textarea').disabled`);
        if (done) break;
      }
      await sleep(800);
      await shot(cdp, 'agent-workbench');
    }

    await go(cdp, '#/evals', 3000);
    await shot(cdp, 'eval-set');

    await go(cdp, '#/releases', 2500);
    await shot(cdp, 'release-notes');

    await go(cdp, '#/admin', 2500);
    // Open the first card of the second board in the editor to show the live preview.
    await cdp.eval(`(() => {
      const boards = [...document.querySelectorAll('button')].filter((b) => b.querySelector('svg') && b.className.includes('rounded-lg px-2 py-1.5'));
      boards[1]?.click();
      return true;
    })()`);
    await sleep(800);
    await cdp.eval(`(() => {
      const edit = [...document.querySelectorAll('button')].find((b) => ['Edit', '编辑'].includes(b.getAttribute('title') ?? ''));
      edit?.click();
      return true;
    })()`);
    await sleep(3500);
    await shot(cdp, 'settings-card-editor');
    cdp.close();
  } finally {
    try {
      process.kill(-chrome.pid!, 'SIGTERM');
    } catch {
      chrome.kill();
    }
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`Screenshots failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
