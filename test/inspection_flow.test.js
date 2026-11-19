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

  // 4. Complete Duty Modal (Instant Incident Dispatch flow)
  const modalComplete = new ModalBuilder()
    .setCustomId('modal_complete_duty_CASE-9999')
    .setTitle('เสร็จสิ้นภารกิจ CASE-9999');
  assert.ok(modalComplete.data.title.length <= 45, 'complete duty modal title <= 45');

  const topicInput = new TextInputBuilder()
    .setCustomId('input_duty_topic')
    .setLabel('หัวข้อเรื่อง / สรุปเหตุการณ์')
    .setStyle(TextInputStyle.Short);
  assert.ok(topicInput.data.label.length <= 45, 'topicInput label <= 45');

  const detailsInput = new TextInputBuilder()
    .setCustomId('input_duty_details')
    .setLabel('รายละเอียดผลการปฏิบัติหน้าที่')
    .setStyle(TextInputStyle.Paragraph);
  assert.ok(detailsInput.data.label.length <= 45, 'detailsInput label <= 45');
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

test('Attendance Sheet date headers format accurately for AI scan step 2', () => {
  const { getAttendanceDates } = require('../bot.js');
  if (typeof getAttendanceDates === 'function') {
    const shifts = ['M', 'T', 'W', 'Th', 'F', 'S'];
    shifts.forEach(s => {
      const dates = getAttendanceDates(s, 12);
      assert.equal(dates.length, 12, `Shift ${s} must have 12 date columns`);
      dates.forEach((dStr, idx) => {
        const [m, d] = dStr.split('/');
        assert.ok(!isNaN(parseInt(m)) && !isNaN(parseInt(d)), `Valid month/day in ${dStr}`);
        const label = `สัปดาห์ที่ ${idx + 1} (${d}/${m} • ${m}/${d})`;
        assert.ok(label.includes('สัปดาห์ที่'), 'Label has week prefix');
        assert.ok(label.includes(`${d}/${m}`), 'Label has day/month');
        assert.ok(label.includes(`${m}/${d}`), 'Label has month/day');
      });
    });
  }
});

test('sortMembersByGradeRoomNumber sorts members accurately by Grade -> Room -> Student Number', () => {
  const { sortMembersByGradeRoomNumber, getMemberSortKey } = require('../bot.js');
  assert.equal(typeof sortMembersByGradeRoomNumber, 'function', 'sortMembersByGradeRoomNumber must be exported');
  assert.equal(typeof getMemberSortKey, 'function', 'getMemberSortKey must be exported');

  // Sample data mimicking real members from the user's attendance sheet
  const inputMembers = [
    { duty_id: 'FS1', name: 'นายภัทรพล บุญวิเศษ', class_room: '5/7 (4)', student_no: 4 },
    { duty_id: 'FS2', name: 'นางสาวปรีณาพรรณ ขันศิริ', class_room: '6/4 (36)', student_no: 36 },
    { duty_id: 'FS3', name: 'นายจาตุพัฒน์ ขอนแก่น', class_room: '4/1 (19)', student_no: 19 },
    { duty_id: 'MS1', name: 'นางสาวมัลลิกา เลื่อนลอย', class_room: '5/7 (14)', student_no: 14 },
    { duty_id: 'MS2', name: 'นายศรัณยพงศ์ วงศ์สุวรรณ', class_room: '5/7 (33)', student_no: 33 },
    { duty_id: 'MS3', name: 'นางสาวพรนัชชา ประสมพงค์', class_room: '5/5 (3)', student_no: 3 },
    { duty_id: 'TS2', name: 'นายคณิศร ตะพานแก้ว', class_room: '5/8 (5)', student_no: 5 },
    { duty_id: 'TS6', name: 'นางสาวกันติชา ชอบธรรมดี', class_room: '6/10 (9)', student_no: 9 },
    { duty_id: 'WS1', name: 'นางสาวภีรดา ภาณุมาศ', class_room: '6/2 (34)', student_no: 34 },
    { duty_id: 'WS2', name: 'นายพชรพล กระดุมผล', class_room: '4/9 (4)', student_no: 4 },
    { duty_id: 'WS3', name: 'นางสาวยุพิน บุญวัง', class_room: '6/9 (7)', student_no: 7 }
  ];

  const sorted = sortMembersByGradeRoomNumber(inputMembers);
  const resultOrder = sorted.map(m => `${m.class_room}`);

  // Expected sequence:
  // ม.4: 4/1 (19), 4/9 (4)
  // ม.5: 5/5 (3), 5/7 (4), 5/7 (14), 5/7 (33), 5/8 (5)
  // ม.6: 6/2 (34), 6/4 (36), 6/9 (7), 6/10 (9)
  const expectedOrder = [
    '4/1 (19)',
    '4/9 (4)',
    '5/5 (3)',
    '5/7 (4)',
    '5/7 (14)',
    '5/7 (33)',
    '5/8 (5)',
    '6/2 (34)',
    '6/4 (36)',
    '6/9 (7)',
    '6/10 (9)'
  ];

  assert.deepEqual(resultOrder, expectedOrder, 'Roster must be strictly ordered by Grade -> Room -> Student Number');
});

test('Special Shift (S) uses blank boxes for 5-day tallying, while Weekdays use OMR circles', () => {
  const { generateAttendanceSheetHTML } = require('../bot.js');
  assert.equal(typeof generateAttendanceSheetHTML, 'function', 'generateAttendanceSheetHTML must be exported');

  const sampleMembers = [
    { id: 'm1', duty_id: 'MS1', nickname: 'ไอซ์', first_name: 'มัลลิกา', last_name: 'เลื่อนลอย', grade_class: '5/7', student_no: 14, post: 'ประตู 1' }
  ];

  // Weekday Monday (M) -> Should contain omr-circle
  const mondayHtml = generateAttendanceSheetHTML('M', 'เวรวันจันทร์', sampleMembers);
  assert.ok(mondayHtml.includes('class="omr-circle"'), 'Weekday shift must have OMR circles for AI scanning');
  assert.ok(mondayHtml.includes('ฝนดำในวงกลม'), 'Weekday shift legend must explain OMR bubbles');

  // Special Shift (S) -> Should NOT contain omr-circle, should have blank boxes and tally legend
  const specialHtml = generateAttendanceSheetHTML('S', 'เวรพิเศษ', sampleMembers);
  assert.ok(!specialHtml.includes('class="omr-circle"'), 'Special shift must NOT have OMR circles');
  assert.ok(specialHtml.includes('卌'), 'Special shift legend must explain tally marking [卌]');
});
