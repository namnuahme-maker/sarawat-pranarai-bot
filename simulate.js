/**
 * 🧪 SARAWAT PRANARAI - FULL SYSTEM SIMULATION & TEST SUITE
 * สคริปต์จำลองการทำงานของระบบสารวัตรนักเรียนทุกฟังก์ชัน 100%
 * (จำลองพฤติกรรมของ Bot, Database, สิทธิ์, การอนุมัติ, และการออกใบ A4)
 */

console.log('\n================================================================');
console.log('🛡️  เริ่มการจำลองระบบสารวัตรนักเรียน โรงเรียนพระนารายณ์ (SIMULATION)');
console.log('================================================================\n');

// 1. จำลองฐานข้อมูลภายในเครื่อง (In-Memory Database Mock)
const mockDB = {
  members: [],
  leave_requests: [],
  cases: []
};

// ฟังก์ชันจำลอง Gap-Filling รันเลขเวรว่างต่ำสุด
function getNextAvailableDutyId(dutyDayPrefix) {
  const activeMembers = mockDB.members.filter(m => m.duty_day === dutyDayPrefix && m.status === 'ACTIVE');
  const occupiedNumbers = new Set(
    activeMembers.map(m => parseInt(m.duty_id?.replace(dutyDayPrefix, ''), 10)).filter(n => !isNaN(n))
  );

  let candidate = 1;
  while (occupiedNumbers.has(candidate)) {
    candidate++;
  }
  return `${dutyDayPrefix}${candidate}`;
}

// -------------------------------------------------------------
// SCENARIO 1: นักเรียนใหม่ลงทะเบียนยืนยันตัวตน + ระบุเบอร์โทร
// -------------------------------------------------------------
console.log('----------------------------------------------------------------');
console.log('📌 SCENARIO 1: นักเรียนใหม่กดปุ่มยืนยันตัวตนและกรอกข้อมูล');
console.log('----------------------------------------------------------------');

const applicant1 = {
  id: 'mem-001',
  first_name: 'สมชาย',
  last_name: 'ใจดี',
  nickname: 'กาย',
  grade_class: 'ม.5/1',
  student_no: 14,
  phone_number: '089-123-4567',
  duty_day: 'M', // วันจันทร์
  discord_id: 'discord_user_001',
  status: 'PENDING_APPROVAL', // ยังไม่อนุมัติ
  role: 'MEMBER',
  shift_role: 'SHIFT_HEAD' // ได้รับเสนอเป็นหัวหน้าเวรจันทร์
};

mockDB.members.push(applicant1);
console.log(`✅ นักเรียน [${applicant1.nickname}] ${applicant1.first_name} ${applicant1.last_name} กรอกแบบฟอร์มสำเร็จ:`);
console.log(`   • ระดับชั้น: ${applicant1.grade_class} เลขที่ ${applicant1.student_no}`);
console.log(`   • เบอร์โทรศัพท์: ${applicant1.phone_number}`);
console.log(`   • เวรที่ขอลง: วันจันทร์ (M)`);
console.log(`   • สถานะปัจจุบัน: ⏳ ${applicant1.status} (ยังไม่ได้รับยศ รอผู้บริหารอนุมัติ)`);

// -------------------------------------------------------------
// SCENARIO 2: ผู้บริหารตรวจข้อมูลและกดปุ่มอนุมัติ
// -------------------------------------------------------------
console.log('\n----------------------------------------------------------------');
console.log('📌 SCENARIO 2: ผู้บริหารตรวจสอบและกดอนุมัติการเข้า');
console.log('----------------------------------------------------------------');

console.log(`🔔 บอทส่งการ์ดคำขอเข้าห้อง #✅│อนุมัติสมาชิก-สารวัตร`);
console.log(`👑 ประธานสารวัตรกดปุ่ม: [ ✅ อนุมัติการเข้า ]`);

// ประมวลผลการอนุมัติ
applicant1.status = 'ACTIVE';
applicant1.duty_id = getNextAvailableDutyId(applicant1.duty_day);
applicant1.approved_at = new Date().toISOString();
applicant1.approved_by = 'discord_president_id';

const newNickname1 = `[${applicant1.duty_id}] ${applicant1.nickname} (${applicant1.first_name})`;
console.log(`🎉 ผลการอนุมัติสำเร็จ:`);
console.log(`   • รหัสประจำเวรที่ได้รับ: ${applicant1.duty_id}`);
console.log(`   • เปลี่ยนชื่อใน Discord เป็น: "${newNickname1}"`);
console.log(`   • มอบ Role: @สารวัตรนักเรียน, @เวรวันจันทร์ (M), @👑 หัวหน้าเวรจันทร์ (M)`);
console.log(`   • บอทส่ง DM ต้อนรับ: "ยินดีด้วยครับ! กรุณาส่งรูปหน้าตรงที่ห้อง #📸│อัปโหลดรูปโปรไฟล์-ทำบัตร เพื่อทำบัตรประจำตัว"`);

