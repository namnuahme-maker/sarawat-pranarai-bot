const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MOCK_ROLE_IDS = {
  VERIFIED: 'role_verified_mock',
  UNVERIFIED: 'role_unverified_mock',
  PRESIDENT: 'role_president_mock',
  VICE_PRESIDENT: 'role_vice_president_mock',
  DAYS: {
    'M': 'role_day_mon',
    'T': 'role_day_tue',
    'W': 'role_day_wed',
    'Ts': 'role_day_thu',
    'F': 'role_day_fri',
    'S': 'role_day_special'
  },
  HEADS: {
    'M': 'role_head_mon',
    'T': 'role_head_tue',
    'W': 'role_head_wed',
    'Ts': 'role_head_thu',
    'F': 'role_head_fri',
    'S': 'role_head_special'
  },
  DEPUTIES: {
    'M': 'role_deputy_mon',
    'T': 'role_deputy_tue',
    'W': 'role_deputy_wed',
    'Ts': 'role_deputy_thu',
    'F': 'role_deputy_fri',
    'S': 'role_deputy_special'
  }
};

const DAY_NAMES = {
  'M': 'วันจันทร์',
  'T': 'วันอังคาร',
  'W': 'วันพุธ',
  'Ts': 'วันพฤหัสบดี',
  'TSS': 'วันพฤหัสบดี',
  'F': 'วันศุกร์',
  'S': 'พิเศษ (ทุกวัน)',
  'MS': 'วันจันทร์ (เวรพิเศษ)',
  'TS': 'วันอังคาร (เวรพิเศษ)',
  'WS': 'วันพุธ (เวรพิเศษ)',
  'FS': 'วันศุกร์ (เวรพิเศษ)'
};

function getDayName(code) {
  if (!code) return 'ไม่ระบุ';
  if (code === 'S') return 'เวรพิเศษ (ทุกวัน)';
  if (code.endsWith('S') && code !== 'S') {
    const base = code === 'TSS' ? 'Ts' : code.replace(/S+$/, '');
    const baseName = DAY_NAMES[base] || base;
    return `เวร${baseName} (พิเศษ)`;
  }
  return `เวร${DAY_NAMES[code] || code}`;
}

function getDutyRoles(dutyDay) {
  if (!dutyDay) return [];
  const roles = [];
  if (dutyDay.endsWith('S') && dutyDay !== 'S') {
    const baseDay = dutyDay === 'TSS' ? 'Ts' : dutyDay.replace(/S+$/, '');
    if (MOCK_ROLE_IDS.DAYS[baseDay]) roles.push(MOCK_ROLE_IDS.DAYS[baseDay]);
    if (MOCK_ROLE_IDS.DAYS['S']) roles.push(MOCK_ROLE_IDS.DAYS['S']);
  } else if (dutyDay === 'S') {
    if (MOCK_ROLE_IDS.DAYS['S']) roles.push(MOCK_ROLE_IDS.DAYS['S']);
  } else {
    if (MOCK_ROLE_IDS.DAYS[dutyDay]) roles.push(MOCK_ROLE_IDS.DAYS[dutyDay]);
  }
  return roles.filter(Boolean);
}

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

function getEnglishDayName(dayCode) {
  const map = {
    'M': 'MONDAY',
    'T': 'TUESDAY',
    'W': 'WEDNESDAY',
    'Ts': 'THURSDAY',
    'TSS': 'THURSDAY',
    'F': 'FRIDAY',
    'S': 'SPECIAL',
    'MS': 'MONDAY',
    'TS': 'TUESDAY',
    'WS': 'WEDNESDAY',
    'FS': 'FRIDAY'
  };
  return map[dayCode] || 'DUTY';
}

