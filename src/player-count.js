import { SSMClient, SendCommandCommand, GetCommandInvocationCommand } from '@aws-sdk/client-ssm';
const client = new SSMClient({ maxAttempts: 1, requestHandler: { connectionTimeout: 1000, requestTimeout: 2000 } });

export function createPlayerCount({ env = process.env, ssm = client, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now } = {}) {
  return async () => {
    try {
      const sent = await ssm.send(new SendCommandCommand({
        InstanceIds: [env.INSTANCE_ID], DocumentName: env.PLAYER_COUNT_DOCUMENT,
        DocumentVersion: '$DEFAULT', TimeoutSeconds: 30
      }));
      if (!sent.Command?.CommandId) return null;
      const deadline = now() + 15000;
      for (let attempt = 0; attempt < 15 && now() < deadline; attempt++) {
        await sleep(1000);
        let result;
        try {
          result = await ssm.send(new GetCommandInvocationCommand({ CommandId: sent.Command.CommandId, InstanceId: env.INSTANCE_ID }));
        } catch (error) {
          if (error.name === 'InvocationDoesNotExist') continue;
          throw error;
        }
        if (['Pending', 'InProgress', 'Delayed'].includes(result.Status)) continue;
        if (result.Status !== 'Success') return null;
        const count = JSON.parse(result.StandardOutputContent);
        const timestamp = Date.parse(count?.reportedAt);
        if (!Number.isInteger(count?.players) || count.players < 0 || count.players > 100 || !['crossplay', 'steam'].includes(count.source) || !Number.isFinite(timestamp) || timestamp > now() + 5000 || now() - timestamp > 86400000) return null;
        return { ...count, ageSeconds: Math.max(0, Math.floor((now() - timestamp) / 1000)) };
      }
    } catch (error) {
      console.error('Player count unavailable', { name: error.name });
    }
    return null;
  };
}
export const getPlayerCount = createPlayerCount();
