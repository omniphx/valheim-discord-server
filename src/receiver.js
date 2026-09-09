import { createPublicKey, verify } from 'node:crypto';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const client = new LambdaClient({ maxAttempts: 1, requestHandler: { connectionTimeout: 500, requestTimeout: 1500 } });
const response = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const message = content => response(200, { type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } });

export function createReceiver({ env = process.env, invoke = input => client.send(new InvokeCommand(input)), now = Date.now } = {}) {
  return async event => {
    const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const signature = headers['x-signature-ed25519'];
    const timestamp = headers['x-signature-timestamp'];
    const body = Buffer.from(event.body ?? '', event.isBase64Encoded ? 'base64' : 'utf8');
    try {
      if (!/^[a-f0-9]{128}$/i.test(signature ?? '') || !/^\d+$/.test(timestamp ?? '') || Math.abs(now() / 1000 - Number(timestamp)) > 300) throw new Error('Invalid signature');
      const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(env.DISCORD_PUBLIC_KEY, 'hex')]), format: 'der', type: 'spki' });
      if (!verify(null, Buffer.concat([Buffer.from(timestamp), body]), key, Buffer.from(signature, 'hex'))) throw new Error('Invalid signature');
    } catch { return response(401, { error: 'Invalid request signature' }); }
    let interaction;
    try { interaction = JSON.parse(body.toString('utf8')); } catch { return response(400, { error: 'Invalid JSON' }); }
    if (interaction.type === 1) return response(200, { type: 1 });
    if (interaction.type !== 2 || interaction.data?.name !== 'valheim') return message('Unsupported command.');
    const roles = new Set((env.ALLOWED_ROLE_IDS ?? '').split(',').filter(Boolean));
    if (interaction.application_id !== env.DISCORD_APPLICATION_ID || interaction.guild_id !== env.DISCORD_GUILD_ID || !interaction.member?.roles?.some(role => roles.has(role))) return message('You need the configured Valheim role in this Discord server.');
    const action = interaction.data.options?.[0]?.name;
    if (!['start', 'stop', 'pause', 'status'].includes(action)) return message('Unknown Valheim command.');
    try {
      await invoke({ FunctionName: env.WORKER_FUNCTION_NAME, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify({ action, applicationId: interaction.application_id, token: interaction.token })) });
      return response(200, { type: 5, data: { flags: 64 } });
    } catch {
      console.error('Could not queue Valheim command');
      return message('Could not queue the command. Please try again.');
    }
  };
}
export const handler = createReceiver();