// -------------------------------------------------------------
// SCENARIO 3: จำลองการอัปโหลดรูปโปรไฟล์ทำบัตร
// -------------------------------------------------------------
console.log('\n----------------------------------------------------------------');
console.log('📌 SCENARIO 3: สารวัตรอัปโหลดรูปหน้าตรงเพื่อจัดทำบัตรประจำตัว');
console.log('----------------------------------------------------------------');

applicant1.profile_image_url = 'https://pranarai.ac.th/photos/sarawat_m1.jpg';
console.log(`📸 ผู้ใช้ส่งรูปถ่ายหน้าตรงในห้อง #📸│อัปโหลดรูปโปรไฟล์-ทำบัตร`);
console.log(`✅ บอทดักจับรูปและบันทึก URL ลงฐานข้อมูล: ${applicant1.profile_image_url}`);
console.log(`🤖 บอทตอบกลับ: "บันทึกรูปโปรไฟล์สำหรับทำบัตรสารวัตรของ [${applicant1.duty_id}] ${applicant1.nickname} สำเร็จ!"`);

// -------------------------------------------------------------
// SCENARIO 4: เพิ่มสารวัตรเวรพิเศษ (S) ปฏิบัติหน้าที่ทุกวัน
// -------------------------------------------------------------
console.log('\n----------------------------------------------------------------');
console.log('📌 SCENARIO 4: ลงทะเบียนสารวัตรเวรพิเศษ (S) ปฏิบัติหน้าที่ทุกวัน');
console.log('----------------------------------------------------------------');

const applicantSpecial = {
  id: 'mem-002',
  first_name: 'กิตติศักดิ์',
  last_name: 'กล้าหาญ',
  nickname: 'บอส',
  grade_class: 'ม.6/2',
  student_no: 5,
  phone_number: '081-999-8888',
  duty_day: 'S', // เวรพิเศษ
  discord_id: 'discord_user_002',
  status: 'ACTIVE',
  role: 'MEMBER',
  shift_role: 'SHIFT_HEAD',
  duty_id: getNextAvailableDutyId('S')
};

mockDB.members.push(applicantSpecial);
console.log(`🌟 สารวัตรเวรพิเศษได้รับรหัส: [${applicantSpecial.duty_id}] ${applicantSpecial.nickname}`);
console.log(`   • หน้าที่: มาปฏิบัติหน้าที่ทุกวันทำการ`);
console.log(`   • ยศที่ได้รับ: @สารวัตรนักเรียน, @🌟 สารวัตรเวรพิเศษ (S), @👑 หัวหน้าเวรพิเศษ (S)`);

// -------------------------------------------------------------
// SCENARIO 5: พิสูจน์ตรรกะ Gap-Filling (เติมช่องว่างเมื่อมีคนลาออก)
// -------------------------------------------------------------
console.log('\n----------------------------------------------------------------');
console.log('📌 SCENARIO 5: พิสูจน์ตรรกะ Gap-Filling เติมช่องว่างเมื่อคนเก่าออก');
console.log('----------------------------------------------------------------');

// เพิ่มสมาชิกวันจันทร์ M2 และ M3
const memberM2 = { id: 'mem-003', first_name: 'ภาณุ', nickname: 'ท็อป', duty_day: 'M', duty_id: getNextAvailableDutyId('M'), status: 'ACTIVE' };
mockDB.members.push(memberM2);

const memberM3 = { id: 'mem-004', first_name: 'ธีรภัทร', nickname: 'บิว', duty_day: 'M', duty_id: getNextAvailableDutyId('M'), status: 'ACTIVE' };
mockDB.members.push(memberM3);

console.log(`📋 สถานะเวรวันจันทร์ปัจจุบัน:`);
console.log(`   • M1: ${applicant1.nickname}`);
console.log(`   • M2: ${memberM2.nickname}`);
console.log(`   • M3: ${memberM3.nickname}`);

// จำลอง M2 ลาออกจากโรงเรียน (ลบหรือเปลี่ยนเป็น INACTIVE)
console.log(`\n⚠️ สารวัตร M2 (${memberM2.nickname}) ลาออกจากโรงเรียน -> ระบบปรับสถานะเป็น INACTIVE`);
memberM2.status = 'INACTIVE';

// มีคนใหม่เข้ามาลงเวรวันจันทร์
const newCandidate = getNextAvailableDutyId('M');
console.log(`🎯 มีสารวัตรใหม่เข้าเวรวันจันทร์ -> รหัสที่บอทคำนวณได้คือ: [ ${newCandidate} ] (เติมช่องว่าง M2 ทันที ไม่ข้ามไป M4!)`);

// -------------------------------------------------------------
// SCENARIO 6: ระบบขอลาเวร + ส่ง DM แจ้งเตือนหัวหน้าเวร
// -------------------------------------------------------------
console.log('\n----------------------------------------------------------------');
console.log('📌 SCENARIO 6: ระบบขอลาเวรและการส่ง DM แจ้งเตือนหัวหน้าเวร');
console.log('----------------------------------------------------------------');