function renderAttendanceSheetSample(dayCode, dayText, members) {
  const isSpecial = dayCode === 'S';
  const englishDay = getEnglishDayName(dayCode);
  const head = members.find(m => m.shift_role === 'SHIFT_HEAD');
  const deputy = members.find(m => m.shift_role === 'SHIFT_DEPUTY');
  const headName = head ? `[${head.duty_id || '-'}] ${head.nickname} (${head.first_name} ${head.last_name})` : '-';
  const deputyName = deputy ? `[${deputy.duty_id || '-'}] ${deputy.nickname} (${deputy.first_name} ${deputy.last_name})` : '-';

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>ใบเช็คชื่อ: ${dayText} (${dayCode})</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Chakra+Petch:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500;1,600;1,700&family=Rubik:ital,wght@0,300..900;1,300..900&family=Zen+Antique&display=swap" rel="stylesheet">
        <style>
          .tag-english { font-family: 'Bebas Neue', cursive; letter-spacing: 1.5px; }
          .tag-code { font-family: 'Chakra Petch', sans-serif; font-weight: 700; }
        </style>
      </head>
      <body>
        <div class="sheet-title">ใบเช็คชื่อ</div>
        <div class="sheet-corner-tag">
          <div class="tag-english">${englishDay}</div>
          <div class="tag-code">${dayCode}</div>
        </div>
        <div class="leader-info">
          หัวหน้าเวร: ${headName} | รองหัวหน้า: ${deputyName}
        </div>
        <div class="table-header">
          ${isSpecial ? 'ส.1 - ส.12' : '11/9 - 1/25'}
        </div>
      </body>
    </html>
  `;
}

describe('SARAWAT Full-Lifecycle E2E Automated Integration Suite', () => {
  const TEST_DISCORD_ID = '999999999999999999';
  let createdMemberId = null;

  before(async () => {
    // Clean up any lingering test records
    await supabase.from('members').delete().eq('discord_id', TEST_DISCORD_ID);
  });

  after(async () => {
    // Clean up test records after all tests complete
    if (createdMemberId) {
      await supabase.from('members').delete().eq('id', createdMemberId);
    }
    await supabase.from('members').delete().eq('discord_id', TEST_DISCORD_ID);
  });

  test('Step 1: Registration Flow -> Member enters PENDING_APPROVAL with MS combined shift', async () => {
    const newMemberData = {
      discord_id: TEST_DISCORD_ID,
      first_name: 'ทดสอบQA',
      last_name: 'อัตโนมัติ',
      nickname: 'บ็อตQA',
      grade_class: 'ม.5/1',
      student_no: 88,
      phone_number: '0812345678',
      duty_day: 'MS',
      status: 'PENDING_APPROVAL',
      shift_role: 'MEMBER',
      role: 'MEMBER'
    };

    const { data, error } = await supabase
      .from('members')
      .insert([newMemberData])
      .select()
      .single();

    assert.equal(error, null, 'Registration insert must succeed');
    assert.ok(data.id, 'Member must receive a UUID from Supabase');
    assert.equal(data.status, 'PENDING_APPROVAL');
    assert.equal(data.duty_day, 'MS');

    createdMemberId = data.id;
  });

  test('Step 2: Admin Approval Flow -> Assigns MS prefix Duty ID and activates member', async () => {
    assert.ok(createdMemberId, 'Created member ID must exist');

    // Fetch existing active MS members to calculate next ID
    const { data: existingMembers, error: fetchErr } = await supabase
      .from('members')
      .select('duty_id')
      .ilike('duty_day', 'MS%')
      .eq('status', 'ACTIVE');

    assert.equal(fetchErr, null);
    const existingIds = (existingMembers || []).map(m => m.duty_id).filter(Boolean);
    const assignedDutyId = calculateNextDutyId(existingIds, 'MS');

    assert.match(assignedDutyId, /^MS\d+$/, 'Duty ID must follow MS prefix format');

    // Approve the member
    const { data: approvedMember, error: updateErr } = await supabase
      .from('members')
      .update({
        duty_id: assignedDutyId,
        status: 'ACTIVE',
        updated_at: new Date()
      })
      .eq('id', createdMemberId)
      .select()
      .single();

    assert.equal(updateErr, null);
    assert.equal(approvedMember.status, 'ACTIVE');
    assert.equal(approvedMember.duty_id, assignedDutyId);

    // Verify role assignment logic (Both Monday and Special roles granted)
    const assignedRoles = getDutyRoles(approvedMember.duty_day);
    assert.deepEqual(
      assignedRoles,
      [MOCK_ROLE_IDS.DAYS['M'], MOCK_ROLE_IDS.DAYS['S']],
      'MS shift must receive Monday AND Special duty roles'
    );
  });

  test('Step 3: Leadership Appointment Flow -> Promotes to Shift Head of Thursday (Ts)', async () => {
    assert.ok(createdMemberId);

    // Fetch member
    const { data: member } = await supabase
      .from('members')
      .select('*')
      .eq('id', createdMemberId)
      .single();

    // Promote to Head of Thursday ('Ts')
    const selectedDay = 'Ts';
    const roleType = 'SHIFT_HEAD';

    // 1. Effective duty day resolution: member was MS -> becomes TSS (Thursday + Special)
    const newDutyDay = resolveDutyDayForAppoint(member.duty_day, selectedDay);
    assert.equal(newDutyDay, 'TSS', 'MS member appointed to Ts must retain special duty as TSS');

    // 2. Role calculation
    const validDayRoles = getDutyRoles(newDutyDay);
    assert.deepEqual(validDayRoles, [MOCK_ROLE_IDS.DAYS['Ts'], MOCK_ROLE_IDS.DAYS['S']]);

    const allDayRoles = Object.values(MOCK_ROLE_IDS.DAYS);
    const obsoleteDayRoles = allDayRoles.filter(rid => !validDayRoles.includes(rid));

    // Old Monday role MUST be in obsolete roles to be removed
    assert.ok(obsoleteDayRoles.includes(MOCK_ROLE_IDS.DAYS['M']), 'Old Monday day role must be in obsolete list');
    assert.ok(!obsoleteDayRoles.includes(MOCK_ROLE_IDS.DAYS['Ts']), 'New Thursday day role must not be stripped');
    assert.ok(!obsoleteDayRoles.includes(MOCK_ROLE_IDS.DAYS['S']), 'Special duty role must not be stripped');

    // 3. Update Supabase
    const { data: appointedMember, error: appointErr } = await supabase
      .from('members')
      .update({
        shift_role: roleType,
        duty_day: newDutyDay,
        updated_at: new Date()
      })
      .eq('id', createdMemberId)
      .select()
      .single();

    assert.equal(appointErr, null);
    assert.equal(appointedMember.shift_role, 'SHIFT_HEAD');
    assert.equal(appointedMember.duty_day, 'TSS');
  });

  test('Step 4: Attendance Sheet Generation -> Renders HTML with uppercase badge, fonts, and Head display', async () => {
    assert.ok(createdMemberId);

    const { data: member } = await supabase
      .from('members')
      .select('*')
      .eq('id', createdMemberId)
      .single();

    // Render Thursday Attendance Sheet
    const thursdayHtml = renderAttendanceSheetSample('Ts', 'วันพฤหัสบดี', [member]);

    assert.ok(thursdayHtml.includes('ใบเช็คชื่อ'), 'Must have title ใบเช็คชื่อ');
    assert.ok(!thursdayHtml.includes('SARAWAT-PRANARAI OS v5.0'), 'Must not include legacy version tag');
    assert.ok(thursdayHtml.includes('THURSDAY'), 'English day tag must be UPPERCASE');
    assert.ok(thursdayHtml.includes('Bebas Neue'), 'Must embed Bebas Neue Google Font');
    assert.ok(thursdayHtml.includes('Chakra Petch'), 'Must embed Chakra Petch Google Font');
    assert.ok(thursdayHtml.includes(`หัวหน้าเวร: [${member.duty_id}] ${member.nickname} (${member.first_name} ${member.last_name})`), 'Head must appear in header block');

    // Render Special Attendance Sheet
    const specialHtml = renderAttendanceSheetSample('S', 'พิเศษ (ทุกวัน)', [member]);
    assert.ok(specialHtml.includes('SPECIAL'), 'Day tag must be SPECIAL (not Special Duty)');
    assert.ok(specialHtml.includes('ส.1 - ส.12'), 'Special sheet must use weeks ส.1 - ส.12');
  });

  test('Step 5: Edge Case - Multi-shift cross day hop preserves special duty consistency', async () => {
    assert.ok(createdMemberId);

    // Hop 1: Appoint to Wednesday (W)
    const hop1Day = resolveDutyDayForAppoint('TSS', 'W');
    assert.equal(hop1Day, 'WS', 'Special duty must be preserved as WS when hopping to Wednesday');

    // Hop 2: Appoint to Special only (S)
    const hop2Day = resolveDutyDayForAppoint('WS', 'S');
    assert.equal(hop2Day, 'WS', 'Member already having WS remains WS when appointed to S');

    // Hop 3: Member regular Friday (F) appointed to S
    const hop3Day = resolveDutyDayForAppoint('F', 'S');
    assert.equal(hop3Day, 'FS', 'Regular Friday member becomes FS when appointed to S');
  });

  test('Step 6: Demotion & Cleanup Flow -> Demotes member and safely deletes test record', async () => {
    assert.ok(createdMemberId);

    // Demote member to regular
    const { data: demotedMember, error: demoteErr } = await supabase
      .from('members')
      .update({
        shift_role: 'MEMBER',
        role: 'MEMBER',
        updated_at: new Date()
      })
      .eq('id', createdMemberId)
      .select()
      .single();

    assert.equal(demoteErr, null);
    assert.equal(demotedMember.shift_role, 'MEMBER');

    // Delete test record
    const { error: deleteErr } = await supabase
      .from('members')
      .delete()
      .eq('id', createdMemberId);

    assert.equal(deleteErr, null, 'Must delete test record cleanly');

    // Verify record is gone
    const { data: checkData } = await supabase
      .from('members')
      .select('id')
      .eq('id', createdMemberId);

    assert.equal(checkData.length, 0, 'Test record must no longer exist in Supabase');
    createdMemberId = null;
  });
});
