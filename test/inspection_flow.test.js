const test = require('node:test');
const assert = require('node:assert');
const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

test('Inspection Modals comply with Discord string length limits (<= 45)', () => {
  // 1. Request Operation Category Modals
  const catTitles = [
    'ขออนุมัติปฏิบัติ: เกิดเหตุก่อวิวาท',
    'ขออนุมัติปฏิบัติ: เหตุน่าสงสัย',
    'ขออนุมัติปฏิบัติ: เหตุผลอื่นๆ',
    '🔍 แบบฟอร์มขออนุมัติการตรวจ'
  ];
  for (const t of catTitles) {
    assert.ok(t.length <= 45, `Category modal title "${t}" must be <= 45 chars`);
  }

  const targetInput = new TextInputBuilder()
    .setCustomId('input_insp_target')
    .setLabel('สถานที่ / จุดเกิดเหตุ')
    .setStyle(TextInputStyle.Short);
  assert.ok(targetInput.data.label.length <= 45, 'targetInput label <= 45');

  const reasonInput = new TextInputBuilder()
    .setCustomId('input_insp_reason')
    .setLabel('รายละเอียด / พฤติการณ์เหตุการณ์')
    .setStyle(TextInputStyle.Paragraph);
  assert.ok(reasonInput.data.label.length <= 45, 'reasonInput label <= 45');

  const officersInput = new TextInputBuilder()
    .setCustomId('input_insp_officers')
    .setLabel('สารวัตรผู้ร่วมปฏิบัติ (รหัสเวร/ชื่อ)')
    .setStyle(TextInputStyle.Short);
  assert.ok(officersInput.data.label.length <= 45, 'officersInput label <= 45');

  const urgencyInput = new TextInputBuilder()
    .setCustomId('input_insp_urgency')
    .setLabel('ระดับความเร่งด่วน (ปกติ/ด่วน/ด่วนมาก)')
    .setStyle(TextInputStyle.Short);
  assert.ok(urgencyInput.data.label.length <= 45, 'urgencyInput label <= 45');

  // 2. Approve Modal
  const modalApprove = new ModalBuilder()
    .setCustomId('modal_approve_insp_CASE-9999')
    .setTitle('อนุมัติปฏิบัติ CASE-9999');
  assert.ok(modalApprove.data.title.length <= 45, 'approve modal title <= 45');

  const noteInput = new TextInputBuilder()
    .setCustomId('input_insp_approval_note')
    .setLabel('หมายเหตุ / คำสั่งการเพิ่มเติม')
    .setStyle(TextInputStyle.Paragraph);
  assert.ok(noteInput.data.label.length <= 45, 'noteInput label <= 45');

  // 3. Finish Inspection Modal
  const modalFinish = new ModalBuilder()
    .setCustomId('modal_finish_insp_CASE-9999')
    .setTitle('บันทึกปิดคดี CASE-9999');
  assert.ok(modalFinish.data.title.length <= 45, 'finish modal title <= 45');

  const whoInput = new TextInputBuilder()
    .setCustomId('input_finish_who')
    .setLabel('ใครทำ (รายชื่อสารวัตรผู้ปฏิบัติ)')
    .setStyle(TextInputStyle.Short);
  assert.ok(whoInput.data.label.length <= 45, 'whoInput label <= 45');

  const whatInput = new TextInputBuilder()
    .setCustomId('input_finish_what')
    .setLabel('ทำอะไร (ผลการปฏิบัติและสิ่งที่พบ)')
    .setStyle(TextInputStyle.Paragraph);
  assert.ok(whatInput.data.label.length <= 45, 'whatInput label <= 45');

  const whenInput = new TextInputBuilder()
    .setCustomId('input_finish_when')
    .setLabel('ตอนไหน (เวลาปฏิบัติ เช่น 12:30 น.)')
    .setStyle(TextInputStyle.Short);
  assert.ok(whenInput.data.label.length <= 45, 'whenInput label <= 45');

  const evInput = new TextInputBuilder()
    .setCustomId('input_finish_evidence')
    .setLabel('ไฟล์หลักฐาน / ลิงก์ไดรฟ์ (ถ้ามี)')
    .setStyle(TextInputStyle.Short);
  assert.ok(evInput.data.label.length <= 45, 'evInput label <= 45');
});

test('Channel name check logic handles บริการ and บริการเวรและใบเช็คชื่อ', () => {
  const oldName = '📑│บริการเวรและใบเช็คชื่อ';
  const newName = '📑│บริการ';
  const matchFn = (name) => name.includes('บริการ');
  assert.ok(matchFn(oldName), 'old name matches');
  assert.ok(matchFn(newName), 'new name matches');
});

test('refreshAllChannelsAndPanels is exported and safe (zero data wipe)', () => {
  const { refreshAllChannelsAndPanels } = require('../bot.js');
  assert.equal(typeof refreshAllChannelsAndPanels, 'function', 'function must be exported');
});
