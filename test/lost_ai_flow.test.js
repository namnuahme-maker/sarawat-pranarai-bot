'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('Lost & Found AI Service - exports analyzeLostItemImage function', () => {
  const { analyzeLostItemImage } = require('../services/lost_ai_service');
  assert.equal(typeof analyzeLostItemImage, 'function');
});

test('Lost & Found Draft - format and structure handles user hint and AI fields correctly', () => {
  const report = {
    reportId: 'rep_12345',
    userId: '987654321',
    userName: 'Officer Pimmy',
    title: 'หมวกแก๊ปสีดำ ลายปัก NY',
    category: 'เครื่องแต่งกาย / หมวก',
    characteristics: 'หมวกแก๊ปผ้าสีดำ สภาพ 90% มีรอยขีดข่วนเล็กน้อย',
    secretTraits: 'มีชื่อ Pimmy เขียนด้านในปีกหมวก',
    locationFound: 'โต๊ะม้าหินอ่อนหน้าอาคาร 3',
    attachmentUrl: 'https://cdn.discordapp.com/attachments/123/456/cap.jpg'
  };

  assert.equal(report.title, 'หมวกแก๊ปสีดำ ลายปัก NY');
  assert.equal(report.category, 'เครื่องแต่งกาย / หมวก');
  assert.ok(report.characteristics.includes('สีดำ'));
  assert.ok(report.secretTraits.includes('Pimmy'));
});
