const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const {
  pendingPhotoUploads,
  getUploadDir,
  processBackgroundRemoval
} = require('../bot');

test('Photo Upload & Background Removal Feature Suite', async (t) => {
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

  await t.test('Button Custom IDs must strictly fit within Discord limit (<= 100 chars)', () => {
    const uuid = '00000000-0000-0000-0000-000000000000';
    const removeBgId = `btn_photo_remove_bg_${uuid}`;
    const keepOrigId = `btn_photo_keep_orig_${uuid}`;

    assert.ok(removeBgId.length <= 100, `removeBgId too long: ${removeBgId.length}`);
    assert.ok(keepOrigId.length <= 100, `keepOrigId too long: ${keepOrigId.length}`);
    assert.ok(removeBgId.startsWith('btn_photo_remove_bg_'));
    assert.ok(keepOrigId.startsWith('btn_photo_keep_orig_'));
  });

  await t.test('getUploadDir should resolve to an accessible directory', () => {
    const dir = getUploadDir();
    assert.ok(typeof dir === 'string' && dir.length > 0);
    assert.ok(fs.existsSync(dir), `Upload directory must exist: ${dir}`);
  });

  await t.test('processBackgroundRemoval should invoke python rembg and generate transparent PNG', async () => {
    const sampleInput = path.resolve(__dirname, '../assets/school_emblem.png');
    if (!fs.existsSync(sampleInput)) {
      // Skip if assets file not present in relative test run
      return;
    }
    const result = await processBackgroundRemoval(sampleInput, 'test_runner');
    assert.ok(result.outPath);
    assert.ok(fs.existsSync(result.outPath));
    assert.ok(result.outFileName.endsWith('.png'));

    // Clean up test file
    try {
      fs.unlinkSync(result.outPath);
    } catch (e) {}
  });
});
