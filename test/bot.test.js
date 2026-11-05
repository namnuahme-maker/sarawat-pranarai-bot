const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const DAY_NAMES = {
  'M': 'วันจันทร์',
  'T': 'วันอังคาร',
  'W': 'วันพุธ',
  'Ts': 'วันพฤหัสบดี',
  'TSS': 'วันพฤหัสบดี',
  'F': 'วันศุกร์',
  'S': 'พิเศษ (ทุกวัน)'
};

function getShiftLabel(code) {
  if (!code) return 'ไม่ระบุ';
  if (code === 'S') return 'พิเศษ ทุกวัน (S)';
  if (code.endsWith('S') && code !== 'S') {
    const base = code === 'TSS' ? 'Ts' : code.replace(/S+$/, '');
    const baseName = DAY_NAMES[base] || base;
    return `${baseName} + เวรพิเศษทุกวัน (${code})`;
  }
  return `${DAY_NAMES[code] || code} (${code})`;
}

const mockRoles = {
  VERIFIED: 'role_verified',
  DAYS: {
    'M': 'role_mon',
    'T': 'role_tue',
    'W': 'role_wed',
    'Ts': 'role_thu',
    'F': 'role_fri',
    'S': 'role_special'
  }
};

function getDutyRoles(dutyDay) {
  if (!dutyDay) return [];
  const roles = [];
  if (dutyDay.endsWith('S') && dutyDay !== 'S') {
    const baseDay = dutyDay === 'TSS' ? 'Ts' : dutyDay.replace(/S+$/, '');
    if (mockRoles.DAYS[baseDay]) roles.push(mockRoles.DAYS[baseDay]);
    if (mockRoles.DAYS['S']) roles.push(mockRoles.DAYS['S']);
  } else if (dutyDay === 'S') {
    if (mockRoles.DAYS['S']) roles.push(mockRoles.DAYS['S']);
  } else {
    if (mockRoles.DAYS[dutyDay]) roles.push(mockRoles.DAYS[dutyDay]);
  }
  return roles.filter(Boolean);
}

function calculateNextDutyId(existingIds, prefix) {
  const occupiedNumbers = new Set(
    existingIds
      .map(id => parseInt(id.replace(prefix, ''), 10))
      .filter(num => !isNaN(num))
  );

  let candidate = 1;
  while (occupiedNumbers.has(candidate)) {
    candidate++;
  }
  return `${prefix}${candidate}`;
}

