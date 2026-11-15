const test = require('node:test');
const assert = require('node:assert/strict');
const { slashCommands, syncAllMediaToGoogleDrive } = require('../bot');

test('Slash Commands /send and /update Test Suite', async (t) => {
  await t.test('send command is properly configured with message option', () => {
    const sendCmd = slashCommands.find(c => c.name === 'send');
    assert.ok(sendCmd, 'Command /send must exist');
    const json = sendCmd.toJSON();
    assert.equal(json.name, 'send');
    assert.ok(json.description.includes('ประกาศ'));
    assert.equal(json.options?.length, 1);
    assert.equal(json.options[0].name, 'message');
    assert.equal(json.options[0].required, true);
  });

  await t.test('update command is properly configured', () => {
    const updateCmd = slashCommands.find(c => c.name === 'update');
    assert.ok(updateCmd, 'Command /update must exist');
    const json = updateCmd.toJSON();
    assert.equal(json.name, 'update');
    assert.ok(json.description.includes('กู้คืน') || json.description.includes('อัปเดต'));
  });

  await t.test('syncAllMediaToGoogleDrive function is exported', () => {
    assert.equal(typeof syncAllMediaToGoogleDrive, 'function');
  });
});
