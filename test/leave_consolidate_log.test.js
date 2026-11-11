const test = require('node:test');
const assert = require('node:assert');
const {
  getTodayDutyCodes,
  getOrCreateLogChannel,
  sendBotActionLog,
  broadcastConsolidatedShiftLeaveCard,
  sendDailyDutyReminders
} = require('../bot.js');

test('sendDailyDutyReminders executes and produces valid remindedList in dryRun', async () => {
  const mockGuild = {
    name: 'SARAWAT-PRANARAI-TEST',
    channels: {
      cache: new Map()
    }
  };

  const res = await sendDailyDutyReminders(mockGuild, { dryRun: true, forceDay: 'TS', actor: 'Test Runner' });
  assert.strictEqual(res.success, true);
  assert.ok(Array.isArray(res.remindedList), 'remindedList should be an array');
  assert.ok(res.count >= 0);
  assert.ok(Array.isArray(res.codes));
});

test('broadcastConsolidatedShiftLeaveCard returns structured stats for shift', async () => {
  const mockGuild = {
    name: 'SARAWAT-PRANARAI-TEST',
    channels: {
      cache: new Map()
    }
  };

  const res = await broadcastConsolidatedShiftLeaveCard(mockGuild, 'TS', {
    nickname: 'ทดสอบ',
    leave_type: 'ลาป่วย',
    reason: 'ทดสอบระบบ'
  }, 'Test Actor');

  assert.strictEqual(res.success, true);
  assert.ok(typeof res.total === 'number');
  assert.ok(typeof res.leaveCount === 'number');
  assert.ok(typeof res.onDutyCount === 'number');
  assert.ok(typeof res.readinessPct === 'number');
});

test('getOrCreateLogChannel finds channel named log case-insensitively', async () => {
  const mockLogChannel = {
    name: 'Log',
    id: 'chan_log_123',
    isTextBased: () => true
  };
  const mockGuild = {
    channels: {
      cache: {
        has: () => false,
        find: (fn) => fn(mockLogChannel) ? mockLogChannel : null
      }
    }
  };

  const ch = await getOrCreateLogChannel(mockGuild);
  assert.ok(ch);
  assert.strictEqual(ch.id, 'chan_log_123');
});
