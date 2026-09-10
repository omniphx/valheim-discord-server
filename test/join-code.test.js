import test from 'node:test';
import assert from 'node:assert/strict';
import { createJoinCode } from '../src/join-code.js';
const now = Date.parse('2026-09-10T03:00:00Z');
const valid = { joinCode: '012345' };
function reader(results) {
  const calls = [];
  const read = createJoinCode({ env: { INSTANCE_ID: 'i-game', JOIN_CODE_DOCUMENT: 'game-join-code' }, now: () => now, sleep: async () => {}, ssm: { send: async command => {
    calls.push(command.input);
    if (calls.length === 1) return { Command: { CommandId: 'command' } };
    const result = results.shift() ?? { Status: 'InProgress' };
    if (result instanceof Error) throw result;
    return result;
  } } });
  return { read, calls };
}
test('reads through SSM propagation and pending states using only the fixed document', async () => {
  const { read, calls } = reader([Object.assign(new Error(), { name: 'InvocationDoesNotExist' }), { Status: 'Pending' }, { Status: 'Success', StandardOutputContent: JSON.stringify(valid) }]);
  assert.deepEqual(await read(), '012345');
  assert.deepEqual(calls[0], { InstanceIds: ['i-game'], DocumentName: 'game-join-code', DocumentVersion: '$DEFAULT', TimeoutSeconds: 30 });
  assert.deepEqual(calls[1], { CommandId: 'command', InstanceId: 'i-game' });
});
test('invalid output and failed commands remain unavailable', async () => {
  for (const payload of ['null', '{}', 'invalid', '{"joinCode":123456}', '{"joinCode":"12345"}', '{"joinCode":"abcdef"}']) {
    assert.equal(await reader([{ Status: 'Success', StandardOutputContent: payload }]).read(), null);
  }
  assert.equal(await reader([{ Status: 'Failed' }]).read(), null);
});
test('polling is bounded', async () => {
  const pending = reader([]);
  assert.equal(await pending.read(), null);
  assert.equal(pending.calls.length, 16);
});
