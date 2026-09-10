import { EC2Client, DescribeInstancesCommand, StartInstancesCommand, StopInstancesCommand } from '@aws-sdk/client-ec2';
import { getJoinCode } from './join-code.js';
const client = new EC2Client({ maxAttempts: 2 });

export function createWorker({ env = process.env, ec2 = client, fetcher = fetch, joinCode = getJoinCode, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  return async event => {
    // This function has no public endpoint; only the signature-verifying receiver can invoke it.
    if (!['start', 'stop', 'pause', 'status'].includes(event.action) || event.applicationId !== env.DISCORD_APPLICATION_ID || !/^[A-Za-z0-9._-]+$/.test(event.token ?? '')) throw new Error('Invalid worker event');
    let content;
    try {
      const result = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [env.INSTANCE_ID] }));
      const instance = result.Reservations?.[0]?.Instances?.[0];
      if (!instance) throw new Error('Instance not found');
      const state = instance.State.Name;
      if (event.action === 'start' && state === 'stopped') {
        await ec2.send(new StartInstancesCommand({ InstanceIds: [env.INSTANCE_ID] }));
        content = 'Starting the VM. Valheim may take several minutes to load or update. Use /valheim status for the current address.';
      } else if (['stop', 'pause'].includes(event.action) && state === 'running') {
        await ec2.send(new StopInstancesCommand({ InstanceIds: [env.INSTANCE_ID] }));
        content = 'Shutdown requested. Players will disconnect while Valheim saves and the VM stops. Use /valheim status to confirm stopped; compute billing ends when stopped. World storage is retained.';
      } else {
        content = `VM state: **${state}**.`;
        if (state === 'running') content += instance.PublicIpAddress ? `\nJoin: **${instance.PublicIpAddress}:2456**\nThis reports VM state, not game readiness. If joining fails, wait a few minutes or check server logs.` : '\nThe public address is not available yet.';
        if (event.action === 'status' && state === 'running') {
          const code = await joinCode().catch(() => null);
          content += code ? `\nCrossplay join code: **${code}**` : '\nCrossplay join code: **unavailable** — the game may still be starting, crossplay may be disabled, or the code could not be read.';
        }
        if (state === 'stopped') content += '\nCompute is off; world storage is retained. Use /valheim start to play.';
        if (['pending', 'stopping'].includes(state)) content += '\nA transition is in progress. Check again shortly before sending another action.';
      }
    } catch (error) {
      console.error('EC2 action failed', { name: error.name });
      content = 'AWS could not complete the request. Check /valheim status before retrying; ask the owner to inspect the worker logs if it persists.';
    }
    // A fast worker may race the deferred response being received by Discord.
    await sleep(1000);
    const url = `https://discord.com/api/v10/webhooks/${event.applicationId}/${event.token}/messages/@original`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await fetcher(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content, allowed_mentions: { parse: [] } }), signal: AbortSignal.timeout(5000) });
        if (result.ok) return;
        if (attempt === 2 || (result.status < 500 && ![404, 429].includes(result.status))) break;
      } catch { /* Retry only the reply, never repeat the EC2 action. */ }
      await sleep(1000 * (attempt + 1));
    }
    console.error('Discord reply failed; use /valheim status to check the result');
  };
}
export const handler = createWorker();
