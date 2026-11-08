const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const {
  pendingPhotoUploads,
  getUploadDir
} = require('../bot');

test('Photo Upload Direct Mode Suite (Background Removal Disabled)', async (t) => {
  await t.test('pendingPhotoUploads Map should store, retrieve, and delete pending uploads', () => {
    const testMemberId = 'mem_test_12345';
    pendingPhotoUploads.set(testMemberId, {
      url: 'https://example.com/test.png',
      name: 'test.png',
      memberId: testMemberId,
      timestamp: Date.now()
    });

    assert.equal(pendingPhotoUploads.has(testMemberId), true);
    const item = pendingPhotoUploads.get(testMemberId);
    assert.equal(item.url, 'https://example.com/test.png');

    pendingPhotoUploads.delete(testMemberId);
    assert.equal(pendingPhotoUploads.has(testMemberId), false);
  });

  await t.test('getUploadDir should resolve to an accessible directory', () => {
    const dir = getUploadDir();
    assert.ok(typeof dir === 'string' && dir.length > 0);
    assert.ok(fs.existsSync(dir), `Upload directory must exist: ${dir}`);
  });
});
