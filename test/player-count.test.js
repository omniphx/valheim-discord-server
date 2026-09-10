import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayerCount } from '../src/player-count.js';
const now = Date.parse('2026-09-10T03:00:00Z');
const valid = { players: 2, source: 'crossplay', reportedAt: '2026-09-10T02:59:00Z' };
function reader(results) {
  const calls = [];
  const read = createPlayerCount({ env: { INSTANCE_ID: 'i-game', PLAYER_COUNT_DOCUMENT: 'game-player-count' }, now: () => now, sleep: async () => {}, ssm: { send: async command => {
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
  assert.deepEqual(await read(), { ...valid, ageSeconds: 60 });
  assert.deepEqual(calls[0], { InstanceIds: ['i-game'], DocumentName: 'game-player-count', DocumentVersion: '$DEFAULT', TimeoutSeconds: 30 });
  assert.deepEqual(calls[1], { CommandId: 'command', InstanceId: 'i-game' });
});
test('unreadable, invalid, stale, and future counts remain unavailable', async () => {
  for (const payload of ['null', '{}', 'invalid', JSON.stringify({ ...valid, players: -1 }), JSON.stringify({ ...valid, players: '2' }), JSON.stringify({ ...valid, reportedAt: '2026-09-08T03:00:00Z' }), JSON.stringify({ ...valid, reportedAt: '2026-09-11T03:00:00Z' })]) {
    assert.equal(await reader([{ Status: 'Success', StandardOutputContent: payload }]).read(), null);
  }
  assert.equal(await reader([{ Status: 'Failed' }]).read(), null);
});
test('polling is bounded and a real zero is preserved', async () => {
  const pending = reader([]);
  assert.equal(await pending.read(), null);
  assert.equal(pending.calls.length, 16);
  assert.equal((await reader([{ Status: 'Success', StandardOutputContent: JSON.stringify({ ...valid, players: 0 }) }]).read()).players, 0);
});