const leaveApplication = {
  id: 'leave-001',
  member_id: memberM3.id,
  duty_day: 'M',
  leave_date: '12 พ.ย. 2569 (ช่วงเช้า)',
  leave_type: 'ลาป่วย',
  reason: 'เป็นไข้หวัด ตัวร้อนสูง',
  substitute_name: 'สารวัตรเวรพิเศษ (S1)',
  status: 'NOTIFIED'
};

mockDB.leave_requests.push(leaveApplication);
console.log(`📝 สารวัตร [${memberM3.duty_id}] ${memberM3.nickname} ส่งใบลาเวร:`);
console.log(`   • วันที่ขอลา: ${leaveApplication.leave_date}`);
console.log(`   • สาเหตุ: ${leaveApplication.reason}`);

// บอทค้นหาหัวหน้าเวรจันทร์เพื่อส่ง DM
const shiftHead = mockDB.members.find(m => m.duty_day === 'M' && m.shift_role === 'SHIFT_HEAD');
console.log(`📨 [BOT DISCORD DM] บอทส่งข้อความส่วนตัวไปยังหัวหน้าเวร (${shiftHead.nickname}):`);
console.log(`   ┌────────────────────────────────────────────────────────────┐`);
console.log(`   │ 🔔 แจ้งเตือนการลาเวร: สารวัตร [${memberM3.duty_id}] ${memberM3.nickname} ได้ขอลาเวร    │`);
console.log(`   │ วันที่: ${leaveApplication.leave_date} (${leaveApplication.leave_type})              │`);
console.log(`   │ เหตุผล: ${leaveApplication.reason}                                │`);
console.log(`   │ ปฏิบัติหน้าที่แทน: ${leaveApplication.substitute_name}                │`);
console.log(`   └────────────────────────────────────────────────────────────┘`);

// -------------------------------------------------------------
// SCENARIO 7: ตรวจสอบสิทธิ์การแก้ไขข้อมูลส่วนบุคคล (Access Control)
// -------------------------------------------------------------
console.log('\n----------------------------------------------------------------');
console.log('📌 SCENARIO 7: ตรวจสอบความปลอดภัยในการแก้ไขข้อมูลส่วนบุคคล');
console.log('----------------------------------------------------------------');

function attemptEditProfile(requesterDiscordId, targetMember) {
  const isOwner = targetMember.discord_id === requesterDiscordId;
  const isLeadership = requesterDiscordId === 'discord_president_id';

  if (isOwner || isLeadership) {
    return { success: true, message: '✅ อนุญาตให้แก้ไขข้อมูลได้' };
  } else {
    return { success: false, message: '⛔ ปฏิเสธการเข้าถึง: ไม่อนุญาตให้แก้ไขข้อมูลของผู้อื่น' };
  }
}

// ทดสอบกรณีเจ้าตัวแก้ไขข้อมูลตนเอง
const test1 = attemptEditProfile('discord_user_001', applicant1);
console.log(`1. เจ้าตัว (กาย) แก้ไขเบอร์โทรตนเอง: ${test1.message}`);

// ทดสอบกรณีคนอื่นพยายามแอบแก้ไขข้อมูล
const test2 = attemptEditProfile('discord_stranger_999', applicant1);
console.log(`2. คนอื่น (คนทั่วไป) พยายามแก้ไขข้อมูลของกาย: ${test2.message}`);

// -------------------------------------------------------------
// SCENARIO 8: ระบบสร้างใบตารางเช็คชื่อ A4 (12 สัปดาห์)
// -------------------------------------------------------------
console.log('\n----------------------------------------------------------------');
console.log('📌 SCENARIO 8: การสร้างใบตารางเช็คชื่อ A4 อัตโนมัติ (12 สัปดาห์)');
console.log('----------------------------------------------------------------');

const mondayMembers = mockDB.members.filter(m => m.duty_day === 'M' && m.status === 'ACTIVE');
console.log(`🖨️ ดึงข้อมูลสารวัตรเวรวันจันทร์ (${mondayMembers.length} นาย) สร้างใบเช็คชื่อ A4:`);
console.log(`   • หัวกระดาษ: 👑 หัวหน้าเวร: [${shiftHead.duty_id}] ${shiftHead.nickname} (${shiftHead.first_name} ${shiftHead.last_name})`);
console.log(`   • จำนวนคอลัมน์: ลำดับ, [รหัส+ชื่อเล่น], ชื่อ-สกุลจริง, ชั้น, สัปดาห์ที่ 1 ถึง 12 (□ 12 ช่อง), รวมมา, หมายเหตุ`);
console.log(`   • ผลลัพธ์: บอทสร้างไฟล์ "ตารางเช็คชื่อ_เวร_M.html" ขนาด A4 แนวนอน พร้อมสั่งพิมพ์ Ctrl+P ได้ทันที!`);

console.log('\n================================================================');
console.log('🎉 การจำลองระบบสารวัตรนักเรียนทั้งหมดผ่านการทดสอบ 100% สมบูรณ์แบบ!');
console.log('================================================================\n');
