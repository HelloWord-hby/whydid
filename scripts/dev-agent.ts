/**
 * Run the workbench with the scripted mock LLM — no API key needed.
 *
 *   npm run demo:agent            # dashboard + agent on :8787
 *   PORT=8790 npm run demo:agent
 *
 * Starts scripts/mock-llm.ts and `whydid serve` pointed at it; Ctrl-C stops both.
 */
import { spawn, type ChildProcess } from 'node:child_process';

const port = process.env.PORT ?? '8787';
const mockPort = process.env.MOCK_LLM_PORT ?? '4010';

function run(args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  return spawn('npx', ['tsx', ...args], { stdio: 'inherit', env: { ...process.env, ...env } });
}

const mock = run(['scripts/mock-llm.ts'], { MOCK_LLM_PORT: mockPort });
const server = run(['src/cli.ts', 'serve', '--port', port], {
  WHYDID_LLM_BASE_URL: `http://localhost:${mockPort}/v1`,
  WHYDID_LLM_API_KEY: 'mock',
  WHYDID_LLM_MODEL: 'mock-llm (scripted)',
});

function stop(): void {
  mock.kill();
  server.kill();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', (code) => {
  mock.kill();
  process.exit(code ?? 0);
});
