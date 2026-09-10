import { SSMClient, SendCommandCommand, GetCommandInvocationCommand } from '@aws-sdk/client-ssm';
const client = new SSMClient({ maxAttempts: 1, requestHandler: { connectionTimeout: 1000, requestTimeout: 2000 } });

export function createJoinCode({ env = process.env, ssm = client, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now } = {}) {
  return async () => {
    try {
      const sent = await ssm.send(new SendCommandCommand({
        InstanceIds: [env.INSTANCE_ID], DocumentName: env.JOIN_CODE_DOCUMENT,
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
        const session = JSON.parse(result.StandardOutputContent);
        if (typeof session?.joinCode !== 'string' || !/^[0-9]{6}$/.test(session.joinCode)) return null;
        return session.joinCode;
      }
    } catch (error) {
      console.error('Join code unavailable', { name: error.name });
    }
    return null;
  };
}
export const getJoinCode = createJoinCode();
