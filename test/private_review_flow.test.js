const test = require('node:test');
const assert = require('node:assert');
const {
  buildPrivateReviewCard,
  buildRegistrationEditModal
} = require('../bot.js');

test('Private Review & Registration Edit Flow Architecture', async (t) => {
  const dummyMember = {
    id: 'mem_test_uuid_999',
    first_name: 'นายกำชัย',
    last_name: 'กำร่อยๆ',
    nickname: 'ปวินธิดา',
    grade_class: '5/7',
    student_no: 32,
    phone_number: '083-342-2275',
    duty_day: 'TS',
    profile_image_url: 'https://example.com/photos/profile_cropped_test.jpg',
    status: 'PENDING_APPROVAL'
  };

  await t.test('buildPrivateReviewCard produces private Ephemeral embed with exactly 2 action buttons', () => {
    const { embed, row } = buildPrivateReviewCard(dummyMember);

    assert.ok(embed, 'Embed should be created');
    assert.match(embed.data.title, /เฉพาะคุณที่มองเห็น/);
    assert.match(embed.data.description, /นายกำชัย/);
    assert.match(embed.data.description, /ปวินธิดา/);
    assert.strictEqual(embed.data.image.url, dummyMember.profile_image_url);

    // Verify fields
    const fields = embed.data.fields || [];
    const nameField = fields.find(f => f.name.includes('ข้อมูลสารวัตร'));
    assert.ok(nameField, 'Should contain applicant info field');
    assert.match(nameField.value, /5\/7/);
    assert.match(nameField.value, /#32/);

    // Verify 2 action buttons
    assert.strictEqual(row.components.length, 2, 'Should have exactly 2 buttons');

    const confirmBtn = row.components[0];
    assert.strictEqual(confirmBtn.data.custom_id, `btn_confirm_send_approval_${dummyMember.id}`);
    assert.match(confirmBtn.data.label, /ยืนยันข้อมูล & ส่งขออนุมัติ/);
    assert.strictEqual(confirmBtn.data.style, 3); // Success (Green)

    const editBtn = row.components[1];
    assert.strictEqual(editBtn.data.custom_id, `btn_edit_registration_info_${dummyMember.id}`);
    assert.match(editBtn.data.label, /แก้ไขข้อมูล/);
    assert.strictEqual(editBtn.data.style, 2); // Secondary (Grey)
  });

  await t.test('buildRegistrationEditModal produces 5-field modal complying with Discord <= 45 character rule', () => {
    const modal = buildRegistrationEditModal(dummyMember);

    assert.ok(modal, 'Modal should be created');
    assert.strictEqual(modal.data.custom_id, `modal_edit_reg_${dummyMember.id}`);
    assert.match(modal.data.title, /แก้ไขข้อมูลผู้สมัคร/);

    // Discord allows at most 5 ActionRows in a Modal
    assert.strictEqual(modal.components.length, 5, 'Modal must contain exactly 5 ActionRows');

    const expectedFields = [
      { id: 'input_name', value: `${dummyMember.first_name} ${dummyMember.last_name}` },
      { id: 'input_nickname', value: dummyMember.nickname },
      { id: 'input_grade', value: dummyMember.grade_class },
      { id: 'input_student_no', value: String(dummyMember.student_no) },
      { id: 'input_phone', value: dummyMember.phone_number }
    ];

    modal.components.forEach((row, idx) => {
      const comp = row.components[0];
      const expected = expectedFields[idx];
      assert.strictEqual(comp.data.custom_id, expected.id);
      assert.strictEqual(comp.data.value, expected.value);
      assert.ok(
        comp.data.label.length <= 45,
        `Label '${comp.data.label}' length (${comp.data.label.length}) must be <= 45`
      );
    });
  });
});
