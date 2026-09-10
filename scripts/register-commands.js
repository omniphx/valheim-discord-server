const { DISCORD_APPLICATION_ID, DISCORD_GUILD_ID, DISCORD_BOT_TOKEN } = process.env;
if (!/^\d+$/.test(DISCORD_APPLICATION_ID ?? '') || !/^\d+$/.test(DISCORD_GUILD_ID ?? '') || !DISCORD_BOT_TOKEN) throw new Error('Set DISCORD_APPLICATION_ID, DISCORD_GUILD_ID, and DISCORD_BOT_TOKEN.');
const command = {
  name: 'valheim', description: 'Control your shared Valheim server', type: 1,
  // Disabled for ordinary members until an administrator grants the player role access.
  default_member_permissions: '0',
  options: [
    ['start', 'Start the Valheim VM'], ['stop', 'Save and stop the VM; disconnects all players'],
    ['pause', 'Alias for stop; saves the world and disconnects all players'], ['status', 'Show VM state, connection address, and crossplay join code']
  ].map(([name, description]) => ({ type: 1, name, description }))
};
// POST upserts this command by name, preserving other commands in the application.
const result = await fetch(`https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/guilds/${DISCORD_GUILD_ID}/commands`, {
  method: 'POST', headers: { authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(command), signal: AbortSignal.timeout(15000)
});
if (!result.ok) throw new Error(`Discord registration failed (HTTP ${result.status}). Check application, guild, bot installation and token.`);
console.log('Registered /valheim start, stop, pause, and status. Grant the Valheim role command access in Server Settings → Integrations.');
