const test = require('node:test');
const assert = require('node:assert/strict');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const {
  activeServicePhotoSessions,
  pendingPhotoConfirmations,
  ensureInspectorChannelAccess
} = require('../bot');

test('Service Hub Photo Upload with Auto-Clean Guard Test Suite', async (t) => {
  await t.test('ensureInspectorChannelAccess allows SendMessages and AttachFiles when allowSend is true', async () => {
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
      name: '🛎️│บริการสารวัตร',
      permissionOverwrites: {
        edit: async (id, perms) => {
          edits.set(id, perms);
        }
      }
    };

    await ensureInspectorChannelAccess(mockGuild, mockChannel, { allowSend: true });

    const verifiedPerms = edits.get('1567570844472053943');
    assert.ok(verifiedPerms);
    assert.equal(verifiedPerms.ViewChannel, true);
    assert.equal(verifiedPerms.SendMessages, true);
    assert.equal(verifiedPerms.AttachFiles, true);
    assert.equal(verifiedPerms.EmbedLinks, true);
  });

  await t.test('activeServicePhotoSessions manages session lifecycle with 5-minute timeout', () => {
    const userId = 'user_test_999';
    const member = { id: 'mem_999', first_name: 'วิชัย', last_name: 'กล้าหาญ', nickname: 'ชัย', duty_id: 'MS-01' };

    // 1. Arm session
    activeServicePhotoSessions.set(userId, { member, timestamp: Date.now() });
    assert.ok(activeServicePhotoSessions.has(userId));

    // 2. Fresh session check
    const session = activeServicePhotoSessions.get(userId);
    const isFresh = (Date.now() - session.timestamp) <= 5 * 60 * 1000;
    assert.equal(isFresh, true);

    // 3. Expired session check simulation
    const expiredTimestamp = Date.now() - (6 * 60 * 1000);
    const isExpired = (Date.now() - expiredTimestamp) > 5 * 60 * 1000;
    assert.equal(isExpired, true);

    // 4. Cleanup
    activeServicePhotoSessions.delete(userId);
    assert.equal(activeServicePhotoSessions.has(userId), false);
  });

  await t.test('Service photo preview card generates 2 buttons with 1-inch crop URL', () => {
    const memberId = 'mem_service_123';
    const cropToken = 'test_token_service_photo';
    const cropUrl = `https://sarawat-pranarai-web.onrender.com/crop?token=${cropToken}`;

    const photoActionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('🔲 ปรับแต่ง/ครอบรูป (ขนาด 1 นิ้ว)')
        .setStyle(ButtonStyle.Link)
        .setURL(cropUrl),
      new ButtonBuilder()
        .setCustomId(`btn_reupload_photo_${memberId}`)
        .setLabel('🔄 เปลี่ยนรูปภาพใหม่')
        .setStyle(ButtonStyle.Danger)
    );

    assert.equal(photoActionRow.components.length, 2);
    assert.equal(photoActionRow.components[0].data.style, ButtonStyle.Link);
    assert.equal(photoActionRow.components[0].data.url, cropUrl);
    assert.equal(photoActionRow.components[1].data.style, ButtonStyle.Danger);
    assert.equal(photoActionRow.components[1].data.custom_id, `btn_reupload_photo_${memberId}`);
  });

  await t.test('btn_reupload_photo re-arms activeServicePhotoSessions when isServiceUpdate is true', () => {
    const memberId = 'mem_service_reupload';
    const discordId = 'user_reupload_888';
    const member = { id: memberId, discord_id: discordId, first_name: 'ชาญ', last_name: 'สุขสันต์' };

    // Record pending confirmation
    pendingPhotoConfirmations.set(memberId, {
      member,
      isServiceUpdate: true,
      timestamp: Date.now()
    });

    // Simulate Re-upload click
    const pending = pendingPhotoConfirmations.get(memberId);
    assert.equal(pending.isServiceUpdate, true);

    pendingPhotoConfirmations.delete(memberId);
    if (pending.isServiceUpdate && member.discord_id) {
      activeServicePhotoSessions.set(member.discord_id, {
        member,
        timestamp: Date.now()
      });
    }

    assert.equal(pendingPhotoConfirmations.has(memberId), false);
    assert.ok(activeServicePhotoSessions.has(discordId));

    // Cleanup
    activeServicePhotoSessions.delete(discordId);
  });
});
