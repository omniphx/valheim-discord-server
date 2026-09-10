import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createReceiver } from '../src/receiver.js';
import { createWorker } from '../src/worker.js';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const env = { DISCORD_PUBLIC_KEY: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex'), DISCORD_APPLICATION_ID: '123', DISCORD_GUILD_ID: '456', ALLOWED_ROLE_IDS: '789', WORKER_FUNCTION_NAME: 'worker', INSTANCE_ID: 'i-game' };
const now = 1700000000000;
const interaction = { type: 2, application_id: '123', guild_id: '456', member: { roles: ['789'] }, token: 'secret-token', data: { name: 'valheim', options: [{ name: 'start', type: 1 }] } };
function signed(payload, { timestamp = String(now / 1000), base64 = false } = {}) {
  const body = JSON.stringify(payload);
  return { body: base64 ? Buffer.from(body).toString('base64') : body, isBase64Encoded: base64, headers: { 'X-Signature-Timestamp': timestamp, 'X-Signature-Ed25519': sign(null, Buffer.from(timestamp + body), privateKey).toString('hex') } };
}
function receiver(invoke = async () => {}) { return createReceiver({ env, invoke, now: () => now }); }
test('signed Discord PING is accepted without guild roles', async () => {
  const result = await receiver()(signed({ type: 1 }));
  assert.deepEqual(JSON.parse(result.body), { type: 1 });
});
test('authorized base64 interaction queues only the selected action then defers privately', async () => {
  let queued;
  const result = await receiver(async input => { queued = input; })(signed(interaction, { base64: true }));
  assert.equal(JSON.parse(result.body).type, 5);
  assert.equal(JSON.parse(result.body).data.flags, 64);
  assert.equal(queued.InvocationType, 'Event');
  assert.deepEqual(JSON.parse(queued.Payload), { action: 'start', applicationId: '123', token: 'secret-token' });
});
test('tampering, missing signatures, malformed signatures and replayed timestamps fail closed', async () => {
  const badBody = signed(interaction); badBody.body += ' ';
  const badSignature = signed(interaction); badSignature.headers['X-Signature-Ed25519'] = '0';
  for (const request of [badBody, badSignature, { body: '{}' }, signed(interaction, { timestamp: '1' }), signed(interaction, { timestamp: String(now / 1000 + 301) })]) {
    const result = await receiver(() => assert.fail('must not invoke worker'))(request);
    assert.equal(result.statusCode, 401);
  }
});
test('wrong guild, wrong app, missing member, and admin without allowed role cannot control VM', async () => {
  for (const patch of [{ guild_id: 'other' }, { application_id: 'other' }, { member: null }, { member: { roles: [], permissions: '8' } }]) {
    const result = await receiver(() => assert.fail('must not invoke worker'))(signed({ ...interaction, ...patch }));
    assert.match(JSON.parse(result.body).data.content, /configured Valheim role/);
  }
});
test('unknown subcommands are refused', async () => {
  const result = await receiver(() => assert.fail())(signed({ ...interaction, data: { name: 'valheim', options: [{ name: 'terminate' }] } }));
  assert.match(JSON.parse(result.body).data.content, /Unknown/);
});
test('queue failure returns an actionable response', async () => {
  const result = await receiver(async () => { throw new Error('offline'); })(signed(interaction));
  assert.equal(JSON.parse(result.body).type, 4);
  assert.match(JSON.parse(result.body).data.content, /try again/);
});
async function runWorker(action, state, { failAws = false, replyStatuses = [200], code = null } = {}) {
  const calls = [], replies = [];
  let codeQueries = 0;
  const worker = createWorker({ env, sleep: async () => {}, joinCode: async () => { codeQueries++; return code; }, ec2: { send: async command => {
    calls.push(command);
    if (failAws) throw Object.assign(new Error('private details'), { name: 'AccessDenied' });
    return { Reservations: [{ Instances: [{ State: { Name: state }, PublicIpAddress: '203.0.113.7' }] }] };
  } }, fetcher: async (url, request) => {
    replies.push({ url, ...JSON.parse(request.body) });
    const status = replyStatuses[Math.min(replies.length - 1, replyStatuses.length - 1)];
    return { ok: status === 200, status };
  } });
  await worker({ action, applicationId: '123', token: 'secret-token' });
  return { calls, replies, codeQueries };
}
test('start changes only a stopped instance and is scoped to configured ID', async () => {
  const { calls, replies } = await runWorker('start', 'stopped');
  assert.equal(calls[1].constructor.name, 'StartInstancesCommand');
  assert.deepEqual(calls[1].input, { InstanceIds: ['i-game'] });
  assert.match(replies[0].content, /Starting/);
});
test('stop and pause use normal shutdown without force or skipping OS shutdown', async () => {
  for (const action of ['stop', 'pause']) {
    const { calls } = await runWorker(action, 'running');
    assert.equal(calls[1].constructor.name, 'StopInstancesCommand');
    assert.deepEqual(calls[1].input, { InstanceIds: ['i-game'] });
  }
});
test('already satisfied and transitioning states never send a mutation', async () => {
  for (const [action, state] of [['start', 'running'], ['stop', 'stopped'], ['pause', 'stopped'], ['start', 'stopping'], ['stop', 'pending'], ['start', 'terminated']]) {
    assert.equal((await runWorker(action, state)).calls.length, 1);
  }
});
test('status returns current IP but does not claim game readiness', async () => {
  const { calls, replies } = await runWorker('status', 'running');
  assert.equal(calls.length, 1);
  assert.match(replies[0].content, /203\.0\.113\.7:2456/);
  assert.match(replies[0].content, /not game readiness/);
});
test('AWS failure is reported without leaking internal error details', async () => {
  const { replies } = await runWorker('start', 'stopped', { failAws: true });
  assert.match(replies[0].content, /could not complete/);
  assert.doesNotMatch(replies[0].content, /private details/);
});
test('Discord reply races retry the reply without repeating the mutation', async () => {
  const { calls, replies } = await runWorker('start', 'stopped', { replyStatuses: [404, 500, 200] });
  assert.equal(calls.length, 2);
  assert.equal(replies.length, 3);
});
test('invalid worker payload never calls AWS', async () => {
  const worker = createWorker({ env, ec2: { send: () => assert.fail() } });
  await assert.rejects(worker({ action: 'terminate', applicationId: '123', token: 'abc' }), /Invalid worker event/);
  await assert.rejects(worker({ action: 'start', applicationId: '456', token: 'abc' }), /Invalid worker event/);
});

test('status displays the crossplay join code and omits player count', async () => {
  const { replies } = await runWorker('status', 'running', { code: '012345' });
  assert.match(replies[0].content, /Crossplay join code: \*\*012345\*\*/);
  assert.doesNotMatch(replies[0].content, /Players:/);
});
test('unavailable join code keeps the VM address', async () => {
  const { replies } = await runWorker('status', 'running');
  assert.match(replies[0].content, /join code: \*\*unavailable/);
  assert.match(replies[0].content, /203\.0\.113\.7:2456/);
});
test('stopped server does not query or display a join code or player count', async () => {
  const { replies, codeQueries } = await runWorker('status', 'stopped');
  assert.equal(codeQueries, 0);
  assert.doesNotMatch(replies[0].content, /join code|Players:/);
});
