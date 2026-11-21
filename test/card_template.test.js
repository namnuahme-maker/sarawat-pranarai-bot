'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { generateCardHTML } = require('../card_template');

test('ID Card Template - Officer with no photo shows solid black border and 👤 placeholder', () => {
  const html = generateCardHTML({
    first_name: 'กิตติ',
    last_name: 'มีสุข',
    nickname: 'บอส',
    duty_id: 'TS4',
    profile_image_url: null
  });

  assert.ok(html.includes('border: 2px solid #000000'), 'Must contain 2px solid black border');
  assert.ok(html.includes('👤'), 'Must contain person emoji');
  assert.ok(html.includes('ขนาดรูปสูงสุด'), 'Must contain label indicating max photo dimensions');
  assert.ok(!html.includes('sample_student.jpg'), 'Must never default to sample student (Bank) photo');
});

test('ID Card Template - Officer with photo displays uploaded photo with crisp boundary', () => {
  const photoUrl = 'https://lh3.googleusercontent.com/test_officer_photo.png';
  const html = generateCardHTML({
    first_name: 'นำเหนือ',
    last_name: 'คำไชย',
    nickname: 'นำเหนือ',
    duty_id: 'TS1',
    profile_image_url: photoUrl
  });

  assert.ok(html.includes(photoUrl), 'Must render custom officer photo URL');
  assert.ok(html.includes('border: 1.5px solid #000000'), 'Must contain crisp border for photo');
  assert.ok(!html.includes('sample_student.jpg'), 'Must not contain Bank sample photo');
});

test('ID Card Template - Always renders card background image template', () => {
  const html = generateCardHTML({
    first_name: 'ทดสอบ',
    last_name: 'ระบบ',
    nickname: 'เทส',
    duty_id: 'TS2'
  });

  assert.ok(html.includes('alt="Background"'), 'Must render background template image');
});
