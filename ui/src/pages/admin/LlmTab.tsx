/** LLM endpoint: any OpenAI-compatible chat-completions API with tool calling. */
import { Bot, PlugZap, Save } from 'lucide-react';
import { useState } from 'react';
import { useAgent } from '../../agent/agent-state';
import { putJson } from '../../lib/api';
import { Button, CardShell, IconChip } from '../../components/ui';
import { testCall, useAdmin } from './admin-state';
import { Field, OriginTag, TestBadge, TextInput, useT } from './form';
import { type TestResult } from './types';

const PRESETS: Array<{ name: string; base: string; model: string }> = [
  { name: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4.1' },
  { name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4.5' },
  { name: 'DeepSeek', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: 'Kimi (Moonshot)', base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-32k' },
  { name: '通义千问 (DashScope)', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { name: '智谱 GLM', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-plus' },
];

export function LlmTab() {
  const t = useT();
  const { overview, reload } = useAdmin();
  const agent = useAgent();
  const s = overview!.settings.llm;
  const [baseUrl, setBaseUrl] = useState(s.base_url.value ?? '');
  const [model, setModel] = useState(s.model.value ?? '');
  const [apiKey, setApiKey] = useState('');
  const [test, setTest] = useState<{ running: boolean; ok?: boolean; text?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const moved = baseUrl.replace(/\/+$/, '') !== (s.base_url.value ?? '').replace(/\/+$/, '');

  const runTest = () => {
    setTest({ running: true });
    testCall<TestResult>('/admin/test/llm', { base_url: baseUrl || undefined, model: model || undefined, api_key: apiKey || undefined })
      .then((r) =>
        setTest({
          running: false,
          ok: r.ok,
          text: r.ok ? t(`Replied "${String(r.reply)}" in ${String(r.latency_ms)} ms · ${String(r.model)}`, `已回复"${String(r.reply)}"，耗时 ${String(r.latency_ms)} ms · ${String(r.model)}`) : `${r.status ? `HTTP ${r.status}: ` : ''}${r.error ?? ''}`,
        })
      )
      .catch((e: Error) => setTest({ running: false, ok: false, text: e.message }));
  };

  const save = (clearKey = false) => {
    setSaving(true);
    setMessage(null);
    const llm: Record<string, string | null> = { base_url: baseUrl || null, model: model || null };
    if (clearKey) llm.api_key = null;
    else if (apiKey) llm.api_key = apiKey;
    putJson('/admin/settings', { llm })
      .then(async () => {
        setApiKey('');
        await reload();
        await agent.refreshStatus();
        setMessage({ ok: true, text: t('Saved. The agent uses it from the next message.', '已保存，agent 下一条消息起使用新设置。') });
      })
      .catch((e: Error) => setMessage({ ok: false, text: e.message }))
      .finally(() => setSaving(false));
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <CardShell className="p-5">
        <div className="mb-4 flex items-center gap-2 text-[14px] font-semibold">
          <IconChip icon={Bot} /> {t('Model endpoint', '模型接口')}
        </div>
        <div className="mb-4 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => {
                setBaseUrl(p.base);
                setModel(p.model);
                setTest(null);
              }}
              className="h-7 cursor-pointer rounded-full border border-border bg-popover px-2.5 text-[12px] text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
            >
              {p.name}
            </button>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Base URL" hint={<OriginTag origin={s.base_url.origin} />} className="md:col-span-2">
            <TextInput value={baseUrl} onChange={setBaseUrl} placeholder="https://api.openai.com/v1" />
          </Field>
          <Field label={t('Model', '模型名')} hint={<OriginTag origin={s.model.origin} />}>
            <TextInput value={model} onChange={setModel} placeholder="gpt-4.1" />
          </Field>
          <Field
            label="API key"
            hint={
              <span className="inline-flex items-center gap-1.5">
                <OriginTag origin={s.api_key.origin} />
                {s.api_key.value && <code className="text-[11px]">{s.api_key.value}</code>}
                {s.api_key.origin === 'saved' && (
                  <button type="button" onClick={() => save(true)} className="cursor-pointer text-[11px] text-bad underline-offset-2 hover:underline">
                    {t('remove saved key', '删除已保存的 key')}
                  </button>
                )}
              </span>
            }
          >
            <TextInput type="password" autoComplete="off" value={apiKey} onChange={setApiKey} placeholder={s.api_key.value && !moved ? t('leave empty to keep the current key', '留空则保留当前 key') : 'sk-…'} />
          </Field>
          {moved && !apiKey && s.api_key.value && (
            <p className="text-[12px] text-warn md:col-span-2">
              {t('The base URL changed: enter the key for this endpoint. A saved key is only sent to the endpoint it was saved for.', '接口地址变了，请填写这个接口的 key。已保存的 key 只会发给保存时的那个地址。')}
            </p>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={runTest} disabled={test?.running}>
            <PlugZap size={14} /> {t('Test connection', '测试连接')}
          </Button>
          <Button variant="primary" onClick={() => save()} disabled={saving || !overview!.writable}>
            <Save size={14} /> {t('Save', '保存')}
          </Button>
          <TestBadge state={test} />
        </div>
        {message && <p className={message.ok ? 'mt-2 text-[12px] text-good' : 'mt-2 text-[12px] text-bad'}>{message.text}</p>}
      </CardShell>
      <CardShell className="p-4 text-[12.5px] text-muted-foreground">
        <p className="mb-2 font-semibold text-foreground">{t('Requirements', '要求')}</p>
        <ul className="flex list-disc flex-col gap-1.5 pl-4">
          <li>{t('Any endpoint that speaks the OpenAI chat-completions protocol: POST {base}/chat/completions.', '兼容 OpenAI chat-completions 协议的接口都可以：POST {base}/chat/completions。')}</li>
          <li>{t('The model must support tool calling (function calling); the agent works only through tools.', '模型需要支持工具调用（function calling），agent 完全靠工具取数。')}</li>
          <li>{t('The test sends one short message and costs a few tokens.', '测试会发一条很短的消息，消耗几个 token。')}</li>
          <li>{t('The key is stored on the server in', 'key 保存在服务器上的')} <code>{overview!.files.settings}</code>{t(' (not in git) and is never sent back to the browser.', '，不进 git，也不会再传回浏览器。')}</li>
        </ul>
      </CardShell>
    </div>
  );
}