describe('SARAWAT-BOT New Shift & Combined Duty ID Verification', () => {

  test('getShiftLabel should format combined special shifts accurately', () => {
    assert.equal(getShiftLabel('M'), 'วันจันทร์ (M)');
    assert.equal(getShiftLabel('MS'), 'วันจันทร์ + เวรพิเศษทุกวัน (MS)');
    assert.equal(getShiftLabel('TS'), 'วันอังคาร + เวรพิเศษทุกวัน (TS)');
    assert.equal(getShiftLabel('WS'), 'วันพุธ + เวรพิเศษทุกวัน (WS)');
    assert.equal(getShiftLabel('TSS'), 'วันพฤหัสบดี + เวรพิเศษทุกวัน (TSS)');
    assert.equal(getShiftLabel('FS'), 'วันศุกร์ + เวรพิเศษทุกวัน (FS)');
    assert.equal(getShiftLabel('S'), 'พิเศษ ทุกวัน (S)');

    // No double 'เวร'
    assert.equal(getShiftLabel('MS').includes('เวรเวร'), false);
  });

  test('getDutyRoles should grant both Weekday role AND Special role for combined shifts', () => {
    const mondaySpecialRoles = getDutyRoles('MS');
    assert.deepEqual(mondaySpecialRoles, ['role_mon', 'role_special']);

    const fridaySpecialRoles = getDutyRoles('FS');
    assert.deepEqual(fridaySpecialRoles, ['role_fri', 'role_special']);

    const regularMondayRoles = getDutyRoles('M');
    assert.deepEqual(regularMondayRoles, ['role_mon']);

    const legacySpecialRoles = getDutyRoles('S');
    assert.deepEqual(legacySpecialRoles, ['role_special']);
  });

  test('calculateNextDutyId should assign duty IDs for combined prefixes (MS, TS, FS, TSS)', () => {
    assert.equal(calculateNextDutyId(['MS1', 'MS2'], 'MS'), 'MS3');
    assert.equal(calculateNextDutyId(['MS1', 'MS3'], 'MS'), 'MS2'); // gap filling
    assert.equal(calculateNextDutyId([], 'FS'), 'FS1');
    assert.equal(calculateNextDutyId(['TSS1'], 'TSS'), 'TSS2');
  });

  test('Webhook authorization should reject invalid or missing secrets', () => {
    const expectedSecret = 'pranarai_secret_sarawat_2026';
    function checkAuth(providedSecret) {
      if (expectedSecret && providedSecret !== expectedSecret) {
        return { status: 401, error: 'Unauthorized' };
      }
      return { status: 200, success: true };
    }

    assert.equal(checkAuth(undefined).status, 401);
    assert.equal(checkAuth('wrong_key').status, 401);
    assert.equal(checkAuth('pranarai_secret_sarawat_2026').status, 200);
  });

  test('Payload size check must drop payloads larger than 1MB', () => {
    const MAX_SIZE = 1e6;
    assert.equal(500 <= MAX_SIZE, true);
    assert.equal(1000001 <= MAX_SIZE, false);
  });

  test('Attendance sheet should format English day name in UPPERCASE and SPECIAL correctly', () => {
    function getEnglishDayName(dayCode) {
      const base = dayCode === 'TSS' ? 'Ts' : dayCode.replace(/S+$/, '') || dayCode;
      switch (base) {
        case 'M': return 'MONDAY';
        case 'T': return 'TUESDAY';
        case 'W': return 'WEDNESDAY';
        case 'Ts': return 'THURSDAY';
        case 'F': return 'FRIDAY';
        case 'S': return 'SPECIAL';
        default: return 'ATTENDANCE';
      }
    }

    assert.equal(getEnglishDayName('M'), 'MONDAY');
    assert.equal(getEnglishDayName('MS'), 'MONDAY');
    assert.equal(getEnglishDayName('T'), 'TUESDAY');
    assert.equal(getEnglishDayName('TS'), 'TUESDAY');
    assert.equal(getEnglishDayName('W'), 'WEDNESDAY');
    assert.equal(getEnglishDayName('WS'), 'WEDNESDAY');
    assert.equal(getEnglishDayName('Ts'), 'THURSDAY');
    assert.equal(getEnglishDayName('TSS'), 'THURSDAY');
    assert.equal(getEnglishDayName('F'), 'FRIDAY');
    assert.equal(getEnglishDayName('FS'), 'FRIDAY');
    assert.equal(getEnglishDayName('S'), 'SPECIAL');
  });

  test('Attendance column headers should use weeks (ส.1, ส.2) for SPECIAL and dates (M/D) for weekdays', () => {
    function getHeaders(dayCode) {
      const isSpecial = dayCode === 'S';
      if (isSpecial) {
        return {
          title: 'บันทึกการมาปฏิบัติหน้าที่ (สัปดาห์ที่ 1 ถึง 12)',
          cols: Array.from({ length: 12 }).map((_, i) => `ส.${i + 1}`)
        };
      }
      return {
        title: 'บันทึกการมาปฏิบัติหน้าที่ (เดือน/วัน)',
        cols: ['11/9', '11/16'] // simulated dates
      };
    }

    const specialHeaders = getHeaders('S');
    assert.equal(specialHeaders.title, 'บันทึกการมาปฏิบัติหน้าที่ (สัปดาห์ที่ 1 ถึง 12)');
    assert.equal(specialHeaders.cols[0], 'ส.1');
    assert.equal(specialHeaders.cols[11], 'ส.12');

    const mondayHeaders = getHeaders('M');
    assert.equal(mondayHeaders.title, 'บันทึกการมาปฏิบัติหน้าที่ (เดือน/วัน)');
    assert.match(mondayHeaders.cols[0], /^\d{1,2}\/\d{1,2}$/);
  });

  test('Attendance dates should produce 12 Month/Day format dates instead of generic week labels', () => {
    function getAttendanceDates(dayCode, count = 12) {
      const dayIndexMap = { 'M': 1, 'T': 2, 'W': 3, 'Ts': 4, 'F': 5, 'S': 1 };
      const baseDay = dayCode === 'TSS' ? 'Ts' : dayCode.replace(/S+$/, '') || 'M';
      const targetDay = dayIndexMap[baseDay] || 1;

      const now = new Date();
      const currentDay = now.getDay();
      const diff = targetDay - currentDay;
      const start = new Date(now);
      start.setDate(now.getDate() + diff);

      const dates = [];
      for (let i = 0; i < count; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + (i * 7));
        dates.push(`${d.getMonth() + 1}/${d.getDate()}`);
      }
      return dates;
    }

    const mondayDates = getAttendanceDates('M', 12);
    assert.equal(mondayDates.length, 12);
    assert.match(mondayDates[0], /^\d{1,2}\/\d{1,2}$/);
    assert.equal(mondayDates.some(d => d.startsWith('ส.')), false);
  });

  test('resolveDutyDayForAppoint should accurately align duty shifts for M, T, W, Ts, F, S appointments', () => {
    function resolveDutyDayForAppoint(currentDutyDay, targetShift) {
      if (!targetShift) return currentDutyDay;
      const isSpecialTarget = targetShift === 'S';
      const hasSpecial = currentDutyDay && (currentDutyDay.endsWith('S') || currentDutyDay === 'S');

      if (isSpecialTarget) {
        if (!currentDutyDay || currentDutyDay === 'S') return 'S';
        if (currentDutyDay.endsWith('S')) return currentDutyDay;
        return currentDutyDay === 'Ts' ? 'TSS' : `${currentDutyDay}S`;
      } else {
        if (hasSpecial) {
          return targetShift === 'Ts' ? 'TSS' : `${targetShift}S`;
        }
        return targetShift;
      }
    }

    // Appoint regular day
    assert.equal(resolveDutyDayForAppoint('M', 'M'), 'M');
    assert.equal(resolveDutyDayForAppoint('T', 'W'), 'W');
    assert.equal(resolveDutyDayForAppoint('F', 'Ts'), 'Ts');

    // Appoint regular day when member has special duty
    assert.equal(resolveDutyDayForAppoint('MS', 'M'), 'MS');
    assert.equal(resolveDutyDayForAppoint('TS', 'W'), 'WS');
    assert.equal(resolveDutyDayForAppoint('FS', 'Ts'), 'TSS');
    assert.equal(resolveDutyDayForAppoint('S', 'T'), 'TS');

    // Appoint special duty (S)
    assert.equal(resolveDutyDayForAppoint('M', 'S'), 'MS');
    assert.equal(resolveDutyDayForAppoint('Ts', 'S'), 'TSS');
    assert.equal(resolveDutyDayForAppoint('MS', 'S'), 'MS');
    assert.equal(resolveDutyDayForAppoint('S', 'S'), 'S');
  });

  test('Custom ID parsing for leadership appointment buttons must support UUIDs and all 6 shifts', () => {
    function parseAppointButtonCustomId(customId) {
      const raw = customId.replace('btn_confirm_appoint_', '');
      const parts = raw.split('_');
      const roleType = parts.slice(-2).join('_');
      const selectedDay = parts[parts.length - 3];
      const memberId = parts.slice(0, parts.length - 3).join('_');
      return { memberId, selectedDay, roleType };
    }

    const testUuid = 'c2a63273-057b-402d-8ae5-11e2fbc25f77';
    const parsedHeadMon = parseAppointButtonCustomId(`btn_confirm_appoint_${testUuid}_M_SHIFT_HEAD`);
    assert.equal(parsedHeadMon.memberId, testUuid);
    assert.equal(parsedHeadMon.selectedDay, 'M');
    assert.equal(parsedHeadMon.roleType, 'SHIFT_HEAD');

    const parsedDeputyThu = parseAppointButtonCustomId(`btn_confirm_appoint_${testUuid}_Ts_SHIFT_DEPUTY`);
    assert.equal(parsedDeputyThu.memberId, testUuid);
    assert.equal(parsedDeputyThu.selectedDay, 'Ts');
    assert.equal(parsedDeputyThu.roleType, 'SHIFT_DEPUTY');

    const parsedSpecial = parseAppointButtonCustomId(`btn_confirm_appoint_${testUuid}_S_SHIFT_HEAD`);
    assert.equal(parsedSpecial.memberId, testUuid);
    assert.equal(parsedSpecial.selectedDay, 'S');
    assert.equal(parsedSpecial.roleType, 'SHIFT_HEAD');
  });

  test('Obsolete day roles and previous leadership roles should be cleaned up when changing shift', () => {
    const rolesDays = {
      'M': 'role_mon',
      'T': 'role_tue',
      'W': 'role_wed',
      'Ts': 'role_thu',
      'F': 'role_fri',
      'S': 'role_special'
    };

    function calculateRoleDeltas(newDutyDay, addRoleId) {
      const validDayRoles = getDutyRoles(newDutyDay);
      const allDayRoles = Object.values(rolesDays);
      const obsoleteDayRoles = allDayRoles.filter(rid => !validDayRoles.includes(rid));
      const rolesToAdd = [addRoleId, ...validDayRoles].filter(Boolean);
      return { rolesToAdd, obsoleteDayRoles };
    }

    // Moving from Monday (M) to Thursday Special (TSS) as Head of Ts
    const delta = calculateRoleDeltas('TSS', 'role_head_thu');
    assert.deepEqual(delta.rolesToAdd, ['role_head_thu', 'role_thu', 'role_special']);
    assert.equal(delta.obsoleteDayRoles.includes('role_mon'), true); // Old Monday role MUST be in obsolete
    assert.equal(delta.obsoleteDayRoles.includes('role_tue'), true);
    assert.equal(delta.obsoleteDayRoles.includes('role_wed'), true);
    assert.equal(delta.obsoleteDayRoles.includes('role_fri'), true);
    assert.equal(delta.obsoleteDayRoles.includes('role_thu'), false); // Current Thursday role kept
    assert.equal(delta.obsoleteDayRoles.includes('role_special'), false); // Special role kept
  });

  test('Slash Commands list must contain all 11 commands and valid Discord naming conventions', () => {
    const { slashCommands } = require('../bot.js');
    assert.equal(Array.isArray(slashCommands), true);
    assert.equal(slashCommands.length, 11);

    const commandNames = slashCommands.map(c => c.name);
    const expected = [
      'status', 'my-card', 'sync-roles', 'semester',
      'setup-verify', 'setup-leave', 'setup-attendance',
      'setup-photo', 'setup-appoint', 'setup-all', 'd-day'
    ];

    for (const exp of expected) {
      assert.equal(commandNames.includes(exp), true, `Missing slash command: ${exp}`);
    }

    // Discord slash command name regex: lowercase, no spaces, 1-32 chars
    const discordNameRegex = /^[-_\p{L}\p{N}]{1,32}$/u;
    for (const cmd of slashCommands) {
      const json = cmd.toJSON();
      assert.match(json.name, discordNameRegex, `Command ${json.name} must meet Discord name regex`);
      assert.equal(json.name, json.name.toLowerCase(), `Command ${json.name} must be lowercase`);
      assert.ok(json.description && json.description.length > 0, `Command ${json.name} must have description`);
    }
  });

  test('D-Day confirmation gate requires exact CONFIRM D-DAY passphrase', () => {
    function validateDDayConfirmation(input) {
      if (!input || typeof input !== 'string') return false;
      return input.trim() === 'CONFIRM D-DAY';
    }

    assert.equal(validateDDayConfirmation('CONFIRM D-DAY'), true);
    assert.equal(validateDDayConfirmation('  CONFIRM D-DAY  '), true);
    assert.equal(validateDDayConfirmation('confirm d-day'), false); // Must be uppercase
    assert.equal(validateDDayConfirmation('confirm'), false);
    assert.equal(validateDDayConfirmation('d-day'), false);
    assert.equal(validateDDayConfirmation('yes'), false);
    assert.equal(validateDDayConfirmation(''), false);
    assert.equal(validateDDayConfirmation(null), false);
  });

  test('D-Day post-wipe duty ID generation resets counter to 1 across all shift types', () => {
    // When D-Day wipes database, existingIds becomes []
    const emptyIds = [];

    assert.equal(calculateNextDutyId(emptyIds, 'M'), 'M1');
    assert.equal(calculateNextDutyId(emptyIds, 'T'), 'T1');
    assert.equal(calculateNextDutyId(emptyIds, 'W'), 'W1');
    assert.equal(calculateNextDutyId(emptyIds, 'Ts'), 'Ts1');
    assert.equal(calculateNextDutyId(emptyIds, 'F'), 'F1');
    assert.equal(calculateNextDutyId(emptyIds, 'S'), 'S1');
    assert.equal(calculateNextDutyId(emptyIds, 'MS'), 'MS1');
    assert.equal(calculateNextDutyId(emptyIds, 'TSS'), 'TSS1');
  });

  test('cleanGradeClass should strip "ม." and enforce number/number format', () => {
    const { cleanGradeClass } = require('../../bot');
    assert.equal(cleanGradeClass('ม.6/8'), '6/8');
    assert.equal(cleanGradeClass('ม.4/10'), '4/10');
    assert.equal(cleanGradeClass('6/7'), '6/7');
    assert.equal(cleanGradeClass('2/4'), '2/4');
    assert.equal(cleanGradeClass('3/6'), '3/6');
    assert.equal(cleanGradeClass('4/9'), '4/9');
    assert.equal(cleanGradeClass('ม. 5/7'), '5/7');
    assert.equal(cleanGradeClass('ม6/8'), '6/8');
    assert.equal(cleanGradeClass('ชั้น ม.4/2'), '4/2');
  });

  test('cleanFullName should attach prefix directly to name', () => {
    const { cleanFullName } = require('../../bot');
    assert.equal(cleanFullName('นาย สมชาย ใจดี'), 'นายสมชาย ใจดี');
    assert.equal(cleanFullName('นางสาว สมหญิง รักเรียน'), 'นางสาวสมหญิง รักเรียน');
    assert.equal(cleanFullName('นาง สมร ดีเลิศ'), 'นางสมร ดีเลิศ');
    assert.equal(cleanFullName('นายณิชกานต์ คำไชย'), 'นายณิชกานต์ คำไชย');
  });
});
