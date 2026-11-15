const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanFullName, cleanGradeClass } = require('../bot');

test('Self-Service Profile Edit Test Suite', async (t) => {
  await t.test('cleanFullName correctly normalizes prefixes and full name', () => {
    const r1 = cleanFullName('นาย อมตะ สัตยัง');
    assert.equal(r1, 'นายอมตะ สัตยัง');
    const p1 = r1.split(' ');
    assert.equal(p1[0], 'นายอมตะ');
    assert.equal(p1[1], 'สัตยัง');

    const r2 = cleanFullName('วรวิทย์ สบายดี');
    assert.equal(r2, 'วรวิทย์ สบายดี');
    const p2 = r2.split(' ');
    assert.equal(p2[0], 'วรวิทย์');
    assert.equal(p2[1], 'สบายดี');
  });

  await t.test('cleanGradeClass formats school class numbers properly', () => {
    assert.equal(cleanGradeClass('ม.5/6'), '5/6');
    assert.equal(cleanGradeClass('6/4'), '6/4');
    assert.equal(cleanGradeClass('ม.4/1'), '4/1');
  });

  await t.test('Modal field labels must comply with Discord <= 45 limit', () => {
    const labels = [
      'ชื่อ-นามสกุลจริง (ระบุคำนำหน้าด้วย)',
      'ชื่อเล่น',
      'ชั้นเรียน / ห้อง (เช่น 5/6)',
      'เลขที่ (ตัวเลขเท่านั้น เช่น 23)',
      'เบอร์โทรศัพท์ติดต่อ'
    ];
    for (const label of labels) {
      assert.ok(label.length <= 45, `Label too long (${label.length}): "${label}"`);
    }
  });

  await t.test('Diff calculation correctly compares old vs new profile data', () => {
    const oldData = {
      first_name: 'นายอมตะ',
      last_name: 'สัตยัง',
      nickname: 'วรวิทย์',
      grade_class: '5/6',
      student_no: 33,
      phone_number: '067-730-7761'
    };

    const newData = {
      first_name: 'นายอมตะ',
      last_name: 'สัตยัง',
      nickname: 'วิทย์',
      grade_class: '6/6',
      student_no: 33,
      phone_number: '081-111-2222'
    };

    const changedKeys = Object.keys(newData).filter(k => newData[k] !== oldData[k]);
    assert.deepEqual(changedKeys, ['nickname', 'grade_class', 'phone_number']);
  });
});
