const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureInspectorChannelAccess } = require('../bot');

test('Channel Access Permissions Test Suite', async (t) => {
  await t.test('ensureInspectorChannelAccess correctly sets service hub permissions (read & buttons only)', async () => {
    const edits = new Map();

    const mockGuild = {
      roles: {
        everyone: { id: 'role_everyone' },
        cache: new Map([
          ['1567570844472053943', { id: '1567570844472053943', name: 'สารวัตรนักเรียน' }],
          ['role_mon', { id: 'role_mon', name: 'เวรวันจันทร์' }],
          ['role_random', { id: 'role_random', name: 'นักเรียนทั่วไป' }]
        ])
      },
      members: {
        me: { id: 'bot_id' }
      }
    };

    const mockChannel = {
      name: '🛎️│บริการสารวัตร',
      permissionOverwrites: {
        edit: async (id, perms) => {
          edits.set(id, perms);
        }
      }
    };

    await ensureInspectorChannelAccess(mockGuild, mockChannel, { allowSend: false });

    // 1. @everyone should be denied ViewChannel
    assert.deepEqual(edits.get('role_everyone'), { ViewChannel: false });

    // 2. Verified role should have ViewChannel and ReadMessageHistory, but SendMessages: false
    const verifiedPerms = edits.get('1567570844472053943');
    assert.ok(verifiedPerms);
    assert.equal(verifiedPerms.ViewChannel, true);
    assert.equal(verifiedPerms.ReadMessageHistory, true);
    assert.equal(verifiedPerms.SendMessages, false);

    // 3. Bot should have full permissions
    const botPerms = edits.get('bot_id');
    assert.ok(botPerms);
    assert.equal(botPerms.ViewChannel, true);
    assert.equal(botPerms.SendMessages, true);
  });

  await t.test('ensureInspectorChannelAccess correctly sets lost and found permissions (allow send & attachments)', async () => {
    const edits = new Map();

    const mockGuild = {
      roles: {
        everyone: { id: 'role_everyone' },
        cache: new Map([
          ['1567570844472053943', { id: '1567570844472053943', name: 'สารวัตรนักเรียน' }]
        ])
      },
      members: {
        me: { id: 'bot_id' }
      }
    };

    const mockChannel = {
      name: '📦│แจ้งพบของหาย',
      permissionOverwrites: {
        edit: async (id, perms) => {
          edits.set(id, perms);
        }
      }
    };

    await ensureInspectorChannelAccess(mockGuild, mockChannel, { allowSend: true });

    // Verified role should have SendMessages: true, AttachFiles: true, EmbedLinks: true
    const verifiedPerms = edits.get('1567570844472053943');
    assert.ok(verifiedPerms);
    assert.equal(verifiedPerms.ViewChannel, true);
    assert.equal(verifiedPerms.SendMessages, true);
    assert.equal(verifiedPerms.AttachFiles, true);
    assert.equal(verifiedPerms.EmbedLinks, true);
  });
});
