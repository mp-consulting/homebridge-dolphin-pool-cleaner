import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM module of the custom UI server, no type declarations
import { ASSISTANT_PLUGIN_NAME, DOLPHIN_AI_CONTEXT, registerAssistant } from '../../homebridge-ui/assistant.js';

interface ChatRequest {
  system?: string;
  messages: Array<{ role: string; content: unknown }>;
}

const usage = { inputTokens: 10, outputTokens: 5 };

/** Provider stand-in: no network, replies with `reply` (streamed in two chunks). */
function fakeProvider(reply: string) {
  const requests: ChatRequest[] = [];
  const result = (text: string) => ({
    text,
    toolCalls: [],
    usage,
    stopReason: 'end',
    model: 'fake-model',
    message: { role: 'assistant', content: text },
  });
  const provider = {
    name: 'anthropic',
    model: 'fake-model',
    capabilities: { tools: false, streaming: true, contextTokens: 100_000, jsonMode: false },
    async chat(request: ChatRequest) {
      requests.push(request);
      return result(reply);
    },
    async *stream(request: ChatRequest) {
      requests.push(request);
      const half = Math.ceil(reply.length / 2);
      yield { type: 'text', delta: reply.slice(0, half) };
      yield { type: 'text', delta: reply.slice(half) };
      yield { type: 'done', usage, stopReason: 'end', result: result(reply) };
    },
  };
  return { provider, requests };
}

function fakeServer(homebridgeConfigPath?: string) {
  const handlers = new Map<string, (body: unknown) => unknown>();
  const events: Array<[string, unknown]> = [];
  const server = {
    homebridgeConfigPath,
    onRequest: (path: string, fn: (body: unknown) => unknown) => handlers.set(path, fn),
    pushEvent: (event: string, data: unknown) => events.push([event, data]),
  };
  const call = (path: string, body: unknown = {}) => Promise.resolve(handlers.get(path)!(body));
  return { server, handlers, events, call };
}

async function writeConfig(platforms: unknown[]) {
  const dir = await mkdtemp(join(tmpdir(), 'dolphin-assistant-'));
  const path = join(dir, 'config.json');
  await writeFile(path, JSON.stringify({ bridge: { name: 'Homebridge' }, platforms }));
  return path;
}

describe('homebridge-ui Assistant routes', () => {
  it('registers the four Assistant routes', () => {
    const ui = fakeServer();
    registerAssistant(ui.server, { loadConfig: async () => null });
    expect([...ui.handlers.keys()].sort()).toEqual(['/ai/ask', '/ai/config', '/ai/explain', '/ai/status']);
  });

  it('reports the Assistant as off when the AI Kit block is missing', async () => {
    const ui = fakeServer(await writeConfig([{ platform: 'DolphinPoolCleaner', email: 'u@example.com', refreshToken: 'r' }]));
    registerAssistant(ui.server);
    expect(await ui.call('/ai/status')).toEqual({ enabled: false, provider: null, model: null, capabilities: null });
    await expect(ui.call('/ai/explain', { error: 'x' })).rejects.toThrow('The Assistant is not set up');
  });

  it('reads the shared HomebridgeAiKit block and never returns its key', async () => {
    const ui = fakeServer(await writeConfig([
      { platform: 'DolphinPoolCleaner' },
      { platform: 'HomebridgeAiKit', provider: 'anthropic', apiKey: 'sk-ant-secret-key' },
    ]));
    registerAssistant(ui.server);
    const status = await ui.call('/ai/status');
    expect(status).toMatchObject({ enabled: true, provider: 'anthropic' });
    expect(JSON.stringify(status)).not.toContain('sk-ant-secret-key');
  });

  it('explains a sign-in error with the Dolphin context and streams it', async () => {
    const { provider, requests } = fakeProvider('Request a new code.');
    const ui = fakeServer();
    registerAssistant(ui.server, {
      loadConfig: async () => ({ enabled: true, provider: 'anthropic', model: 'fake-model' }),
      createProvider: () => provider,
    });

    const result = await ui.call('/ai/explain', {
      error: 'Verification code has expired. Please try again.',
      context: 'Step 2 of the Dolphin setup wizard: verifying the code failed.',
      requestId: 'r1',
    });

    expect(result).toEqual({ text: 'Request a new code.', usage });
    expect(ui.events).toEqual([
      ['ai:chunk', { requestId: 'r1', delta: 'Request a ' }],
      ['ai:chunk', { requestId: 'r1', delta: 'new code.' }],
      ['ai:done', { requestId: 'r1' }],
    ]);
    expect(requests[0].system).toContain(ASSISTANT_PLUGIN_NAME);
    expect(requests[0].system).toContain(DOLPHIN_AI_CONTEXT);
    expect(JSON.stringify(requests[0].messages)).toContain('Verification code has expired');
  });

  it('describes the sign-in flow, wizard errors and robot states in its context', () => {
    expect(ASSISTANT_PLUGIN_NAME).toBe('@mp-consulting/homebridge-dolphin-pool-cleaner');
    for (const fact of ['CUSTOM_AUTH', 'SMS_MFA', '5 minutes', 'Invalid email or password', 'Invalid verification code',
      'refresh token', 'eu-west-1', 'notConnected', '"pollingInterval"']) {
      expect(DOLPHIN_AI_CONTEXT).toContain(fact);
    }
  });
});
