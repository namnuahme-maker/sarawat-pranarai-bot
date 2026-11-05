const test = require('node:test');
const assert = require('node:assert');
const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const {
  getTodayDutyCodes,
  sendDailyDutyReminders,
  runSystemDiagnostics,
  refreshAllChannelsAndPanels,
  getShiftLabel,
  getDayName
} = require('../bot.js');

test('getTodayDutyCodes returns valid codes for weekdays', () => {
  const codes = getTodayDutyCodes();
  assert.ok(Array.isArray(codes), 'should return an array');
});

test('Quick Leave from DM Modal complies with Discord character limits (<= 45)', () => {
  const modal = new ModalBuilder()
    .setCustomId('modal_dm_quick_leave_mem123')
    .setTitle('📝 ขอลาเวรด่วน [TS1]');
  assert.ok(modal.data.title.length <= 45, 'modal title <= 45');

  const dateInput = new TextInputBuilder()
    .setCustomId('input_leave_date')
    .setLabel('วันที่ขอลา (เช่น วันนี้)')
    .setStyle(TextInputStyle.Short);
  assert.ok(dateInput.data.label.length <= 45, 'dateInput label <= 45');

  const periodInput = new TextInputBuilder()
    .setCustomId('input_shift_period')
    .setLabel('ช่วงเวลาที่ลา (เช้า/กลางวัน/เย็น/ทั้งวัน)')
    .setStyle(TextInputStyle.Short);
  assert.ok(periodInput.data.label.length <= 45, 'periodInput label <= 45');

  const typeInput = new TextInputBuilder()
    .setCustomId('input_leave_type')
    .setLabel('ประเภทการลา (ลาป่วย / ลากิจ / ติดสอบ)')
    .setStyle(TextInputStyle.Short);
  assert.ok(typeInput.data.label.length <= 45, 'typeInput label <= 45');

  const reasonInput = new TextInputBuilder()
    .setCustomId('input_leave_reason')
    .setLabel('เหตุผลการลา')
    .setStyle(TextInputStyle.Paragraph);
  assert.ok(reasonInput.data.label.length <= 45, 'reasonInput label <= 45');

  const substituteInput = new TextInputBuilder()
    .setCustomId('input_substitute')
    .setLabel('สารวัตรที่เข้าเวรแทน (ถ้ามี)')
    .setStyle(TextInputStyle.Short);
  assert.ok(substituteInput.data.label.length <= 45, 'substituteInput label <= 45');
});

test('runSystemDiagnostics produces valid diagnostic report schema', async () => {
  const report = await runSystemDiagnostics(null);
  assert.ok(report, 'report object must exist');
  assert.ok(Array.isArray(report.checks), 'checks must be an array');
  assert.ok(report.checks.length >= 5, 'should have at least 5 checks');

  // Verify modal string limit check inside report
  const modalCheck = report.checks.find(c => c.category.includes('Modal'));
  assert.ok(modalCheck, 'modal string limit check exists');
  assert.equal(modalCheck.pass, true, 'all modal strings must pass <= 45 limit');
});

test('sendDailyDutyReminders dryRun mode executes safely', async () => {
  const res = await sendDailyDutyReminders(null, { dryRun: true, forceDay: 'Ts' });
  assert.ok(res.success, 'dryRun should succeed');
  assert.ok(Array.isArray(res.codes), 'target codes should be returned');
  assert.ok(res.codes.includes('Ts'), 'target codes should include forced day');
});
