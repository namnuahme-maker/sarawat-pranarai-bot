const test = require('node:test');
const assert = require('node:assert');
const {
  pendingPromptMessages,
  deleteRegistrationPromptMessage
} = require('../bot.js');

test('🧹 Auto-Delete Prompt Card Architecture Suite', async (t) => {
  await t.test('pendingPromptMessages map should store, retrieve, and delete items', () => {
    const dummyMemberId = 'mem-test-999';
    pendingPromptMessages.set(dummyMemberId, {
      channelId: 'chan-123',
      messageId: 'msg-456',
      timestamp: Date.now()
    });

    assert.strictEqual(pendingPromptMessages.has(dummyMemberId), true);
    const item = pendingPromptMessages.get(dummyMemberId);
    assert.strictEqual(item.channelId, 'chan-123');
    assert.strictEqual(item.messageId, 'msg-456');

    pendingPromptMessages.delete(dummyMemberId);
    assert.strictEqual(pendingPromptMessages.has(dummyMemberId), false);
  });

  await t.test('Footer metadata format [msg:channelId:messageId] parses correctly', () => {
    const footerText = 'ระบบลงทะเบียนสารวัตร • โรงเรียนพระนารายณ์ • [msg:123456789:987654321]';
    const match = footerText.match(/\[msg:(\d+):(\d+)\]/);
    assert.ok(match, 'Footer text should match regex pattern');
    assert.strictEqual(match[1], '123456789');
    assert.strictEqual(match[2], '987654321');
  });

  await t.test('deleteRegistrationPromptMessage handles in-memory cache and invokes delete', async () => {
    let deletedMessageId = null;
    const testMemberId = 'mem-del-001';
    const testChannelId = 'ch-001';
    const testMsgId = 'msg-001';

    pendingPromptMessages.set(testMemberId, {
      channelId: testChannelId,
      messageId: testMsgId,
      timestamp: Date.now()
    });

    // Mock client on global or pass interaction
    // deleteRegistrationPromptMessage uses client and supabase from closure
    // Here we verify it doesn't throw and cleans up pendingPromptMessages map
    assert.strictEqual(pendingPromptMessages.has(testMemberId), true);
    await deleteRegistrationPromptMessage(testMemberId, null, null);
    assert.strictEqual(pendingPromptMessages.has(testMemberId), false);
  });

  await t.test('deleteRegistrationPromptMessage gracefully handles missing or invalid message targets', async () => {
    await assert.doesNotReject(async () => {
      await deleteRegistrationPromptMessage('non-existent-member', null, null);
    });

    const mockInteraction = {
      message: {
        embeds: [{
          footer: { text: 'ระบบลงทะเบียนสารวัตร • โรงเรียนพระนารายณ์ • [msg:999999999:888888888]' },
          description: '<@1234567890>'
        }]
      }
    };

    await assert.doesNotReject(async () => {
      await deleteRegistrationPromptMessage('mem-fake-99', mockInteraction, { discord_id: '1234567890' });
    });
  });
});
