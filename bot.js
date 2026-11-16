/**
 * 🛡️ SARAWAT PRANARAI DISCORD BOT (VERSION 4.2)
 * ระบบบอทสารวัตรนักเรียน โรงเรียนพระนารายณ์
 * 
 * ฟีเจอร์หลัก:
 * 1. ยืนยันตัวตน + บันทึกเบอร์โทร + เวรประจำวัน (M, T, W, Ts, F) และ เวรพิเศษ (S) ปฏิบัติหน้าที่ทุกวัน
 * 2. ยศหัวหน้าเวรและรองหัวหน้าเวรแยกตามวันโดยเฉพาะ (เช่น 👑 หัวหน้าเวร S, ✨ รองหัวหน้าเวร F)
 * 3. ระบบใบตารางเช็คชื่อ A4 ดึงชื่อและรหัสของ "หัวหน้าเวร" และ "รองหัวหน้าเวร" มาแสดงบนหัวกระดาษอัตโนมัติ
 * 4. ระบบอนุมัติสมาชิกโดยผู้บริหารก่อนเข้า + ขอรูปถ่ายหน้าตรงเพื่อทำบัตรประจำตัว
 * 5. ระบบขอลาเวร + ส่ง DM แจ้งเตือนหัวหน้าเวรและรองหัวหน้าเวร
 * 6. แดชบอร์ดตรวจสอบสมาชิก (Member Inspector) พร้อมสิทธิ์แก้ไขข้อมูลเฉพาะเจ้าตัว/ผู้บริหาร
 */

process.noDeprecation = true; // ซ่อนข้อความแจ้งเตือนที่ไม่จำเป็น ให้ Terminal สะอาดตา (Clean Minimal)

const { 
  Client, 
  GatewayIntentBits, 
  Events,
  ActivityType,
  ChannelType,
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  StringSelectMenuBuilder, 
  UserSelectMenuBuilder, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle, 
  EmbedBuilder, 
  AttachmentBuilder, 
  PermissionsBitField,
  MessageFlags,
  SlashCommandBuilder
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
require('dotenv').config();
const QRCode = require('qrcode');
const { generateCardHTML } = require('./card_template');
const { processAttendancePhoto, buildAttendanceDiscordCard } = require('./attendance_manager');
const { uploadToGoogleDrive } = require('./services/gdrive_service');
const { initLogger, logError, logWarn } = require('./services/logger');

const PORT = process.env.PORT || 10000;

const SETTINGS_FILE = path.join(__dirname, 'settings.json');

/**
 * 📅 ตรวจจับไตรมาส ปีการศึกษา และภาคเรียนโดยอัตโนมัติตามปฏิทินจริง (เวลาไทย UTC+7)
 * - ไตรมาสที่ 1 (พ.ย. - ม.ค.): ภาคเรียนที่ 2 ช่วงแรก
 * - ไตรมาสที่ 2 (ก.พ. - เม.ย.): ภาคเรียนที่ 2 ช่วงปลาย
 * - ไตรมาสที่ 3 (พ.ค. - ก.ค.): ภาคเรียนที่ 1 ช่วงแรก
 * - ไตรมาสที่ 4 (ส.ค. - ต.ค.): ภาคเรียนที่ 1 ช่วงปลาย
 */
function getCurrentQuarterAndYear(d = new Date()) {
  const thaiDate = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const month = thaiDate.getMonth() + 1; // 1 - 12
  const ceYear = thaiDate.getFullYear(); // เช่น 2026

  let quarter = 1;
  let semester = 2;
  let academicYear = ceYear + 543;

  if (month >= 11 || month === 1) {
    quarter = 1;
    semester = 2;
    academicYear = month === 1 ? (ceYear - 1) + 543 : ceYear + 543;
  } else if (month >= 2 && month <= 4) {
    quarter = 2;
    semester = 2;
    academicYear = (ceYear - 1) + 543;
  } else if (month >= 5 && month <= 7) {
    quarter = 3;
    semester = 1;
    academicYear = ceYear + 543;
  } else {
    quarter = 4;
    semester = 1;
    academicYear = ceYear + 543;
  }

  const quarterMonths = {
    1: 'พ.ย. - ม.ค.',
    2: 'ก.พ. - เม.ย.',
    3: 'พ.ค. - ก.ค.',
    4: 'ส.ค. - ต.ค.'
  };

  return {
    quarter,
    semester,
    academicYear,
    buddhistYear: ceYear + 543,
    ceYear,
    quarterName: `ไตรมาสที่ ${quarter} (${quarterMonths[quarter]})`,
    semesterName: `ภาคเรียนที่ ${semester} ปีการศึกษา ${academicYear}`,
    fullLabel: `ภาคเรียนที่ ${semester} / ปีการศึกษา ${academicYear} • ประจำไตรมาสที่ ${quarter} (12 สัปดาห์)`
  };
}

function getSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    }
  } catch (e) {}
  const auto = getCurrentQuarterAndYear();
  return {
    mode: 'auto',
    academic_year: auto.academicYear,
    quarter: auto.quarter,
    current_semester: auto.semesterName
  };
}

function getAcademicPeriod() {
  const auto = getCurrentQuarterAndYear(new Date());
  const settings = getSettings();

  if (settings.mode === 'manual' && settings.academic_year && settings.quarter) {
    const q = parseInt(settings.quarter, 10) || auto.quarter;
    const y = parseInt(settings.academic_year, 10) || auto.academicYear;
    const sem = (q === 3 || q === 4) ? 1 : 2;
    const quarterMonths = { 1: 'พ.ย. - ม.ค.', 2: 'ก.พ. - เม.ย.', 3: 'พ.ค. - ก.ค.', 4: 'ส.ค. - ต.ค.' };
    return {
      quarter: q,
      semester: sem,
      academicYear: y,
      isAuto: false,
      quarterName: `ไตรมาสที่ ${q} (${quarterMonths[q] || ''})`,
      semesterName: settings.current_semester || `ภาคเรียนที่ ${sem} ปีการศึกษา ${y}`,
      fullLabel: `ภาคเรียนที่ ${sem} / ปีการศึกษา ${y} • ประจำไตรมาสที่ ${q} (12 สัปดาห์)`
    };
  }

  return {
    ...auto,
    isAuto: true
  };
}

function updateAcademicPeriod({ academicYear, quarter, semester, mode = 'manual' }, userId = null) {
  const settings = getSettings();
  if (mode === 'auto') {
    settings.mode = 'auto';
    delete settings.academic_year;
    delete settings.quarter;
    const auto = getCurrentQuarterAndYear(new Date());
    settings.current_semester = auto.semesterName;
  } else {
    settings.mode = 'manual';
    if (academicYear) settings.academic_year = parseInt(academicYear, 10);
    if (quarter) settings.quarter = parseInt(quarter, 10);
    if (semester) {
      settings.current_semester = semester;
    } else {
      const q = settings.quarter || 1;
      const semNum = (q === 3 || q === 4) ? 1 : 2;
      settings.current_semester = `ภาคเรียนที่ ${semNum} ปีการศึกษา ${settings.academic_year}`;
    }
  }
  settings.updated_by = userId;
  settings.updated_at = new Date().toISOString();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');

  // ซิงค์ไปยัง web/settings.json ด้วยถ้ามีโฟลเดอร์ web
  try {
    const webSettingsPath = path.join(__dirname, '..', 'web', 'settings.json');
    fs.writeFileSync(webSettingsPath, JSON.stringify(settings, null, 2), 'utf8');
  } catch (e) {}

  return getAcademicPeriod();
}

function updateSemester(semester, userId) {
  return updateAcademicPeriod({ semester, mode: 'manual' }, userId);
}

// ==========================================================
// 📄 TEMPORARY ATTENDANCE SHEET STORE (เปิดดู/พิมพ์ออนไลน์ชั่วคราว)
// ==========================================================
const tempAttendanceSheets = new Map(); // id -> { html, dayName, createdAt, expiresAt }

function storeTempAttendanceSheet(html, dayName) {
  const id = crypto.randomBytes(6).toString('hex');
  const ttl = 30 * 60 * 1000; // 30 นาที (ชั่วคราวแล้วลบออก)
  tempAttendanceSheets.set(id, {
    html,
    dayName,
    createdAt: Date.now(),
    expiresAt: Date.now() + ttl
  });
  return id;
}

// ทำความสะอาดเอกสารหมดอายุทุก 5 นาที
const cleanupSheetsTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, item] of tempAttendanceSheets.entries()) {
    if (now > item.expiresAt) {
      tempAttendanceSheets.delete(id);
    }
  }
}, 5 * 60 * 1000);
if (cleanupSheetsTimer.unref) cleanupSheetsTimer.unref();

// ==========================================================
// 📸 PENDING PHOTO UPLOADS & AI BACKGROUND REMOVAL
// ==========================================================
const pendingPhotoUploads = new Map(); // memberId -> { url, name, timestamp }
const pendingAttendanceUploads = new Map(); // userId -> { shift, dateStr, channelId, timestamp }
const pendingPhotoConfirmations = new Map(); // memberId -> { member, photoUrl, filename, userId, timestamp }
const activeServicePhotoSessions = new Map(); // userId -> { member, timestamp }
const pendingPromptMessages = new Map(); // memberId -> { channelId, messageId, timestamp }

function getUploadDir() {
  const dir1 = path.join(__dirname, '..', 'web', 'public', 'uploads');
  if (fs.existsSync(path.join(__dirname, '..', 'web'))) return dir1;
  const dir2 = path.join(__dirname, 'web', 'public', 'uploads');
  if (fs.existsSync(path.join(__dirname, 'web'))) return dir2;
  return path.join(__dirname, 'uploads');
}

// ==========================================================
// 🛡️ MEMBER INPUT SANITIZERS & VALIDATORS
// ==========================================================
function cleanGradeClass(input) {
  if (!input) return '';
  let s = String(input).trim();
  s = s.replace(/^(ชั้น\s*)?(ม\.|ม|M\.|M)?\s*/i, '');
  s = s.replace(/\s*\/\s*/, '/');
  s = s.replace(/\s+/g, '');
  const match = s.match(/([1-6])\/([0-9]+)/);
  if (match) {
    return `${match[1]}/${match[2]}`;
  }
  return s;
}

function cleanFullName(input) {
  if (!input) return '';
  let s = String(input).trim().replace(/\s+/g, ' ');
  // ติดคำนำหน้า (นาย, นางสาว, นาง, ด.ช., ด.ญ.) กับชื่อจริงทันที
  s = s.replace(/^(นาย|นางสาว|นาง|ด\.ช\.|ด\.ญ\.)\s+/i, (m, p1) => p1);
  return s;
}

function getBaseUrl() {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '');
  if (process.env.NODE_ENV === 'production') {
    return 'https://sarawat-pranarai-bot.onrender.com';
  }
  return `http://localhost:${PORT}`;
}

function getWebDashboardUrl() {
  if (process.env.WEB_URL) return process.env.WEB_URL.replace(/\/$/, '');
  if (process.env.RENDER_WEB_URL) return process.env.RENDER_WEB_URL.replace(/\/$/, '');
  if (process.env.NODE_ENV === 'production') {
    return 'https://sarawat-pranarai-web.onrender.com';
  }
  return 'http://localhost:10001';
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

initLogger({ client, supabase });

client.on('error', err => {
  logWarn('Discord Client Error', err);
});

process.on('unhandledRejection', reason => {
  logError('Unhandled Rejection', reason);
});

process.on('uncaughtException', err => {
  logError('Uncaught Exception', err);
});

const ROLE_IDS = {
  ADMIN: process.env.ROLE_ADMIN || '1567570796000000000',
  TEACHER: process.env.ROLE_TEACHER || '1567570795000000000',
  VERIFIED: process.env.ROLE_VERIFIED || '1567570844472053943',
  UNVERIFIED: process.env.ROLE_UNVERIFIED || '1567570858937946152',
  PRESIDENT: process.env.ROLE_PRESIDENT || '1567570798242439320',
  VICE_PRESIDENT: process.env.ROLE_VICE_PRESIDENT || '1567570800045727978',
  HEAD_S: process.env.ROLE_HEAD_S || '1567570801866047589',
  DEPUTY_S: process.env.ROLE_DEPUTY_S || '1567570803703423006',
  DAYS: {
    'M': process.env.ROLE_MON || '1567570846388854804',
    'T': process.env.ROLE_TUE || '1567570847726567526',
    'W': process.env.ROLE_WED || '1567570849953743049',
    'Ts': process.env.ROLE_THU || '1567570850935218449',
    'F': process.env.ROLE_FRI || '1567570856966758431',
    'S': process.env.ROLE_SPECIAL || '1567570841548627971'
  },
  HEADS: {
    'M': process.env.ROLE_HEAD_M || '1567570806412804126',
    'T': process.env.ROLE_HEAD_T || '1567570810439335946',
    'W': process.env.ROLE_HEAD_W || '1567570813878804511',
    'Ts': process.env.ROLE_HEAD_THU || '1567570829288542218',
    'F': process.env.ROLE_HEAD_F || '1567570837215649962',
    'S': process.env.ROLE_HEAD_S || '1567570801866047589'
  },
  DEPUTIES: {
    'M': process.env.ROLE_DEPUTY_M || '1567570808270758020',
    'T': process.env.ROLE_DEPUTY_T || '1567570812024786996',
    'W': process.env.ROLE_DEPUTY_W || '1567570815728353490',
    'Ts': process.env.ROLE_DEPUTY_THU || '1567570831851126804',
    'F': process.env.ROLE_DEPUTY_F || '1567570839925293178',
    'S': process.env.ROLE_DEPUTY_S || '1567570803703423006'
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

/**
 * 🔒 สร้าง Rich Embed สำหรับแสดงข้อมูลผู้สมัครแบบส่วนตัว (Ephemeral) พร้อม 2 ปุ่มหลัก: ยืนยันข้อมูล และ แก้ไขข้อมูล
 */
function buildPrivateReviewCard(member) {
  const isSpecial = member.duty_day && member.duty_day.endsWith('S');
  const weekday = member.duty_day ? (member.duty_day === 'TSS' ? 'Ts' : member.duty_day.replace(/S+$/, '') || member.duty_day) : 'M';
  const weekdayName = DAY_NAMES[weekday] || weekday;
  const shiftLabel = getShiftLabel(member.duty_day);

  const photoUrl = (member.profile_image_url && member.profile_image_url.startsWith('http'))
    ? member.profile_image_url
    : (member.profile_image_url ? `${getWebDashboardUrl()}${member.profile_image_url}` : null);

  const embed = new EmbedBuilder()
    .setTitle('🛡️ ตรวจสอบข้อมูลการลงทะเบียนสารวัตร [เฉพาะคุณที่มองเห็น]')
    .setDescription(
      `สวัสดีครับคุณ **${member.first_name} ${member.last_name} (${member.nickname || '-'})**\n` +
      `นี่คือข้อมูลส่วนตัวและรูปถ่ายขนาด 1 นิ้วสำหรับจัดทำบัตรประจำตัว 3D ของคุณ:\n\n` +
      `👉 **คำแนะนำ:**\n` +
      `• **หากข้อมูลและรูปถูกต้องแล้ว:** กด **"✅ ยืนยันข้อมูล & ส่งขออนุมัติ"**\n` +
      `• **หากต้องการแก้ไขชื่อ ชั้น เลขที่ เบอร์ หรือเปลี่ยนรูปใหม่:** กด **"✏️ แก้ไขข้อมูล"**`
    )
    .addFields(
      {
        name: '👤 ข้อมูลสารวัตร',
        value: `• ชื่อ-สกุล: **${member.first_name} ${member.last_name}**\n• ชื่อเล่น: **${member.nickname || '-'}**\n• ชั้น/ห้อง: **ม.${member.grade_class || '-'}** เลขที่ **#${member.student_no || '-'}**`,
        inline: true
      },
      {
        name: '🛡️ ข้อมูลการปฏิบัติหน้าที่',
        value: `• วันประจำการ: **วัน${weekdayName} (${weekday})**\n• ผลัดเวรสุทธิ: **${shiftLabel}** ${isSpecial ? '⭐' : ''}\n• เบอร์โทรศัพท์: \`${member.phone_number || '-'}\``,
        inline: true
      },
      {
        name: '⏳ สถานะปัจจุบัน',
        value: '📋 **พร้อมส่งขออนุมัติ (รอการตรวจสอบและกดยืนยันจากคุณ)**',
        inline: false
      }
    )
    .setColor('#3498DB')
    .setFooter({ text: 'ระบบลงทะเบียนสารวัตร • โรงเรียนพระนารายณ์ (ข้อความนี้เห็นเฉพาะคุณ)' })
    .setTimestamp();

  if (photoUrl) {
    embed.setImage(photoUrl);
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`btn_confirm_send_approval_${member.id}`)
      .setLabel('✅ ยืนยันข้อมูล & ส่งขออนุมัติ')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`btn_edit_registration_info_${member.id}`)
      .setLabel('✏️ แก้ไขข้อมูล')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embed, row };
}

/**
 * 🧹 ลบข้อความการ์ดยืนยันการลงทะเบียน / การ์ดรูปถ่ายในห้องลงทะเบียนโดยอัตโนมัติเมื่อได้รับการอนุมัติหรือปฏิเสธ
 * รองรับการดึง Channel & Message ID ผ่าน 3 ชั้น (Cache Map -> Embed Footer -> Supabase crop_tokens)
 * พร้อมระบบสแกนเก็บกวาดข้อความตกค้างของบอทเพื่อรักษาความสะอาดของห้อง 100%
 */
async function deleteRegistrationPromptMessage(memberId, interaction, memberData) {
  try {
    let targetChanId = null;
    let targetMsgId = null;

    // ชั้นที่ 1: ตรวจสอบจาก in-memory cache ก่อน
    if (pendingPromptMessages.has(memberId)) {
      const cached = pendingPromptMessages.get(memberId);
      targetChanId = cached.channelId;
      targetMsgId = cached.messageId;
      pendingPromptMessages.delete(memberId);
    }

    // ชั้นที่ 2: ดึงจาก Embed Footer ของการ์ดขออนุมัติที่ผู้บริหารกำลังกดปุ่ม
    if ((!targetChanId || !targetMsgId) && interaction?.message?.embeds?.[0]?.footer?.text) {
      const footerText = interaction.message.embeds[0].footer.text;
      const match = footerText.match(/\[msg:(\d+):(\d+)\]/);
      if (match) {
        targetChanId = match[1];
        targetMsgId = match[2];
      }
    }

    // ชั้นที่ 3: Fallback ค้นหาจาก Supabase crop_tokens
    if (!targetChanId || !targetMsgId) {
      try {
        const { data: tokenRow } = await supabase
          .from('crop_tokens')
          .select('source_image_url')
          .eq('token', `prompt_msg_${memberId}`)
          .maybeSingle();

        if (tokenRow?.source_image_url) {
          const match = tokenRow.source_image_url.match(/discord_prompt:(\d+):(\d+)/);
          if (match) {
            targetChanId = match[1];
            targetMsgId = match[2];
          }
        }

        if (!targetChanId || !targetMsgId) {
          const { data: normalTokens } = await supabase
            .from('crop_tokens')
            .select('source_image_url')
            .eq('member_id', memberId)
            .order('created_at', { ascending: false })
            .limit(1);

          if (normalTokens?.[0]?.source_image_url) {
            const matchMeta = normalTokens[0].source_image_url.match(/#discord_meta:(\d+):(\d+)/);
            if (matchMeta) {
              targetChanId = matchMeta[1];
              targetMsgId = matchMeta[2];
            }
          }
        }
      } catch (dbErr) {
        console.warn('[DELETE PROMPT DB LOOKUP ERROR]:', dbErr.message);
      }
    }

    // ดำเนินการลบข้อความเป้าหมายทันที
    if (targetChanId && targetMsgId) {
      const channel = await client.channels.fetch(targetChanId).catch(() => null);
      if (channel) {
        const msg = await channel.messages.fetch(targetMsgId).catch(() => null);
        if (msg) {
          await msg.delete().catch(delErr => console.warn('[DELETE PROMPT MSG ERROR]:', delErr.message));
          console.log(`[DELETE PROMPT] 🧹 ลบข้อความการ์ดยืนยัน ${targetMsgId} ในช่อง ${targetChanId} ของสมาชิก ${memberId} สำเร็จ`);
        }
      }
    }

    // ระบบเสริม: สแกนกวาดข้อความตกค้างของบอทที่ผูกกับผู้สมัครรายนี้ในห้องลงทะเบียน/อัปโหลดรูป
    const discordId = memberData?.discord_id || (interaction?.message?.embeds?.[0]?.description?.match(/<@(\d+)>/)?.[1]);
    if (discordId) {
      const verifyChanId = VERIFY_CHANNEL_ID || '1567570864835264542';
      const photoChanId = PHOTO_CHANNEL_ID || '1567570904094085180';
      const checkChannelIds = Array.from(new Set([targetChanId, verifyChanId, photoChanId, '1567570866663989389'].filter(Boolean)));

      for (const chId of checkChannelIds) {
        try {
          const ch = await client.channels.fetch(chId).catch(() => null);
          if (!ch || !ch.isTextBased()) continue;
          const messages = await ch.messages.fetch({ limit: 30 }).catch(() => null);
          if (!messages) continue;

          for (const [, m] of messages) {
            if (m.author?.id === client.user?.id) {
              const hasMention = m.content && m.content.includes(discordId);
              const isConfirmEmbed = m.embeds?.some(e =>
                (e.title && (e.title.includes('ยืนยันข้อมูลและส่งคำขอ') || e.title.includes('ตัดแต่งรูปถ่าย'))) ||
                (e.description && e.description.includes(discordId))
              );
              if (hasMention || isConfirmEmbed) {
                await m.delete().catch(() => {});
                console.log(`[CLEANUP PROMPT] 🧹 เก็บกวาดข้อความตกค้างของบอท ${m.id} ในช่อง ${chId} สำหรับสมาชิก <@${discordId}> สำเร็จ`);
              }
            }
          }
        } catch (scanErr) {
          console.warn('[CLEANUP PROMPT SCAN ERROR]:', scanErr.message);
        }
      }
    }
  } catch (err) {
    console.warn('[DELETE PROMPT OVERALL ERROR]:', err.message);
  }
}

/**
 * ✏️ สร้าง Modal สำหรับแก้ไขข้อมูลตัวอักษรของผู้สมัคร
 */
function buildRegistrationEditModal(member) {
  const modal = new ModalBuilder()
    .setCustomId(`modal_edit_reg_${member.id}`)
    .setTitle('✏️ แก้ไขข้อมูลผู้สมัคร');

  const nameInput = new TextInputBuilder()
    .setCustomId('input_name')
    .setLabel('ชื่อ-นามสกุล (มี นาย/นางสาว ติดชื่อ)')
    .setStyle(TextInputStyle.Short)
    .setValue(`${member.first_name} ${member.last_name}`)
    .setRequired(true);

  const nicknameInput = new TextInputBuilder()
    .setCustomId('input_nickname')
    .setLabel('ชื่อเล่น')
    .setStyle(TextInputStyle.Short)
    .setValue(member.nickname || '')
    .setRequired(true);

  const gradeInput = new TextInputBuilder()
    .setCustomId('input_grade')
    .setLabel('ระดับชั้น/ห้อง (เช่น 5/7, 4/10)')
    .setStyle(TextInputStyle.Short)
    .setValue(member.grade_class || '')
    .setRequired(true);

  const studentNoInput = new TextInputBuilder()
    .setCustomId('input_student_no')
    .setLabel('เลขที่')
    .setStyle(TextInputStyle.Short)
    .setValue(String(member.student_no || ''))
    .setRequired(true);

  const phoneInput = new TextInputBuilder()
    .setCustomId('input_phone')
    .setLabel('เบอร์โทรศัพท์')
    .setStyle(TextInputStyle.Short)
    .setValue(member.phone_number || '')
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(nicknameInput),
    new ActionRowBuilder().addComponents(gradeInput),
    new ActionRowBuilder().addComponents(studentNoInput),
    new ActionRowBuilder().addComponents(phoneInput)
  );

  return modal;
}

function getDutyRoles(dutyDay) {
  if (!dutyDay) return [];
  const roles = [];
  if (dutyDay.endsWith('S') && dutyDay !== 'S') {
    const baseDay = dutyDay === 'TSS' ? 'Ts' : dutyDay.replace(/S+$/, '');
    if (ROLE_IDS.DAYS[baseDay]) roles.push(ROLE_IDS.DAYS[baseDay]);
    if (ROLE_IDS.DAYS['S']) roles.push(ROLE_IDS.DAYS['S']);
  } else if (dutyDay === 'S') {
    if (ROLE_IDS.DAYS['S']) roles.push(ROLE_IDS.DAYS['S']);
  } else {
    if (ROLE_IDS.DAYS[dutyDay]) roles.push(ROLE_IDS.DAYS[dutyDay]);
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

const APPROVAL_CHANNEL_ID = process.env.APPROVAL_CHANNEL_ID;
const VERIFY_CHANNEL_ID = process.env.VERIFY_CHANNEL_ID || '1567570864835264542';
const PHOTO_CHANNEL_ID = process.env.PHOTO_CHANNEL_ID;
const ATTENDANCE_CHANNEL_ID = process.env.ATTENDANCE_CHANNEL_ID;
const PHOTO_VAULT_CHANNEL_NAME = '📸│คลังเก็บรูปสำรอง-bot';

/**
 * 📸 ค้นหาหรือสร้างช่องคลังเก็บรูปสำรองถาวร (เฉพาะบอทและแอดมินมองเห็น ป้องกันข้อมูลสูญหาย 100%)
 */
async function getOrCreatePhotoVaultChannel(guild) {
  if (!guild) return null;
  let ch = guild.channels.cache.find(c => 
    c.name === PHOTO_VAULT_CHANNEL_NAME || 
    c.name === 'คลังเก็บรูปสำรอง-bot' ||
    (c.name.includes('คลัง') && c.name.includes('รูป'))
  );
  if (!ch) {
    try {
      ch = await guild.channels.create({
        name: PHOTO_VAULT_CHANNEL_NAME,
        type: ChannelType.GuildText,
        topic: 'คลังเก็บรูปถ่ายโปรไฟล์และรูปทำบัตรสำรองถาวร (บอทและผู้ดูแลระบบเท่านั้น)',
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionsBitField.Flags.ViewChannel]
          },
          {
            id: guild.client.user.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.AttachFiles,
              PermissionsBitField.Flags.ReadMessageHistory,
              PermissionsBitField.Flags.EmbedLinks
            ]
          }
        ]
      });
      console.log(`[PHOTO-VAULT] 📸 สร้างห้องคลังรูปสำรองสำเร็จ: #${ch.name} (${ch.id})`);
    } catch (err) {
      console.error('[PHOTO-VAULT ERROR] ไม่สามารถสร้างห้องคลังรูปสำรอง:', err.message);
    }
  }
  return ch;
}

// ==========================================================
// ⚡ DISCORD SLASH COMMANDS DEFINITION (/)
// ==========================================================
const slashCommands = [
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('📊 ดูสถานะระบบ SARAWAT-BOT และสถิติสมาชิกสารวัตร'),
  new SlashCommandBuilder()
    .setName('my-card')
    .setDescription('🪪 ดูบัตรประจำตัวสารวัตรนักเรียนดิจิทัล 3D ของฉัน'),
  new SlashCommandBuilder()
    .setName('sync-roles')
    .setDescription('🔄 ซิงค์ยศและชื่อเล่นจากฐานข้อมูลสู่ Discord สำหรับทุกคน (Admin)'),
  new SlashCommandBuilder()
    .setName('semester')
    .setDescription('🎓 ดูหรือกำหนดภาคเรียนปัจจุบัน'),
  new SlashCommandBuilder()
    .setName('setup-verify')
    .setDescription('🛡️ ติดตั้งแผงปุ่มยืนยันตัวตนสารวัตรนักเรียน (Admin)'),
  new SlashCommandBuilder()
    .setName('setup-leave')
    .setDescription('📝 ติดตั้งแผงปุ่มขอลาเวรปฏิบัติหน้าที่ (Admin)'),
  new SlashCommandBuilder()
    .setName('setup-attendance')
    .setDescription('📄 ติดตั้งแผงปุ่มขอใบตารางเช็คชื่อสารวัตร A4 (Admin)'),
  new SlashCommandBuilder()
    .setName('setup-photo')
    .setDescription('📸 ติดตั้งแผงปุ่มส่งรูปถ่ายทำบัตรประจำตัว (Admin)'),
  new SlashCommandBuilder()
    .setName('setup-appoint')
    .setDescription('👑 ติดตั้งแผงแต่งตั้งตำแหน่งสารวัตรและกำหนดเทอม (Admin)'),
  new SlashCommandBuilder()
    .setName('setup-all')
    .setDescription('🚀 ติดตั้งแผงปุ่มระบบทั้งหมดลงในทุกห้องที่เกี่ยวข้องในคลิกเดียว (Admin)'),
  new SlashCommandBuilder()
    .setName('setup-service')
    .setDescription('🛎️ ติดตั้งแผงศูนย์บริการสารวัตร (+ขออนุญาตตัว / +ส่งหลักฐานคดี) (Admin)'),
  new SlashCommandBuilder()
    .setName('setup-lost-found')
    .setDescription('📦 ติดตั้งจุดรับแจ้งสิ่งของที่พบเจอ (Lost & Found Hub) (Admin)'),
  new SlashCommandBuilder()
    .setName('d-day')
    .setDescription('🚨 ปฏิบัติการ D-DAY: ล้างข้อมูลสารวัตรทุกนาย และเริ่มใหม่แต่ 0 ทุกช่องแชท (Admin Only)'),
  new SlashCommandBuilder()
    .setName('killfile')
    .setDescription('🗑️ ลบข้อมูลสิ่งของที่มีอยู่ในระบบของหายทั้งหมด เริ่มใหม่แต่ 0 (Admin Only)'),
  new SlashCommandBuilder()
    .setName('purge-system-data')
    .setDescription('🚨 ล้างข้อมูลปฏิบัติการทั้งหมด (หลักฐาน, คำขอ, คดี, ของหาย) ยกเว้นข้อมูลสมาชิก (Admin Only)'),
  new SlashCommandBuilder()
    .setName('demote')
    .setDescription('⛔ ปลดหน้าที่หรือถอดยศสารวัตรนักเรียน (Admin/ประธาน)')
    .addUserOption(opt =>
      opt.setName('target')
        .setDescription('เลือกสารวัตรที่ต้องการปลดหน้าที่')
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('test-duty')
    .setDescription('🔔 ทดสอบระบบแจ้งเตือนเวรประจำวัน และตรวจสอบรายชื่อสารวัตร (Admin)')
    .addStringOption(opt =>
      opt.setName('mode')
        .setDescription('รูปแบบการทดสอบแจ้งเตือนเวร')
        .setRequired(false)
        .addChoices(
          { name: '🧪 [โหมด 1] dry_run (จำลองตรวจสอบรายชื่อ ไม่ส่ง DM จริง)', value: 'dry_run' },
          { name: '📨 [โหมด 2] self (ส่งการ์ดตัวอย่างเข้า DM ของฉันคนเดียว)', value: 'self' },
          { name: '🚀 [โหมด 3] all (ส่งข้อความแจ้งเตือนจริงหาสารวัตรทุกคนในผลัด)', value: 'all' }
        )
    )
    .addStringOption(opt =>
      opt.setName('day')
        .setDescription('เลือกผลัดเวรที่ต้องการทดสอบ (ค่าเริ่มต้น: เวรวันนี้)')
        .setRequired(false)
        .addChoices(
          { name: '📅 วันนี้ (Today - คำนวณเวลาไทยอัตโนมัติ)', value: 'today' },
          { name: '🔵 วันจันทร์ (M, MS, S)', value: 'M' },
          { name: '🟣 วันอังคาร (T, TS, S)', value: 'T' },
          { name: '🟢 วันพุธ (W, WS, S)', value: 'W' },
          { name: '🟠 วันพฤหัสบดี (Ts, TSS, S)', value: 'Ts' },
          { name: '🔴 วันศุกร์ (F, FS, S)', value: 'F' },
          { name: '⭐ เวรพิเศษ (S)', value: 'S' }
        )
    ),
  new SlashCommandBuilder()
    .setName('send')
    .setDescription('📢 ประกาศข้อความอย่างเป็นทางการ แท็กทุกคน (@everyone) (Admin/ผู้บริหาร)')
    .addStringOption(opt =>
      opt.setName('message')
        .setDescription('ข้อความที่ต้องการประกาศถึงทุกคน')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('update')
    .setDescription('🔄 กู้คืนรูปลิงก์หมดอายุ ซิงค์ยศ และสำรองสื่อทั้งหมดเข้า Google Drive (Admin)')
];

// 📦 ที่เก็บสถานะชั่วคราวสำหรับการแจ้งพบของหายผ่านรูปภาพใน Discord
const pendingLostReports = new Map();

// ==========================================================
// 🛠️ HELPER FUNCTIONS FOR PANELS & SYSTEM MANAGEMENT
// ==========================================================
function findChannel(guild, idOrName) {
  if (!guild || !idOrName) return null;
  if (guild.channels.cache.has(idOrName)) {
    return guild.channels.cache.get(idOrName);
  }
  return guild.channels.cache.find(c => c.name.includes(idOrName));
}

async function sendLostFoundGuidePanel(channel) {
  if (!channel) return null;
  const embed = new EmbedBuilder()
    .setTitle('📦 จุดรับแจ้งสิ่งของที่พบเจอ (LOST & FOUND HUB)')
    .setDescription(
      'ศูนย์กลางรับแจ้งและบันทึกสิ่งของที่เก็บได้ภายในโรงเรียนพระนารายณ์\n\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
      '📌 **ขั้นตอนการบันทึกของหายเข้าระบบ (ง่ายๆ ใน 2 ขั้น):**\n' +
      '1️⃣ **[ส่งรูปภาพ]** — แนบส่งรูปถ่ายสิ่งของที่เก็บได้ เข้ามาในห้องนี้ได้ทันที\n' +
      '2️⃣ **[เลือกหมวด & กรอกชื่อ]** — บอทจะเปิดเมนูให้เลือกหมวดหมู่ และเด้งกล่องข้อความให้ระบุชื่อสิ่งของและสถานที่พบ\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
      '⚡ *ระบบจะใช้ Discord เป็น Host จัดเก็บรูปภาพ และส่งข้อมูลขึ้นหน้าเว็บศูนย์บัญชาการสารวัตรทันที*'
    )
    .setColor('#F39C12')
    .setFooter({ text: 'ฝ่ายบริหารงานสารวัตรนักเรียน • โรงเรียนพระนารายณ์' });

  const files = [];
  const bannerPath = path.join(__dirname, 'assets', 'panel_send_photo.jpg');
  if (fs.existsSync(bannerPath)) {
    files.push(new AttachmentBuilder(bannerPath, { name: 'panel_send_photo.jpg' }));
    embed.setImage('attachment://panel_send_photo.jpg');
  }

  const lostFormUrl = process.env.GOOGLE_FORM_LOST_CLAIM_URL || 'https://forms.google.com';
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('🌐 ตรวจสอบคลังของหาย (Web)')
      .setStyle(ButtonStyle.Link)
      .setURL(`${getWebDashboardUrl()}/lost-found`),
    new ButtonBuilder()
      .setLabel('📝 แจ้งของตัวเองหาย (Google Form)')
      .setStyle(ButtonStyle.Link)
      .setURL(lostFormUrl)
  );

  return await channel.send({ embeds: [embed], components: [row], files });
}

async function sendVerifyPanel(channel) {
  if (!channel) return null;
  const embed = new EmbedBuilder()
    .setTitle('🛡️ จุดลงทะเบียนสารวัตรนักเรียนใหม่')
    .setDescription(
      'ยินดีต้อนรับสารวัตรนักเรียนโรงเรียนพระนารายณ์ทุกท่าน เข้าสู่ระบบบริหารงานดิจิทัล\n\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
      '📌 **ขั้นตอนการลงทะเบียน (ทำจบในช่องนี้):**\n' +
      '1️⃣ **[กรอกข้อมูลสารวัตร]** — ค้นหาชื่อ-นามสกุล หรือกรอกข้อมูลใหม่ และเลือกรอบเวร\n' +
      '2️⃣ **[ส่งรูปถ่ายหน้าตรง]** — แนบรูปถ่ายหน้าตรงในเครื่องแบบ ส่งเข้ามาในช่องนี้ได้ทันที\n' +
      '3️⃣ **[ยืนยันรูป & ส่งอนุมัติ]** — ตรวจสอบรูปและกดยืนยัน บอทจะส่งคำขอให้คณะผู้บริหารตรวจสอบ\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
      '👉 *กดปุ่ม **"🛡️ เริ่มต้นลงทะเบียนสารวัตร"** ด้านล่างเพื่อเริ่มทำรายการทันที*'
    )
    .setColor('#3498DB')
    .setFooter({ text: 'ฝ่ายบริหารงานสารวัตรนักเรียน • โรงเรียนพระนารายณ์' });

  const files = [];
  const bannerPath = path.join(__dirname, 'assets', 'panel_input_data.jpg');
  if (fs.existsSync(bannerPath)) {
    files.push(new AttachmentBuilder(bannerPath, { name: 'panel_input_data.jpg' }));
    embed.setImage('attachment://panel_input_data.jpg');
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_start_verify')
      .setLabel('🛡️ เริ่มต้นลงทะเบียนสารวัตร')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('btn_check_my_registration_status')
      .setLabel('👁️ ตรวจสอบสถานะของฉัน (เฉพาะคุณที่เห็น)')
      .setStyle(ButtonStyle.Secondary)
  );

  return await channel.send({ embeds: [embed], components: [row], files });
}

async function sendPhotoPanel(channel) {
  if (!channel) return null;
  const embed = new EmbedBuilder()
    .setTitle('📸 จุดส่งรูปโปรไฟล์สำหรับทำบัตรสารวัตรนักเรียน (3D ID Card)')
    .setDescription(
      'สารวัตรนักเรียนที่ผ่านการอนุมัติแล้ว สามารถส่งรูปถ่ายหน้าตรงเพื่อจัดทำบัตรประจำตัวได้ที่นี่\n\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
      '📌 **ขั้นตอนการส่งรูปทำบัตร (อัตโนมัติ 100%):**\n' +
      '1️⃣ **[อัปโหลดรูปภาพ]** — แนบรูปถ่ายหน้าตรงในเครื่องแบบของคุณ ส่งเข้ามาในห้องนี้ได้ทันที\n' +
      '2️⃣ **[ระบบผูกข้อมูล]** — บอทจะตรวจจับและบันทึกรูปเข้ากับรหัสเวรและชื่อของคุณในระบบ\n' +
      '3️⃣ **[ตรวจสอบผล]** — กดปุ่ม **"🔍 ตรวจสอบรูปภาพของฉัน"** เพื่อดูรูปตัวอย่างและสถานะ\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
      '*(หมายเหตุ: ต้องผ่านการยืนยันตัวตนที่ห้อง 🛡️│ยืนยันตัวตน เรียบร้อยก่อนนะครับ)*'
    )
    .setColor('#9B59B6')
    .setFooter({ text: 'กลุ่มงานสารวัตรนักเรียน • โรงเรียนพระนารายณ์' });

  const files = [];
  const bannerPath = path.join(__dirname, 'assets', 'panel_send_photo.jpg');
  if (fs.existsSync(bannerPath)) {
    files.push(new AttachmentBuilder(bannerPath, { name: 'panel_send_photo.jpg' }));
    embed.setImage('attachment://panel_send_photo.jpg');
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_check_my_photo')
      .setLabel('🔍 ตรวจสอบรูปภาพของฉัน')
      .setStyle(ButtonStyle.Primary)
  );

  return await channel.send({ embeds: [embed], components: [row], files });
}

async function sendAttendancePanel(channel) {
  if (!channel) return null;

  // เปลี่ยนชื่อช่องอัตโนมัติหากยังเป็นชื่อเดิม
  if (channel.name && (channel.name.includes('บริการ') || channel.name.includes('บริการเวรและใบเช็คชื่อ'))) {
    await channel.setName('📑│เช็คชื่อ').catch(() => {});
  }

  const embed = new EmbedBuilder()
    .setTitle('📋 ศูนย์บริการสารวัตรนักเรียน (SARAWAT SERVICE HUB)')
    .setDescription(
      'ยินดีต้อนรับสู่ศูนย์บริการสารวัตรนักเรียน โรงเรียนพระนารายณ์\n\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
      '📄 **1. งานเอกสารและการลงเวลา**\n' +
      'ขอใบตารางเช็คชื่อลงเวลาประจำเวร ขนาดกระดาษ A4 มาตรฐาน พร้อมพิมพ์ใช้งานได้ทันที\n\n' +
      '📝 **2. การแจ้งลาเวรปฏิบัติหน้าที่**\n' +
      'แจ้งขอลาเวรด่วน พร้อมระบุผู้ปฏิบัติหน้าที่แทน ระบบจะส่งข้อความแจ้งเตือนหาหัวหน้าเวรทันที\n\n' +
      '🚨 **3. การขออนุมัติออกปฏิบัติหน้าที่**\n' +
      'ยื่นขออนุมัติตรวจพื้นที่เป้าหมาย / เข้าระงับเหตุด่วน เพื่อเปิดเคสส่งคณะผู้บริหาร\n\n' +
      '🌐 **4. ระบบสารสนเทศและแดชบอร์ด**\n' +
      'เข้าสู่ระบบเว็บศูนย์บัญชาการสารวัตรนักเรียน เพื่อดูสถิติ, คดี, และทำเนียบสารวัตร\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    )
    .setColor('#1ABC9C')
    .setFooter({ text: 'กลุ่มงานสารวัตรนักเรียน • โรงเรียนพระนารายณ์' });

  const files = [];
  const bannerPath = path.join(__dirname, 'assets', 'panel_all_in_one.jpg');
  if (fs.existsSync(bannerPath)) {
    files.push(new AttachmentBuilder(bannerPath, { name: 'panel_all_in_one.jpg' }));
    embed.setImage('attachment://panel_all_in_one.jpg');
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_start_attendance_scan')
      .setLabel('⚡ เช็คชื่อด้วยภาพถ่าย AI')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('btn_request_attendance')
      .setLabel('📄 ขอใบเช็คชื่อ A4')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_request_leave')
      .setLabel('📝 แจ้งขอลาเวร')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('btn_request_inspection')
      .setLabel('🚨 ขอออกปฏิบัติหน้าที่')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setLabel('🌐 เว็บไซต์ระบบ')
      .setStyle(ButtonStyle.Link)
      .setURL(getWebDashboardUrl())
  );

  return await channel.send({ embeds: [embed], components: [row], files });
}

async function sendInspectorServicePanel(channel) {
  if (!channel) return null;

  const embed = new EmbedBuilder()
    .setTitle('🛎️ ศูนย์บริการสารวัตรนักเรียน | SARAWAT SERVICE')
    .setDescription(
      'ยินดีต้อนรับสู่ศูนย์บริการสารวัตรนักเรียน โรงเรียนพระนารายณ์\n' +
      'กรุณากดเลือกบริการที่ต้องการทำรายการด้านล่างนี้:\n\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
      '🔍 **+ ขออนุญาตออกตรวจ (Patrol Ticket)**\n' +
      'เปิดเคสขออนุญาตออกตรวจพื้นที่, ส่งรูปภาพหลักฐานยืนยันตัวตน และบันทึกรายงานผลตรวจ\n' +
      '*(ระบบจะเปิดห้องเคส Ticket ย่อย พร้อมระบบสัญญาณอนุญาตอัตโนมัติ)*\n\n' +
      '📁 **+ ส่งหลักฐานคดี (Incident & Evidence)**\n' +
      'ส่งรายงานเหตุการณ์, บันทึกการตรวจพบสิ่งผิดระเบียบ หรือแนบภาพ/คลิป Bodycam หลักฐานคดี\n' +
      '*(ระบบจะออกรหัส CASE-XXXX และเปิดเธรดสำหรับอัปโหลดหลักฐานทันที)*\n\n' +
      '✏️ **แก้ไขข้อมูลส่วนตัว (Edit Profile)**\n' +
      'เปลี่ยนรูปถ่ายหน้าตรง 1 นิ้ว (อัปเดตบัตรทันที) หรือยื่นแก้ไขข้อมูลตัวอักษรเพื่อส่งผู้บริหารอนุมัติ\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    )
    .setColor('#0EA5E9')
    .setFooter({ text: 'SARAWAT-BOT • ระบบบริการสารวัตรนักเรียน' });

  const files = [];
  const bannerPath = path.join(__dirname, 'assets', 'panel_all_in_one.jpg');
  if (fs.existsSync(bannerPath)) {
    files.push(new AttachmentBuilder(bannerPath, { name: 'panel_service.jpg' }));
    embed.setImage('attachment://panel_service.jpg');
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_service_request_inspection')
      .setLabel('+ขออนุญาตออกตรวจ')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🔍'),
    new ButtonBuilder()
      .setCustomId('btn_service_submit_evidence')
      .setLabel('+ส่งหลักฐานคดี')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('📁'),
    new ButtonBuilder()
      .setCustomId('btn_service_edit_profile')
      .setLabel('✏️ แก้ไขข้อมูลตัวเอง')
      .setStyle(ButtonStyle.Success)
  );

  return await channel.send({ embeds: [embed], components: [row], files });
}

async function sendAppointPanel(channel) {
  if (!channel) return null;
  const embed = new EmbedBuilder()
    .setTitle('👑 ศูนย์บริหารและแต่งตั้งตำแหน่งสารวัตรนักเรียน')
    .setDescription(
      '*(สงวนสิทธิ์เฉพาะประธานสารวัตร, รองประธาน และคณะผู้บริหารเท่านั้น)*\n\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
      '👑 **แต่งตั้งผู้นำฝ่ายและหัวหน้าเวร**\n' +
      'แต่งตั้งตำแหน่ง **ประธาน**, **รองประธาน**, **หัวหน้าเวร** หรือ **รองหัวหน้าเวร**\n\n' +
      '⛔ **ปลดหน้าที่และถอดยศ**\n' +
      'ปลดยศผู้นำกลับเป็นสมาชิกทั่วไป หรือปลดพ้นสภาพสารวัตรนักเรียน คืนรหัสเวร\n\n' +
      '👥 **ตรวจสอบทำเนียบสารวัตร**\n' +
      'ดูรายชื่อสารวัตรทั้งหมดที่ปฏิบัติหน้าที่อยู่ในปัจจุบัน แยกตามผลัดเวร\n\n' +
      '🌐 **ศูนย์บัญชาการสารวัตรนักเรียน (Web Command)**\n' +
      'เปิดหน้าเว็บแดชบอร์ดสำหรับผู้บริหาร เพื่อจัดการข้อมูลและตรวจสอบสถิติเชิงลึก\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    )
    .setColor('#F1C40F')
    .setFooter({ text: 'SARAWAT-BOT • ระบบบริหารงานสารวัตรนักเรียน' });

  const files = [];
  const bannerPath = path.join(__dirname, 'assets', 'panel_all_in_one.jpg');
  if (fs.existsSync(bannerPath)) {
    files.push(new AttachmentBuilder(bannerPath, { name: 'panel_all_in_one.jpg' }));
    embed.setImage('attachment://panel_all_in_one.jpg');
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_open_appoint_menu')
      .setLabel('👑 แต่งตั้งตำแหน่ง')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('btn_open_demote_menu')
      .setLabel('⛔ ปลดหน้าที่ / ถอดยศ')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('btn_inspect_roster')
      .setLabel('👥 ตรวจสอบทำเนียบ')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_set_semester')
      .setLabel('🎓 ภาคเรียน')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setLabel('🌐 แดชบอร์ด (Web)')
      .setStyle(ButtonStyle.Link)
      .setURL(getWebDashboardUrl())
  );

  return await channel.send({ embeds: [embed], components: [row], files });
}

async function purgeChannelMessages(channel, limit = 100) {
  if (!channel || !channel.isTextBased()) return;
  // ป้องกันไม่ให้ลบข้อความในห้องคลังเก็บรูปสำรองถาวรเด็ดขาด
  if (channel.name && (channel.name === PHOTO_VAULT_CHANNEL_NAME || channel.name.includes('คลังเก็บรูปสำรอง'))) {
    return;
  }
  try {
    const fetched = await channel.messages.fetch({ limit }).catch(() => null);
    if (!fetched || fetched.size === 0) return;

    const now = Date.now();
    const recent = fetched.filter(m => (now - m.createdTimestamp) < 14 * 24 * 60 * 60 * 1000);
    const older = fetched.filter(m => (now - m.createdTimestamp) >= 14 * 24 * 60 * 60 * 1000);

    if (recent.size > 0) {
      await channel.bulkDelete(recent, true).catch(() => {});
    }
    for (const msg of older.values()) {
      if (msg.author.id === client.user.id) {
        await msg.delete().catch(() => {});
      }
    }
  } catch (err) {
    console.warn(`[PURGE] Failed to purge ${channel.name}:`, err.message);
  }
}

async function syncAllMemberRoles(guild) {
  const { data: activeMembers } = await supabase
    .from('members')
    .select('*')
    .eq('status', 'ACTIVE')
    .not('discord_id', 'is', null);

  if (!activeMembers || activeMembers.length === 0) {
    return { success: false, message: 'ℹ️ ไม่พบสมาชิกสถานะ ACTIVE ที่มี Discord ID ในฐานข้อมูล', successCount: 0, failCount: 0 };
  }

  let successCount = 0;
  let failCount = 0;
  const errors = [];

  for (const m of activeMembers) {
    try {
      const gm = await guild.members.fetch(m.discord_id).catch(() => null);
      if (!gm) continue;

      const rolesToAdd = [ROLE_IDS.VERIFIED, ...getDutyRoles(m.duty_day)];
      if (m.role === 'ADMIN' && ROLE_IDS.ADMIN) rolesToAdd.push(ROLE_IDS.ADMIN);
      if (m.role === 'TEACHER' && ROLE_IDS.TEACHER) rolesToAdd.push(ROLE_IDS.TEACHER);
      if (m.role === 'PRESIDENT' && ROLE_IDS.PRESIDENT) rolesToAdd.push(ROLE_IDS.PRESIDENT);
      if (m.role === 'VICE_PRESIDENT' && ROLE_IDS.VICE_PRESIDENT) rolesToAdd.push(ROLE_IDS.VICE_PRESIDENT);
      const baseDay = m.duty_day === 'TSS' ? 'Ts' : m.duty_day.replace(/S+$/, '');
      if (m.shift_role === 'SHIFT_HEAD') {
        if (ROLE_IDS.HEADS[baseDay]) rolesToAdd.push(ROLE_IDS.HEADS[baseDay]);
        if (m.duty_day.endsWith('S') && ROLE_IDS.HEAD_S) rolesToAdd.push(ROLE_IDS.HEAD_S);
      }
      if (m.shift_role === 'SHIFT_DEPUTY') {
        if (ROLE_IDS.DEPUTIES[baseDay]) rolesToAdd.push(ROLE_IDS.DEPUTIES[baseDay]);
        if (m.duty_day.endsWith('S') && ROLE_IDS.DEPUTY_S) rolesToAdd.push(ROLE_IDS.DEPUTY_S);
      }

      const validRoles = rolesToAdd.filter(rid => rid && guild.roles.cache.has(rid));
      if (validRoles.length > 0) {
        await gm.roles.add(validRoles);
      }

      const allManagedRoles = [
        ...Object.values(ROLE_IDS.DAYS || {}),
        ...Object.values(ROLE_IDS.HEADS || {}),
        ...Object.values(ROLE_IDS.DEPUTIES || {}),
        ROLE_IDS.ADMIN,
        ROLE_IDS.TEACHER,
        ROLE_IDS.PRESIDENT,
        ROLE_IDS.VICE_PRESIDENT
      ].filter(rid => rid && guild.roles.cache.has(rid));
      const obsoleteRoles = allManagedRoles.filter(rid => !validRoles.includes(rid) && gm.roles.cache.has(rid));
      if (obsoleteRoles.length > 0) {
        await gm.roles.remove(obsoleteRoles).catch(() => {});
      }
      if (ROLE_IDS.UNVERIFIED && gm.roles.cache.has(ROLE_IDS.UNVERIFIED)) {
        await gm.roles.remove(ROLE_IDS.UNVERIFIED).catch(() => {});
      }

      if (m.duty_id) {
        const newNick = `[${m.duty_id}] ${m.nickname} (${m.first_name})`;
        await gm.setNickname(newNick.slice(0, 32)).catch(() => {});
      }

      successCount++;
    } catch (err) {
      failCount++;
      errors.push(`${m.nickname}: ${err.message}`);
    }
  }

  return {
    success: true,
    successCount,
    failCount,
    hasPermissionError: failCount > 0 && errors[0]?.includes('Missing Permissions')
  };
}

/**
 * 📁 ซิงค์รูปภาพและสื่อทั้งหมดจากระบบเข้าสู่ Google Drive ย้อนหลัง
 * (รูปโปรไฟล์สารวัตร, หลักฐานคดี/Bodycam, รูปของหาย)
 */
async function syncAllMediaToGoogleDrive() {
  const result = {
    profileCount: 0,
    evidenceCount: 0,
    lostCount: 0,
    errors: []
  };

  try {
    // 1. ซิงค์รูปโปรไฟล์สารวัตรทั้งหมด
    const { data: members } = await supabase
      .from('members')
      .select('id, first_name, last_name, nickname, duty_id, profile_image_url')
      .not('profile_image_url', 'is', null);

    if (members && members.length > 0) {
      for (const m of members) {
        if (!m.profile_image_url || !m.profile_image_url.startsWith('http')) continue;
        try {
          const res = await fetch(m.profile_image_url);
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            const filename = `profile_${(m.duty_id || 'SW').replace(/[^a-zA-Z0-9_-]/g, '_')}_${(m.first_name || m.nickname || m.id)}.jpg`;
            const gRes = await uploadToGoogleDrive(buf, filename, {
              category: 'profile',
              memberName: `${m.first_name || ''} ${m.last_name || ''}`.trim() || m.nickname,
              dutyId: m.duty_id || '-'
            });
            if (gRes && gRes.success) {
              result.profileCount++;
            }
          }
        } catch (pErr) {
          result.errors.push(`Profile ${m.duty_id}: ${pErr.message}`);
        }
      }
    }

    // 2. ซิงค์รูปหลักฐานคดีและคลิป Bodycam
    const { data: cases } = await supabase
      .from('cases')
      .select('case_id, evidence_urls')
      .not('evidence_urls', 'is', null);

    if (cases && cases.length > 0) {
      for (const c of cases) {
        if (!Array.isArray(c.evidence_urls)) continue;
        for (let i = 0; i < c.evidence_urls.length; i++) {
          const url = c.evidence_urls[i];
          if (!url || !url.startsWith('http')) continue;
          try {
            const res = await fetch(url);
            if (res.ok) {
              const buf = Buffer.from(await res.arrayBuffer());
              const ext = url.includes('.mp4') ? 'mp4' : (url.includes('.png') ? 'png' : 'jpg');
              const filename = `evidence_${c.case_id}_${i + 1}.${ext}`;
              const gRes = await uploadToGoogleDrive(buf, filename, {
                category: 'evidence',
                caseId: c.case_id
              });
              if (gRes && gRes.success) {
                result.evidenceCount++;
              }
            }
          } catch (cErr) {
            result.errors.push(`Case ${c.case_id}: ${cErr.message}`);
          }
        }
      }
    }

    // 3. ซิงค์รูปสิ่งของที่พบเจอ (Lost & Found)
    try {
      const { data: lostClaims } = await supabase
        .from('lost_claims')
        .select('claim_code, photo_url')
        .not('photo_url', 'is', null);

      if (lostClaims && lostClaims.length > 0) {
        for (const item of lostClaims) {
          if (!item.photo_url || !item.photo_url.startsWith('http')) continue;
          try {
            const res = await fetch(item.photo_url);
            if (res.ok) {
              const buf = Buffer.from(await res.arrayBuffer());
              const filename = `lost_${(item.claim_code || Date.now())}.jpg`;
              const gRes = await uploadToGoogleDrive(buf, filename, {
                category: 'lost_found',
                itemCode: item.claim_code
              });
              if (gRes && gRes.success) {
                result.lostCount++;
              }
            }
          } catch (lErr) {
            result.errors.push(`Lost ${item.claim_code}: ${lErr.message}`);
          }
        }
      }
    } catch (e) {}

  } catch (err) {
    result.errors.push(`Sync failed: ${err.message}`);
  }

  return result;
}

/**
 * 🛡️ ตั้งค่าสิทธิ์ให้สารวัตรทุกคนสามารถเข้าถึงห้องระบบได้ (ศูนย์บริการ / จุดรับแจ้งของหาย)
 * @param {Guild} guild 
 * @param {GuildChannel} channel 
 * @param {Object} options 
 * @param {boolean} options.allowSend - อนุญาตให้ส่งข้อความ/แนบไฟล์ได้หรือไม่ (true สำหรับแจ้งของหาย, false สำหรับศูนย์บริการ)
 */
async function ensureInspectorChannelAccess(guild, channel, { allowSend = false } = {}) {
  if (!guild || !channel || !channel.permissionOverwrites) return;
  try {
    // 1. ซ่อนห้องจาก @everyone
    if (guild.roles?.everyone) {
      await channel.permissionOverwrites.edit(guild.roles.everyone.id, {
        ViewChannel: false
      }).catch(err => console.warn(`[PERMS] ไม่สามารถซ่อนห้อง #${channel.name} จาก @everyone:`, err.message));
    }

    // 2. ซ่อนห้องจาก UNVERIFIED (ถ้ามี)
    if (ROLE_IDS.UNVERIFIED && guild.roles?.cache?.has(ROLE_IDS.UNVERIFIED)) {
      await channel.permissionOverwrites.edit(ROLE_IDS.UNVERIFIED, {
        ViewChannel: false
      }).catch(() => {});
    }

    // 3. รวบรวมทุกบทบาทที่เป็นสารวัตร
    const inspectorRoleIds = new Set();
    if (ROLE_IDS.VERIFIED && guild.roles?.cache?.has(ROLE_IDS.VERIFIED)) {
      inspectorRoleIds.add(ROLE_IDS.VERIFIED);
    }
    if (guild.roles?.cache) {
      guild.roles.cache.forEach(r => {
        if (r.name.includes('สารวัตรนักเรียน') || r.name.includes('สารวัตร')) {
          inspectorRoleIds.add(r.id);
        }
      });
    }
    Object.values(ROLE_IDS.DAYS || {}).forEach(rid => {
      if (rid && guild.roles?.cache?.has(rid)) inspectorRoleIds.add(rid);
    });
    Object.values(ROLE_IDS.HEADS || {}).forEach(rid => {
      if (rid && guild.roles?.cache?.has(rid)) inspectorRoleIds.add(rid);
    });
    Object.values(ROLE_IDS.DEPUTIES || {}).forEach(rid => {
      if (rid && guild.roles?.cache?.has(rid)) inspectorRoleIds.add(rid);
    });
    if (ROLE_IDS.ADMIN && guild.roles?.cache?.has(ROLE_IDS.ADMIN)) inspectorRoleIds.add(ROLE_IDS.ADMIN);
    if (ROLE_IDS.TEACHER && guild.roles?.cache?.has(ROLE_IDS.TEACHER)) inspectorRoleIds.add(ROLE_IDS.TEACHER);
    if (ROLE_IDS.PRESIDENT && guild.roles?.cache?.has(ROLE_IDS.PRESIDENT)) inspectorRoleIds.add(ROLE_IDS.PRESIDENT);
    if (ROLE_IDS.VICE_PRESIDENT && guild.roles?.cache?.has(ROLE_IDS.VICE_PRESIDENT)) inspectorRoleIds.add(ROLE_IDS.VICE_PRESIDENT);

    // 4. สิทธิ์ของสารวัตร
    const inspectorPerms = {
      ViewChannel: true,
      ReadMessageHistory: true
    };
    if (allowSend) {
      inspectorPerms.SendMessages = true;
      inspectorPerms.AttachFiles = true;
      inspectorPerms.EmbedLinks = true;
    } else {
      inspectorPerms.SendMessages = false;
    }

    for (const rid of inspectorRoleIds) {
      await channel.permissionOverwrites.edit(rid, inspectorPerms).catch(err => {
        console.warn(`[PERMS] ไม่สามารถตั้งสิทธิ์ Role ${rid} ใน #${channel.name}:`, err.message);
      });
    }

    // 5. ให้สิทธิ์บอท (Client User / me) สิทธิ์เต็มเสมอ
    const me = guild.members?.me || (client.user && guild.members?.cache?.get(client.user.id));
    if (me) {
      await channel.permissionOverwrites.edit(me.id, {
        ViewChannel: true,
        SendMessages: true,
        EmbedLinks: true,
        AttachFiles: true,
        ManageMessages: true,
        ReadMessageHistory: true
      }).catch(() => {});
    }

    console.log(`[PERMS] 🛡️ อัปเดตสิทธิ์ห้อง #${channel.name} ให้สารวัตร (${inspectorRoleIds.size} บทบาท) สำเร็จ [allowSend: ${allowSend}]`);
  } catch (err) {
    console.error(`[PERMS] Error setting permissions for #${channel.name}:`, err);
  }
}

/**
 * 🔄 เคลียร์ข้อความเก่าและติดตั้งแผงฟีเจอร์เวอร์ชันล่าสุดในทุกช่องระบบ (ไม่ใช่ D-Day ข้อมูลไม่หาย)
 */
async function refreshAllChannelsAndPanels(guild, options = { purge: true }) {
  if (!guild) return { success: false, reason: 'No guild' };
  console.log(`[REFRESH] 🔄 เริ่มต้นเคลียร์ข้อความเก่าและติดตั้งแผงฟีเจอร์สำหรับ: ${guild.name}`);
  const result = {
    refreshedChannels: 0,
    errors: []
  };

  try {
    let chVerify = findChannel(guild, '🛡️│ลงทะเบียนสารวัตรใหม่') ||
      findChannel(guild, '🛡️│ยืนยันตัวตน') ||
      guild.channels.cache.find(c => c.name.includes('ลงทะเบียน') || c.name.includes('ยืนยันตัวตน'));

    if (chVerify && chVerify.name && (chVerify.name.includes('ยืนยันตัวตน') && !chVerify.name.includes('ลงทะเบียนสารวัตรใหม่'))) {
      await chVerify.setName('🛡️│ลงทะเบียนสารวัตรใหม่').catch(() => {});
    }

    if (chVerify) {
      await chVerify.permissionOverwrites.edit(guild.roles.everyone, {
        ViewChannel: true,
        SendMessages: true,
        AttachFiles: true,
        ReadMessageHistory: true
      }).catch(() => {});
    }

    const chPhoto = findChannel(guild, process.env.PHOTO_CHANNEL_ID) ||
      guild.channels.cache.find(c => c.name.includes('อัปโหลดรูปโปรไฟล์') || c.name.includes('อัปโหลดรูป'));
    if (chPhoto) {
      console.log(`[REFRESH] 🗑️ ลบห้องอัปโหลดรูปเดิม #${chPhoto.name} เพื่อรวมเข้ากับ #🛡️│ลงทะเบียนสารวัตรใหม่`);
      await chPhoto.delete('รวมช่องเข้ากับห้อง #🛡️│ลงทะเบียนสารวัตรใหม่').catch(() => {});
    }
    const chAttendance = findChannel(guild, process.env.ATTENDANCE_CHANNEL_ID) ||
      findChannel(guild, '📑│เช็คชื่อ') ||
      findChannel(guild, 'เช็คชื่อ') ||
      findChannel(guild, '📑│บริการ') ||
      guild.channels.cache.find(c => c.name.includes('เช็คชื่อ') || c.name.includes('บริการ'));
    if (chAttendance && (chAttendance.name.includes('บริการ') || chAttendance.name.includes('บริการเวรและใบเช็คชื่อ'))) {
      await chAttendance.setName('📑│เช็คชื่อ').catch(() => {});
    }
    const chApproval = findChannel(guild, process.env.APPROVAL_CHANNEL_ID) || guild.channels.cache.find(c => c.name.includes('อนุมัติสมาชิก'));
    const chAllInOne = findChannel(guild, '👑│ผู้นำ-all-in-one') || findChannel(guild, '👑│ห้องประชุมหัวหน้า');
    let chLostFound = findChannel(guild, '📦│แจ้งพบของหาย') ||
      findChannel(guild, 'แจ้งพบของหาย') ||
      guild.channels.cache.find(c => c.name.includes('ของหาย'));

    if (!chLostFound) {
      try {
        const catTarget = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && (c.name.includes('ปฏิบัติการ') || c.name.includes('ศูนย์รับเรื่อง') || c.name.includes('คดี') || c.name.includes('บริการ'))) || null;
        const verifiedRole = guild.roles.cache.find(r => r.name.includes('สารวัตรนักเรียน'));
        const overwrites = [
          { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] }
        ];
        if (verifiedRole) {
          overwrites.push({
            id: verifiedRole.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.AttachFiles,
              PermissionsBitField.Flags.EmbedLinks
            ]
          });
        }
        chLostFound = await guild.channels.create({
          name: '📦│แจ้งพบของหาย',
          type: ChannelType.GuildText,
          parent: catTarget ? catTarget.id : null,
          topic: 'ศูนย์รับแจ้งและบันทึกสิ่งของที่พบเจอ (ส่งรูปภาพในห้องนี้เพื่อบันทึกของหาย)',
          permissionOverwrites: overwrites
        });
        console.log(`[REFRESH] 📦 สร้างห้องแจ้งพบของหายสำเร็จ: #${chLostFound.name}`);
      } catch (e) {
        console.warn('[REFRESH] ไม่สามารถสร้างห้องแจ้งพบของหาย:', e.message);
      }
    }

    if (chVerify) {
      if (options.purge) await purgeChannelMessages(chVerify);
      await sendVerifyPanel(chVerify);
      result.refreshedChannels++;
    }

    if (chAttendance) {
      if (options.purge) await purgeChannelMessages(chAttendance);
      await sendAttendancePanel(chAttendance);
      result.refreshedChannels++;
    }

    if (chAllInOne) {
      if (options.purge) await purgeChannelMessages(chAllInOne);
      await sendAppointPanel(chAllInOne);
      result.refreshedChannels++;
    }

    if (chLostFound) {
      if (options.purge) await purgeChannelMessages(chLostFound);
      await sendLostFoundGuidePanel(chLostFound);
      await ensureInspectorChannelAccess(guild, chLostFound, { allowSend: true });
      result.refreshedChannels++;
    }

    let chInspectorService = findChannel(guild, '🛎️│บริการสารวัตร') ||
      findChannel(guild, 'บริการสารวัตร') ||
      guild.channels.cache.find(c => c.name.includes('บริการสารวัตร'));

    if (!chInspectorService) {
      try {
        const catDuty = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && (c.name.includes('ปฏิบัติการประจำเวร') || c.name.includes('ปฏิบัติการ'))) || null;
        const verifiedRole = guild.roles.cache.find(r => r.name.includes('สารวัตรนักเรียน'));
        const overwrites = [
          { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] }
        ];
        if (verifiedRole) {
          overwrites.push({
            id: verifiedRole.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.ReadMessageHistory
            ],
            deny: [PermissionsBitField.Flags.SendMessages]
          });
        }
        chInspectorService = await guild.channels.create({
          name: '🛎️│บริการสารวัตร',
          type: ChannelType.GuildText,
          parent: catDuty ? catDuty.id : null,
          topic: 'ศูนย์บริการสารวัตรนักเรียน: ขออนุญาตตัว / ลาเวร และส่งหลักฐานคดี',
          permissionOverwrites: overwrites
        });
        console.log(`[REFRESH] 🛎️ สร้างห้องบริการสารวัตรสำเร็จ: #${chInspectorService.name}`);
      } catch (e) {
        console.warn('[REFRESH] ไม่สามารถสร้างห้องบริการสารวัตร:', e.message);
      }
    }

    if (chInspectorService) {
      if (options.purge) await purgeChannelMessages(chInspectorService);
      await sendInspectorServicePanel(chInspectorService);
      await ensureInspectorChannelAccess(guild, chInspectorService, { allowSend: true });
      result.refreshedChannels++;
    }

    if (chApproval && options.purge) {
      await purgeChannelMessages(chApproval);
      result.refreshedChannels++;
    }

    console.log(`[REFRESH] ✅ รีเฟรชและเคลียร์ช่องระบบสำเร็จ ${result.refreshedChannels} ช่อง (ข้อมูลฐานข้อมูลคงเดิม 100% ไม่ใช่ D-Day)`);
    return { success: true, count: result.refreshedChannels };
  } catch (err) {
    console.error('[REFRESH] Error refreshing channels:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 🇹🇭 คำนวณวันในสัปดาห์ตามเวลาประเทศไทย (Asia/Bangkok, UTC+7) เสมอ
 * ป้องกันปัญหา Server บน Cloud (เช่น Render/Docker) รัน Timezone เป็น UTC
 */
function getThaiDayOfWeek(date = new Date()) {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    weekday: 'short'
  }).format(date);
  const dayIndexMap = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
  return dayIndexMap[weekday] ?? 0;
}

/**
 * 📅 ดึงรหัสเวรที่ต้องปฏิบัติหน้าที่สำหรับวันนี้ (อิงเวลาประเทศไทย UTC+7 เสมอ)
 */
function getTodayDutyCodes(referenceDate = new Date()) {
  const dayNum = getThaiDayOfWeek(referenceDate);
  const dayMap = {
    1: ['M', 'MS', 'S'],
    2: ['T', 'TS', 'S'],
    3: ['W', 'WS', 'S'],
    4: ['Ts', 'TSS', 'S'],
    5: ['F', 'FS', 'S']
  };
  return dayMap[dayNum] || [];
}

/**
 * 📋 ค้นหาหรือสร้างช่องสำหรับเก็บบันทึกการทำงานของระบบ (Audit Log Channel)
 * ค้นหาช่องชื่อ 'log' หรือ 'Log' หรือสร้างช่อง 'log' ให้อัตโนมัติ
 */
async function getOrCreateLogChannel(guild) {
  if (!guild || !guild.channels || !guild.channels.cache) return null;

  // 1. ตรวจสอบผ่าน LOG_CHANNEL_ID ใน .env
  if (process.env.LOG_CHANNEL_ID && guild.channels.cache.has && guild.channels.cache.has(process.env.LOG_CHANNEL_ID)) {
    return guild.channels.cache.get(process.env.LOG_CHANNEL_ID);
  }

  // 2. ค้นหาช่องที่มีชื่อว่า log (case-insensitive) เช่น "log", "Log", "LOG", "📋│log", "bot-log", "logs"
  const isLogChan = (c) => {
    if (!c || typeof c.isTextBased !== 'function' || !c.isTextBased()) return false;
    const n = (c.name || '').toLowerCase();
    return n === 'log' || n === 'logs' || n.includes('log') || n.includes('audit-log');
  };

  let existing = null;
  if (typeof guild.channels.cache.find === 'function') {
    existing = guild.channels.cache.find(isLogChan);
  } else if (typeof guild.channels.cache.values === 'function') {
    existing = Array.from(guild.channels.cache.values()).find(isLogChan);
  }
  if (existing) return existing;

  // 3. หากยังไม่มีในเซิร์ฟเวอร์ และมีสิทธิ์สร้างห้อง ให้สร้างช่อง "log" ให้อัตโนมัติ
  if (typeof guild.channels.create !== 'function') return null;

  try {
    let parentCategory = null;
    if (typeof guild.channels.cache.find === 'function') {
      parentCategory = guild.channels.cache.find(c => c && c.type === 4 && ((c.name || '').includes('บริหาร') || (c.name || '').includes('ระบบ')));
    } else if (typeof guild.channels.cache.values === 'function') {
      parentCategory = Array.from(guild.channels.cache.values()).find(c => c && c.type === 4 && ((c.name || '').includes('บริหาร') || (c.name || '').includes('ระบบ')));
    }

    const overwrites = [];
    if (guild.roles?.everyone?.id) {
      overwrites.push({ id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] });
    }

    const newChan = await guild.channels.create({
      name: 'log',
      type: 0, // GuildText
      parent: parentCategory ? parentCategory.id : undefined,
      permissionOverwrites: overwrites,
      topic: 'ห้องบันทึกการกระทำและการแจ้งเตือนของ SARAWAT-BOT (Action Logs)'
    });
    console.log(`[LOG] 📋 สร้างช่อง Log อัตโนมัติ: #${newChan.name} (${newChan.id})`);

    const welcomeEmbed = new EmbedBuilder()
      .setTitle('📋 [SARAWAT AUDIT LOG] เริ่มต้นระบบบันทึกการทำงาน')
      .setDescription('ช่องนี้ใช้สำหรับบันทึกการกระทำและการแจ้งเตือนที่สำคัญของ SARAWAT-BOT ทั้งหมด\nเช่น การแจ้งเตือนเวรประจำวัน, การขอลาเวร, และการอนุมัติสมาชิก')
      .setColor('#3498DB')
      .setTimestamp();
    await newChan.send({ embeds: [welcomeEmbed] }).catch(() => {});

    return newChan;
  } catch (err) {
    console.warn('[LOG] ⚠️ ไม่สามารถสร้างห้อง Log อัตโนมัติได้:', err.message);
    return null;
  }
}

/**
 * 📣 ส่งบันทึกการกระทำของบอทเข้าห้อง Log (Audit Action Logger)
 */
async function sendBotActionLog(guild, {
  title,
  description,
  fields = [],
  color = '#3498DB',
  actor = '⚙️ ระบบอัตโนมัติ (SARAWAT-BOT)',
  thumbnail = null
}) {
  try {
    if (!guild) return null;
    const logChan = await getOrCreateLogChannel(guild);
    if (!logChan) {
      console.log(`[ACTION LOG] ${title}: ${description}`);
      return null;
    }

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(color)
      .addFields(
        { name: '👤 ผู้ดำเนินการ', value: actor, inline: true },
        ...fields
      )
      .setFooter({ text: `SARAWAT Action Logger • เวลาไทย: ${new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' })}` })
      .setTimestamp();

    if (thumbnail) embed.setThumbnail(thumbnail);

    return await logChan.send({ embeds: [embed] });
  } catch (err) {
    console.warn('[ACTION LOG] ⚠️ ส่ง Log ไม่สำเร็จ:', err.message);
    return null;
  }
}

/**
 * 📋 รวบยอดข้อมูลการลาเวรของผลัดนั้นให้อยู่ในการ์ดเดียว และส่งแบบ Realtime ให้หัวหน้าเวรและห้องเวร
 */
async function broadcastConsolidatedShiftLeaveCard(guild, dutyDay, newLeave = null, actor = null) {
  if (!guild || !dutyDay) return { success: false, reason: 'Missing guild or dutyDay' };

  const baseDay = dutyDay === 'S' ? 'S' : (dutyDay === 'TSS' ? 'Ts' : (dutyDay.replace(/S+$/, '') || dutyDay));
  const matchingCodes = baseDay === 'S'
    ? ['S', 'MS', 'TS', 'WS', 'TSS', 'FS']
    : [baseDay, baseDay === 'Ts' ? 'TSS' : `${baseDay}S`, 'S'];

  // 1. ดึงสมาชิกทั้งหมดที่สังกัดเวรนี้
  const { data: shiftMembers = [] } = await supabase
    .from('members')
    .select('*')
    .eq('status', 'ACTIVE')
    .in('duty_day', matchingCodes)
    .order('duty_id', { ascending: true });

  // 2. ดึงรายการลาของเวรนี้ที่สร้างในวันนี้ (UTC+7 Thailand)
  const now = new Date();
  const bkkDateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
  const thaiMidnight = new Date(`${bkkDateParts}T00:00:00+07:00`);

  const { data: rawLeaves = [] } = await supabase
    .from('leave_requests')
    .select('*, members(*)')
    .in('duty_day', matchingCodes)
    .gte('created_at', thaiMidnight.toISOString())
    .order('created_at', { ascending: false });

  // จัดกลุ่มและ Deduplicate การลาต่อ 1 สมาชิก (เอาใบขอล่าสุด)
  const leavesMap = new Map();
  for (const l of rawLeaves) {
    if (!leavesMap.has(l.member_id)) {
      leavesMap.set(l.member_id, l);
    }
  }
  const leaves = Array.from(leavesMap.values());
  const leaveMemberIds = new Set(leaves.map(l => l.member_id));
  const activeOnDuty = shiftMembers.filter(m => !leaveMemberIds.has(m.id));

  const total = shiftMembers.length;
  const leaveCount = leaves.length;
  const onDutyCount = activeOnDuty.length;
  const readinessPct = total > 0 ? Math.round((onDutyCount / total) * 100) : 0;

  const todayThaiDate = now.toLocaleDateString('th-TH', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Bangkok'
  });
  const shiftLabel = getShiftLabel(dutyDay);

  // รูปแบบรายการผู้ลา
  const leaveListFormatted = leaves.map((l, idx) => {
    const mem = l.members || shiftMembers.find(m => m.id === l.member_id) || {};
    const name = `[${mem.duty_id || 'สารวัตร'}] คุณ${mem.nickname || mem.first_name} (${mem.grade_class || 'ม.ปลาย'})`;
    const period = l.shift_period || 'ทั้งวัน';
    const type = l.leave_type || 'ลากิจ';
    const reason = l.reason || '-';
    const sub = (l.substitute_name && l.substitute_name !== '-') ? ` | คนแทน: **${l.substitute_name}**` : '';
    return `**${idx + 1}. ${name}**\n   └ 🏷️ **${type}** (${period}) • *${reason}*${sub}`;
  }).join('\n\n');

  // รูปแบบรายชื่อผู้พร้อมปฏิบัติหน้าที่
  const onDutyFormatted = activeOnDuty.map(m => `\`[${m.duty_id || "เวร"}] ${m.nickname}\``).join(' ') || '_ไม่มีสารวัตรพร้อมปฏิบัติหน้าที่_';

  const cardColor = leaveCount === 0 ? '#2ECC71' : (onDutyCount > 0 ? '#F39C12' : '#E74C3C');

  const consolidatedEmbed = new EmbedBuilder()
    .setTitle(`📋 [รายงานสถานะกำลังพล] สรุปยอดการลาเวรประจำผลัด`)
    .setDescription(
      `# 📅 เวร${DAY_NAMES[baseDay] || dutyDay} (${shiftLabel})\n` +
      `📅 **ประจำวันที่:** **${todayThaiDate}**\n` +
      `⚡ **อัปเดตแบบ Realtime:** <t:${Math.floor(Date.now() / 1000)}:R>\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `### 📊 สรุปความพร้อมกำลังพล\n` +
      `• 👥 **กำลังพลตามตารางทั้งหมด:** **${total}** นาย\n` +
      `• ⚠️ **ขอยอดลาเวร:** **${leaveCount}** นาย\n` +
      `• 👮 **พร้อมปฏิบัติหน้าที่จริง:** **${onDutyCount}** นาย (${readinessPct}%)\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `### 📝 รายชื่อสารวัตรที่ขอลาเวร (${leaveCount} นาย):\n` +
      `${leaveListFormatted || '✅ ไม่มีสารวัตรขอลาเวรในผลัดนี้ (กำลังพลพร้อม 100%)'}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `### 🛡️ สารวัตรที่พร้อมปฏิบัติหน้าที่ (${onDutyCount} นาย):\n` +
      `${onDutyFormatted}`
    )
    .setColor(cardColor)
    .setFooter({ text: `กลุ่มงานสารวัตรนักเรียน โรงเรียนพระนารายณ์ • Real-time Duty Roster` })
    .setTimestamp();

  const webUrl = getWebDashboardUrl();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('🌐 ตรวจสอบในเว็บแดชบอร์ด')
      .setStyle(ButtonStyle.Link)
      .setURL(`${webUrl}/`),
    new ButtonBuilder()
      .setCustomId(`btn_refresh_shift_leaves_${dutyDay}`)
      .setLabel('🔄 รีเฟรชยอดลา')
      .setStyle(ButtonStyle.Secondary)
  );

  // ส่ง/อัปเดตเข้าช่องเวรประจำวัน
  const dayChannelNameMap = {
    'M': 'เวรวันจันทร์-m',
    'T': 'เวรวันอังคาร-t',
    'W': 'เวรวันพุธ-w',
    'Ts': 'เวรวันพฤหัสบดี-ts',
    'F': 'เวรวันศุกร์-f',
    'S': 'เวรพิเศษ-s'
  };
  const targetChannelKeyword = dayChannelNameMap[baseDay] || `เวร${DAY_NAMES[baseDay]}`;
  const allChans = guild.channels?.cache?.values ? Array.from(guild.channels.cache.values()) : [];
  const dayChannel = allChans.find(c => c && typeof c.isTextBased === 'function' && c.isTextBased() && (c.name || '').includes(targetChannelKeyword));

  if (dayChannel) {
    try {
      const messages = await dayChannel.messages.fetch({ limit: 10 }).catch(() => null);
      const existingMsg = messages?.find(m => m.author.id === client.user.id && m.embeds?.[0]?.title?.includes('สรุปยอดการลาเวรประจำผลัด'));
      if (existingMsg) {
        await existingMsg.edit({ embeds: [consolidatedEmbed], components: [row] });
      } else {
        await dayChannel.send({ embeds: [consolidatedEmbed], components: [row] });
      }
    } catch (chanErr) {
      console.warn(`[BROADCAST] Failed to send to day channel ${targetChannelKeyword}:`, chanErr.message);
    }
  }

  // ส่งเข้า DM ของหัวหน้าเวรและรองหัวหน้าเวร (ถ้ามีแต่งตั้งไว้)
  const { data: heads = [] } = await supabase
    .from('members')
    .select('*')
    .in('duty_day', matchingCodes)
    .in('shift_role', ['SHIFT_HEAD', 'SHIFT_DEPUTY'])
    .not('discord_id', 'is', null)
    .eq('status', 'ACTIVE');

  let headDmCount = 0;
  for (const h of heads) {
    try {
      const u = await client.users.fetch(h.discord_id);
      if (u) {
        await u.send({ embeds: [consolidatedEmbed], components: [row] });
        headDmCount++;
      }
    } catch (e) {}
  }

  // ส่งบันทึกเข้าห้อง Log (Audit Logger)
  await sendBotActionLog(guild, {
    title: '📝 [อัปเดตยอดลาเวรแบบ Realtime] สรุปยอดการลาประจำผลัด',
    description: `มีการอัปเดตข้อมูลการลาในผลัด **เวร${DAY_NAMES[baseDay] || dutyDay}** ระบบได้รวบข้อมูลยอดลาทั้งหมดให้อยู่ในการ์ดเดียว และส่งรายงานสรุปให้หัวหน้าเวรเรียบร้อยแล้ว`,
    color: '#E67E22',
    actor: actor || '👮 สารวัตรผู้ขอลา',
    fields: [
      { name: '👥 สรุปกำลังพล', value: `ทั้งหมด: **${total}** นาย\nลาเวร: **${leaveCount}** นาย\nพร้อมปฏิบัติหน้าที่: **${onDutyCount}** นาย (${readinessPct}%)`, inline: true },
      { name: '🏷️ ผู้ขอล่าสุด', value: newLeave ? `คุณ**${newLeave.nickname}** (${newLeave.leave_type || 'ลา'})\nเหตุผล: ${newLeave.reason || '-'}` : 'ไม่มีข้อมูลใหม่', inline: true },
      { name: '📨 การส่งแจ้งเตือน', value: `ช่องเวร: ${dayChannel ? `<#${dayChannel.id}>` : '-'}\nหัวหน้าเวร (DM): ${headDmCount} ท่าน`, inline: false }
    ]
  });

  return {
    success: true,
    total,
    leaveCount,
    onDutyCount,
    readinessPct,
    headDmCount
  };
}

/**
 * 🔔 ระบบส่งแจ้งเตือนส่วนตัวว่า "วันนี้เป็นเวรของคุณ" พร้อมปุ่มกดขอลาเวรด่วน
 */
async function sendDailyDutyReminders(guild, options = { dryRun: false, forceDay: null, actor: null }) {
  const targetCodes = options.forceDay
    ? [options.forceDay, options.forceDay === 'Ts' ? 'TSS' : `${options.forceDay}S`, 'S']
    : getTodayDutyCodes();

  if (targetCodes.length === 0 && !options.forceDay) {
    return {
      success: true,
      count: 0,
      codes: targetCodes,
      message: 'วันนี้เป็นวันหยุดสุดสัปดาห์ ไม่มีเวรประจำวันตามตารางปกติ'
    };
  }

  const { data: members, error } = await supabase
    .from('members')
    .select('*')
    .eq('status', 'ACTIVE')
    .in('duty_day', targetCodes)
    .not('discord_id', 'is', null);

  if (error) throw error;
  if (!members || members.length === 0) {
    return {
      success: true,
      count: 0,
      codes: targetCodes,
      message: `ไม่พบสารวัตรที่มีเวรตรงกับรหัส (${targetCodes.join(', ')}) ในวันนี้`
    };
  }

  const todayThaiDate = new Date().toLocaleDateString('th-TH', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Bangkok'
  });

  let sentCount = 0;
  const errors = [];
  const remindedList = [];

  for (const m of members) {
    const baseDay = m.duty_day === 'TSS' ? 'Ts' : m.duty_day.replace(/S+$/, '');
    const shiftLabel = getShiftLabel(m.duty_day);

    const embed = new EmbedBuilder()
      .setTitle('🔔 แจ้งเตือนเวรสารวัตรนักเรียนประจำวัน')
      .setDescription(
        `# ☀️ วันนี้เป็นเวรปฏิบัติหน้าที่ของคุณ!\n\n` +
        `### 👮 [${m.duty_id || 'สารวัตร'}] คุณ${m.nickname} (${m.first_name} ${m.last_name})\n` +
        `📅 **ประจำวัน:** **${todayThaiDate}** (${shiftLabel})\n` +
        `⏰ **ข้อปฏิบัติ:** สวมปลอกแขน/เครื่องแบบสารวัตร และเข้าประจำจุดตรวจตามเวลา\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `### ⚠️ หากติดภารกิจและต้องการลาเวร\n` +
        `กดปุ่ม **"📝 ขอลาเวรวันนี้"** ด้านล่างได้ทันทีเพื่อเลือกประเภทการลาและระบุหมายเหตุ`
      )
      .setColor('#F39C12')
      .setFooter({ text: `เวร${DAY_NAMES[baseDay] || m.duty_day} • กลุ่มงานสารวัตรนักเรียน โรงเรียนพระนารายณ์` })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`btn_dm_quick_leave_${m.id}`)
        .setLabel('📝 ขอลาเวรวันนี้')
        .setStyle(ButtonStyle.Danger)
    );

    if (!options.dryRun) {
      try {
        const user = await client.users.fetch(m.discord_id);
        if (user) {
          await user.send({ embeds: [embed], components: [row] });
          sentCount++;
          remindedList.push(`• [${m.duty_id || 'สารวัตร'}] คุณ${m.nickname} (${m.first_name}) — ผลัด ${m.duty_day}`);
        }
      } catch (err) {
        errors.push(`${m.nickname}: ${err.message}`);
      }
    } else {
      sentCount++;
      remindedList.push(`• [${m.duty_id || 'สารวัตร'}] คุณ${m.nickname} (${m.first_name}) — ผลัด ${m.duty_day}`);
    }
  }

  // ส่งบันทึกการกระทำเข้าห้อง "Log"
  if (guild) {
    await sendBotActionLog(guild, {
      title: options.dryRun
        ? '🧪 [ทดสอบจำลอง] ตรวจสอบเวรสารวัตรประจำวัน (Dry-Run)'
        : '⏰ [แจ้งเตือนเวรประจำวัน] ส่งข้อความหาสารวัตรประจำวัน',
      description: options.dryRun
        ? 'ระบบทำการจำลองการตรวจเช็คเวรประจำวัน โดยไม่ส่งข้อความจริงไปยังสารวัตร'
        : 'ระบบได้ทำการส่งข้อความแจ้งเตือนส่วนตัว (DM) ไปยังสารวัตรที่มีเวรปฏิบัติหน้าที่วันนี้เรียบร้อยแล้ว',
      color: options.dryRun ? '#F1C40F' : '#2ECC71',
      actor: options.actor || (options.dryRun ? '🧪 โหมดทดสอบ (Dry-Run)' : '⚙️ ระบบตั้งเวลาอัตโนมัติ (06:30 น.)'),
      fields: [
        { name: '📅 วันที่ / ผลัดเป้าหมาย', value: `${todayThaiDate}\nรหัส: \`${targetCodes.join(', ')}\``, inline: true },
        { name: '📊 จำนวนที่แจ้งเตือน', value: `สำเร็จ: **${sentCount}** นาย\nจากทั้งหมด: **${members.length}** นาย`, inline: true },
        {
          name: `👮 รายชื่อสารวัตรที่ได้รับการแจ้งเตือน (${remindedList.length} นาย)`,
          value: remindedList.length > 0 ? remindedList.slice(0, 15).join('\n') + (remindedList.length > 15 ? `\n...และอีก ${remindedList.length - 15} นาย` : '') : 'ไม่มีสารวัตรเข้าเวรในผลัดนี้',
          inline: false
        }
      ]
    }).catch(e => console.warn('[LOG] Error logging duty reminder:', e.message));
  }

  return {
    success: true,
    count: sentCount,
    totalTargeted: members.length,
    codes: targetCodes,
    remindedList,
    errors
  };
}

/**
 * 🛠️ ระบบตรวจสอบและวินิจฉัยฟีเจอร์ทั้งหมดของ SARAWAT-BOT (Full Feature Diagnostic)
 */
async function runSystemDiagnostics(guild) {
  const report = {
    timestamp: new Date().toISOString(),
    guild: guild ? guild.name : 'Unknown',
    checks: [],
    overallSuccess: true
  };

  // 1. ตรวจสอบการเชื่อมต่อฐานข้อมูล Supabase
  try {
    const t0 = Date.now();
    const { count: mCount, error: mErr } = await supabase.from('members').select('*', { count: 'exact', head: true });
    const { count: cCount } = await supabase.from('cases').select('*', { count: 'exact', head: true });
    const { count: lCount } = await supabase.from('leave_requests').select('*', { count: 'exact', head: true });
    const latency = Date.now() - t0;
    if (mErr) throw mErr;
    report.checks.push({
      category: '🗄️ ฐานข้อมูล Supabase',
      pass: true,
      detail: `เชื่อมต่อสมบูรณ์ (${latency}ms) • สมาชิก: ${mCount || 0} คน | คดี: ${cCount || 0} คดี | บันทึกการลา: ${lCount || 0} ครั้ง`
    });
  } catch (err) {
    report.overallSuccess = false;
    report.checks.push({
      category: '🗄️ ฐานข้อมูล Supabase',
      pass: false,
      detail: `เกิดข้อผิดพลาด: ${err.message}`
    });
  }

  // 2. ตรวจสอบ Discord Gateway & Latency
  const wsPing = client.ws.ping;
  const isHealthyPing = wsPing >= 0 && wsPing < 600;
  if (!isHealthyPing) report.overallSuccess = false;
  report.checks.push({
    category: '⚡ Discord Gateway & Bot Ping',
    pass: isHealthyPing,
    detail: `สถานะ: ออนไลน์ • Latency: ${wsPing}ms`
  });

  // 3. ตรวจสอบห้องระบบสำคัญ
  if (guild) {
    const requiredChannels = [
      { key: 'VERIFY', name: '🛡️│ยืนยันตัวตน' },
      { key: 'PHOTO', name: process.env.PHOTO_CHANNEL_ID || '📸│อัปโหลดรูปโปรไฟล์-ทำบัตร' },
      { key: 'SERVICE', name: process.env.ATTENDANCE_CHANNEL_ID || '📑│เช็คชื่อ' },
      { key: 'APPOINT', name: '👑│ผู้นำ-all-in-one' },
      { key: 'APPROVAL', name: process.env.APPROVAL_CHANNEL_ID || 'อนุมัติสมาชิก' }
    ];

    let foundCount = 0;
    const missing = [];
    for (const req of requiredChannels) {
      const ch = findChannel(guild, req.name) || guild.channels.cache.find(c => c.name.includes(req.name.split('│')[1] || req.name));
      if (ch) {
        foundCount++;
      } else {
        missing.push(req.name);
      }
    }

    const allChannelsFound = foundCount === requiredChannels.length;
    if (!allChannelsFound) report.overallSuccess = false;
    report.checks.push({
      category: '📁 ห้องระบบและแผงฟีเจอร์ (Channels)',
      pass: allChannelsFound,
      detail: allChannelsFound
        ? `พบห้องระบบครบทั้ง ${foundCount}/${requiredChannels.length} ห้อง`
        : `พบ ${foundCount}/${requiredChannels.length} ห้อง (ขาด: ${missing.join(', ')})`
    });
  }

  // 4. ตรวจสอบขีดจำกัดความยาวของ Modal Strings (<= 45 ตัวอักษร)
  const modalStrings = [
    { name: 'Request Inspection Target', text: 'สถานที่ / จุดตรวจ / เป้าหมาย' },
    { name: 'Request Inspection Reason', text: 'เหตุผล / วัตถุประสงค์ในการตรวจ' },
    { name: 'Request Inspection Officers', text: 'สารวัตรผู้ร่วมตรวจ (รหัสเวร/ชื่อ)' },
    { name: 'Request Inspection Urgency', text: 'ระดับความเร่งด่วน (ปกติ/ด่วน/ด่วนมาก)' },
    { name: 'Inspection Note', text: 'หมายเหตุ / คำสั่งการเพิ่มเติม' },
    { name: 'Inspection Finish Who', text: 'ใครทำ (รายชื่อสารวัตรผู้ตรวจ)' },
    { name: 'Inspection Finish What', text: 'ทำอะไร (สรุปผลการตรวจและสิ่งที่พบ)' },
    { name: 'Inspection Finish When', text: 'ตอนไหน (เวลาตรวจ เช่น 12:30 - 13:00 น.)' },
    { name: 'Inspection Finish Evidence', text: 'ไฟล์หลักฐาน / ลิงก์ไดรฟ์ (ถ้ามี)' },
    { name: 'Leave Shift Period', text: 'ช่วงเวลาที่ลา (เช้า/กลางวัน/เย็น/ทั้งวัน)' },
    { name: 'Leave Type', text: 'ประเภทการลา (ลาป่วย / ลากิจ / ติดสอบ)' },
    { name: 'Leave Substitute', text: 'สารวัตรที่เข้าเวรแทน (ถ้ามี)' }
  ];

  const failedStrings = modalStrings.filter(s => s.text.length > 45);
  if (failedStrings.length > 0) report.overallSuccess = false;
  report.checks.push({
    category: '📝 ขีดจำกัดความยาวฟิลด์ Modal (<= 45 ตัวอักษร)',
    pass: failedStrings.length === 0,
    detail: failedStrings.length === 0
      ? `ผ่านการตรวจสอบทุกฟิลด์ (${modalStrings.length} ฟิลด์ปลอดภัย 100%)`
      : `พบฟิลด์ที่เกินลิมิต: ${failedStrings.map(f => `${f.name} (${f.text.length})`).join(', ')}`
  });

  // 5. ตรวจสอบระบบแจ้งเตือนเวรและเวรประจำวัน
  const todayCodes = getTodayDutyCodes();
  const dayName = new Date().toLocaleDateString('th-TH', { weekday: 'long', timeZone: 'Asia/Bangkok' });
  try {
    const { count: dutyCount } = await supabase
      .from('members')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'ACTIVE')
      .in('duty_day', todayCodes.length > 0 ? todayCodes : ['M']);
    report.checks.push({
      category: '🔔 ระบบแจ้งเตือนเวรประจำวัน (Duty Reminder)',
      pass: true,
      detail: `พร้อมทำงาน • วันนี้: ${dayName} (รหัสเวร: ${todayCodes.join(', ') || 'วันหยุด'}) • กำลังพลเวร: ${dutyCount || 0} นาย`
    });
  } catch (e) {
    report.checks.push({
      category: '🔔 ระบบแจ้งเตือนเวรประจำวัน (Duty Reminder)',
      pass: false,
      detail: `เกิดข้อผิดพลาด: ${e.message}`
    });
  }

  // 6. ตรวจสอบระบบจัดเก็บ Bodycam และหลักฐาน
  try {
    const fs = require('fs');
    const path = require('path');
    const uploadDir = path.join(__dirname, '..', 'web', 'public', 'uploads');
    const hasDir = fs.existsSync(uploadDir);
    report.checks.push({
      category: '📹 ระบบจัดเก็บคลิป Bodycam และหลักฐาน',
      pass: hasDir,
      detail: hasDir ? 'พร้อมใช้งาน (โฟลเดอร์ /web/public/uploads พร้อมรับไฟล์)' : 'ไม่พบโฟลเดอร์ uploads'
    });
  } catch (e) {
    report.checks.push({
      category: '📹 ระบบจัดเก็บคลิป Bodycam และหลักฐาน',
      pass: false,
      detail: `เกิดข้อผิดพลาด: ${e.message}`
    });
  }

  return report;
}

async function executeDDay(guild, executorUser) {
  const result = {
    deletedMembers: 0,
    deletedLeaves: 0,
    deletedCases: 0,
    wipedMembers: 0,
    resetChannels: 0
  };

  // 1. Wipe Database (leave_requests -> cases -> members)
  try {
    const { count: cLeaves } = await supabase.from('leave_requests').select('*', { count: 'exact', head: true });
    result.deletedLeaves = cLeaves || 0;
    await supabase.from('leave_requests').delete().gte('created_at', '1970-01-01');

    const { count: cCases } = await supabase.from('cases').select('*', { count: 'exact', head: true });
    result.deletedCases = cCases || 0;
    await supabase.from('cases').delete().gte('created_at', '1970-01-01');

    const { count: cMembers } = await supabase.from('members').select('*', { count: 'exact', head: true });
    result.deletedMembers = cMembers || 0;
    await supabase.from('members').delete().gte('created_at', '1970-01-01');
  } catch (err) {
    console.error('[D-DAY] Database wipe error:', err.message);
  }

  // 2. Strip Discord Roles & Reset Nicknames
  if (guild) {
    try {
      const allMembers = await guild.members.fetch().catch(() => null);
      if (allMembers) {
        const rolesToWipe = [
          ROLE_IDS.VERIFIED,
          ROLE_IDS.PRESIDENT,
          ROLE_IDS.VICE_PRESIDENT,
          ...Object.values(ROLE_IDS.DAYS || {}),
          ...Object.values(ROLE_IDS.HEADS || {}),
          ...Object.values(ROLE_IDS.DEPUTIES || {})
        ].filter(Boolean);

        for (const gm of allMembers.values()) {
          if (gm.user.bot) continue;
          let hasRole = false;
          for (const rid of rolesToWipe) {
            if (gm.roles.cache.has(rid)) {
              hasRole = true;
              break;
            }
          }

          if (hasRole) {
            await gm.roles.remove(rolesToWipe).catch(() => {});
            if (ROLE_IDS.UNVERIFIED && !gm.permissions.has(PermissionsBitField.Flags.Administrator)) {
              await gm.roles.add(ROLE_IDS.UNVERIFIED).catch(() => {});
            }
            if (gm.nickname && gm.nickname.startsWith('[')) {
              await gm.setNickname(null).catch(() => {});
            }
            result.wipedMembers++;
          }
        }
      }
    } catch (err) {
      console.warn('[D-DAY] Role wipe error:', err.message);
    }

    // 3. Reset Channels & Reinstall Clean Panels
    try {
      let chVerify = findChannel(guild, '🛡️│ลงทะเบียนสารวัตรใหม่') ||
        findChannel(guild, '🛡️│ยืนยันตัวตน') ||
        guild.channels.cache.find(c => c.name.includes('ลงทะเบียน') || c.name.includes('ยืนยันตัวตน'));

      if (chVerify && chVerify.name && (chVerify.name.includes('ยืนยันตัวตน') && !chVerify.name.includes('ลงทะเบียนสารวัตรใหม่'))) {
        await chVerify.setName('🛡️│ลงทะเบียนสารวัตรใหม่').catch(() => {});
      }

      if (chVerify) {
        await chVerify.permissionOverwrites.edit(guild.roles.everyone, {
          ViewChannel: true,
          SendMessages: true,
          AttachFiles: true,
          ReadMessageHistory: true
        }).catch(() => {});
      }

      const chPhoto = findChannel(guild, process.env.PHOTO_CHANNEL_ID) ||
        guild.channels.cache.find(c => c.name.includes('อัปโหลดรูปโปรไฟล์') || c.name.includes('อัปโหลดรูป'));
      if (chPhoto) {
        await chPhoto.delete('รวมช่องเข้ากับห้อง #🛡️│ลงทะเบียนสารวัตรใหม่').catch(() => {});
      }
      const chAttendance = findChannel(guild, process.env.ATTENDANCE_CHANNEL_ID) ||
        findChannel(guild, '📑│เช็คชื่อ') ||
        findChannel(guild, 'เช็คชื่อ') ||
        findChannel(guild, '📑│บริการ') ||
        guild.channels.cache.find(c => c.name.includes('เช็คชื่อ') || c.name.includes('บริการ'));
      if (chAttendance && (chAttendance.name.includes('บริการ') || chAttendance.name.includes('บริการเวรและใบเช็คชื่อ'))) {
        await chAttendance.setName('📑│เช็คชื่อ').catch(() => {});
      }
      const chApproval = findChannel(guild, process.env.APPROVAL_CHANNEL_ID) || guild.channels.cache.find(c => c.name.includes('อนุมัติสมาชิก'));
      const chAllInOne = findChannel(guild, '👑│ผู้นำ-all-in-one') || findChannel(guild, '👑│ห้องประชุมหัวหน้า');
      const chAnnounce = findChannel(guild, '📢│ประกาศและมอบหมายงาน') ||
        findChannel(guild, '💬│แค่พูดคุย') ||
        findChannel(guild, 'แค่พูดคุย') ||
        findChannel(guild, '💬│พูดคุยหลัก');

      if (chVerify) {
        await purgeChannelMessages(chVerify);
        await sendVerifyPanel(chVerify);
        result.resetChannels++;
      }

      if (chAttendance) {
        await purgeChannelMessages(chAttendance);
        await sendAttendancePanel(chAttendance);
        result.resetChannels++;
      }

      if (chApproval) {
        await purgeChannelMessages(chApproval);
        result.resetChannels++;
      }

      if (chAllInOne) {
        await purgeChannelMessages(chAllInOne);
        await sendAppointPanel(chAllInOne);
        result.resetChannels++;
      }

      // Purge day channels & incidents
      const dayChannelKeywords = ['เวรพิเศษ', 'เวรวันจันทร์', 'เวรวันอังคาร', 'เวรวันพุธ', 'เวรวันพฤหัสบดี', 'เวรวันศุกร์', 'แจ้งเหตุใหม่', 'ติดตามและปิดคดี'];
      for (const kw of dayChannelKeywords) {
        const ch = guild.channels.cache.find(c => c.name.includes(kw));
        if (ch) {
          await purgeChannelMessages(ch);
          result.resetChannels++;
        }
      }

      // Post Announcement
      if (chAnnounce) {
        const sem = getSettings().current_semester;
        const announceEmbed = new EmbedBuilder()
          .setTitle('🚨 ประกาศ: ปฏิบัติการ D-DAY รีเซ็ตระบบสู่จุดเริ่มต้นเสร็จสิ้น')
          .setDescription(
            `ศูนย์บัญชาการสารวัตรนักเรียน โรงเรียนพระนารายณ์ ได้ดำเนินการ **D-DAY RESET** เรียบร้อยแล้ว\n\n` +
            `• 🔄 **สถานะระบบ:** รีเซ็ตสู่จุดเริ่มต้น (0 คน) รหัสเวรเริ่มต้นนับ 1 ใหม่ (M1, T1, Ts1, ...)\n` +
            `• 🎓 **ภาคเรียน:** ${sem}\n` +
            `• 🛡️ **การลงทะเบียน:** ขอให้สารวัตรนักเรียนทุกท่านลงทะเบียนยืนยันตัวตนใหม่ที่ห้อง ${chVerify ? `<#${chVerify.id}>` : '`🛡️│ยืนยันตัวตน`'}\n` +
            `• 📸 **การทำบัตร:** เมื่อผ่านการอนุมัติแล้ว ให้อัปโหลดรูปหน้าตรงที่ห้อง ${chPhoto ? `<#${chPhoto.id}>` : '`📸│อัปโหลดรูปโปรไฟล์-ทำบัตร`'}\n\n` +
            `*โดย: <@${executorUser?.id || 'Admin'}>*`
          )
          .setColor('#ED4245')
          .setFooter({ text: 'ฝ่ายบริหารงานสารวัตรนักเรียน โรงเรียนพระนารายณ์' })
          .setTimestamp();

        await chAnnounce.send({ embeds: [announceEmbed] }).catch(() => {});
      }
    } catch (err) {
      console.warn('[D-DAY] Channel reset error:', err.message);
    }
  }

  return result;
}

/**
 * 🗑️ ลบข้อมูลสิ่งของและคำร้องที่มีอยู่ในระบบของหายทั้งหมด เริ่มใหม่แต่ 0 (/killfile)
 */
async function executeKillFile(guild, executorUser) {
  const result = {
    deletedItems: 0,
    deletedClaims: 0,
    resetChannels: 0
  };

  // 1. ลบข้อมูลจาก Supabase PostgreSQL Database
  try {
    const { count: cItems } = await supabase.from('lost_items').select('*', { count: 'exact', head: true });
    result.deletedItems = cItems || 0;
    await supabase.from('lost_items').delete().gte('created_at', '1970-01-01');

    const { count: cClaims } = await supabase.from('lost_claims').select('*', { count: 'exact', head: true });
    result.deletedClaims = cClaims || 0;
    await supabase.from('lost_claims').delete().gte('created_at', '1970-01-01');
  } catch (err) {
    console.error('[KILLFILE] Supabase wipe error:', err.message);
  }

  // 2. ล้างข้อมูลใน Local Cache (web/lost_items_cache.json)
  try {
    const possibleCachePaths = [
      path.join(__dirname, '..', 'web', 'lost_items_cache.json'),
      path.join(__dirname, 'lost_items_cache.json'),
      path.join(process.cwd(), 'web', 'lost_items_cache.json'),
      path.join(process.cwd(), 'lost_items_cache.json')
    ];
    for (const targetPath of possibleCachePaths) {
      if (fs.existsSync(targetPath)) {
        let cacheData = {};
        try { cacheData = JSON.parse(fs.readFileSync(targetPath, 'utf8')); } catch (e) {}
        const cItemsCount = (cacheData.items || []).length;
        const cClaimsCount = (cacheData.claims || []).length;
        result.deletedItems = Math.max(result.deletedItems, cItemsCount);
        result.deletedClaims = Math.max(result.deletedClaims, cClaimsCount);
        cacheData.items = [];
        cacheData.claims = [];
        fs.writeFileSync(targetPath, JSON.stringify(cacheData, null, 2), 'utf8');
      }
    }
  } catch (err) {
    console.error('[KILLFILE] Cache wipe error:', err.message);
  }

  // 3. แจ้ง Web Backend API ให้เคลียร์แคชและรูปสำรอง
  try {
    const webUrls = ['http://localhost:10001', 'https://sarawat-pranarai-web.onrender.com'];
    for (const u of webUrls) {
      try {
        await fetch(`${u}/api/lost-found/killfile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ triggered_by: executorUser?.tag || 'Admin' })
        });
      } catch (e) {}
    }
  } catch (e) {}

  // 4. ล้างข้อความเก่าและติดตั้งแผงคู่มือใหม่ในห้อง 📦│แจ้งพบของหาย
  if (guild) {
    try {
      const chLostFound = findChannel(guild, '📦│แจ้งพบของหาย') ||
        findChannel(guild, 'แจ้งพบของหาย') ||
        guild.channels.cache.find(c => c.name.includes('ของหาย'));

      if (chLostFound) {
        await purgeChannelMessages(chLostFound, 100);
        await sendLostFoundGuidePanel(chLostFound);
        result.resetChannels++;
      }
    } catch (err) {
      console.warn('[KILLFILE] Channel reset error:', err.message);
    }
  }

  console.log(`[KILLFILE] 🗑️ ล้างระบบของหายสำเร็จโดย ${executorUser?.tag || 'Admin'}: สิ่งของ ${result.deletedItems} ชิ้น, คำร้อง ${result.deletedClaims} รายการ`);
  return result;
}

/**
 * 🚨 ล้างข้อมูลปฏิบัติการทั้งหมด (คดี, คำขอ, ของหาย, การลงเวลา) ยกเว้นข้อมูลสมาชิก (/purge-system-data)
 */
async function executePurgeSystemData(guild, executorUser) {
  const result = {
    deletedCases: 0,
    deletedLeaves: 0,
    deletedLostItems: 0,
    deletedLostClaims: 0,
    deletedAttendance: 0
  };

  // 1. ลบคดีและเรื่องร้องเรียน (cases)
  try {
    const { count } = await supabase.from('cases').select('*', { count: 'exact', head: true });
    result.deletedCases = count || 0;
    await supabase.from('cases').delete().gte('created_at', '1970-01-01');
  } catch (err) {
    console.error('[PURGE] Cases wipe error:', err.message);
  }

  // 2. ลบคำขอลาเวรและการออกตรวจ (leave_requests)
  try {
    const { count } = await supabase.from('leave_requests').select('*', { count: 'exact', head: true });
    result.deletedLeaves = count || 0;
    await supabase.from('leave_requests').delete().gte('created_at', '1970-01-01');
  } catch (err) {
    console.error('[PURGE] Leaves wipe error:', err.message);
  }

  // 3. ลบคลังของหายและคำร้อง (lost_items, lost_claims)
  try {
    const { count: cItems } = await supabase.from('lost_items').select('*', { count: 'exact', head: true });
    result.deletedLostItems = cItems || 0;
    await supabase.from('lost_items').delete().gte('created_at', '1970-01-01');

    const { count: cClaims } = await supabase.from('lost_claims').select('*', { count: 'exact', head: true });
    result.deletedLostClaims = cClaims || 0;
    await supabase.from('lost_claims').delete().gte('created_at', '1970-01-01');
  } catch (err) {
    console.error('[PURGE] Lost & Found wipe error:', err.message);
  }

  // 4. ลบการลงเวลาเวร (attendance_records)
  try {
    const { count } = await supabase.from('attendance_records').select('*', { count: 'exact', head: true });
    result.deletedAttendance = count || 0;
    await supabase.from('attendance_records').delete().gte('created_at', '1970-01-01');
  } catch (err) {
    console.error('[PURGE] Attendance wipe error:', err.message);
  }

  // 5. ล้างข้อมูลใน Local Cache ของระบบของหาย
  try {
    const possibleCachePaths = [
      path.join(__dirname, '..', 'web', 'lost_items_cache.json'),
      path.join(__dirname, 'lost_items_cache.json'),
      path.join(process.cwd(), 'web', 'lost_items_cache.json'),
      path.join(process.cwd(), 'lost_items_cache.json')
    ];
    for (const targetPath of possibleCachePaths) {
      if (fs.existsSync(targetPath)) {
        let cacheData = {};
        try { cacheData = JSON.parse(fs.readFileSync(targetPath, 'utf8')); } catch (e) {}
        cacheData.items = [];
        cacheData.claims = [];
        fs.writeFileSync(targetPath, JSON.stringify(cacheData, null, 2), 'utf8');
      }
    }
  } catch (err) {
    console.error('[PURGE] Cache wipe error:', err.message);
  }

  console.log(`[PURGE] 🚨 ล้างข้อมูลระบบสำเร็จโดย ${executorUser?.tag || 'Admin'}: คดี ${result.deletedCases}, การลา/คำขอ ${result.deletedLeaves}, ของหาย ${result.deletedLostItems}, คำร้อง ${result.deletedLostClaims}, การลงเวลา ${result.deletedAttendance}`);
  return result;
}

/**
 * 🔻 ปลดตำแหน่งผู้นำของสารวัตร (กลับเป็นสารวัตรทั่วไป MEMBER)
 */
async function executeDemoteLeader(memberId, operatorId, guild) {
  const { data: member, error } = await supabase
    .from('members')
    .select('*')
    .eq('id', memberId)
    .single();

  if (error || !member) {
    throw new Error('ไม่พบข้อมูลสารวัตรในระบบ');
  }

  const prevRole = member.role;
  const prevShiftRole = member.shift_role;

  await supabase
    .from('members')
    .update({
      role: 'MEMBER',
      shift_role: 'MEMBER',
      updated_at: new Date()
    })
    .eq('id', memberId);

  // ปรับยศใน Discord
  if (member.discord_id && guild) {
    try {
      const guildMember = await guild.members.fetch(member.discord_id).catch(() => null);
      if (guildMember) {
        const leadershipRoles = [
          ROLE_IDS.ADMIN,
          ROLE_IDS.PRESIDENT,
          ROLE_IDS.VICE_PRESIDENT,
          ROLE_IDS.HEAD_S,
          ROLE_IDS.DEPUTY_S,
          ...Object.values(ROLE_IDS.HEADS || {}),
          ...Object.values(ROLE_IDS.DEPUTIES || {})
        ].filter(Boolean);

        for (const rid of leadershipRoles) {
          if (guildMember.roles?.cache?.has(rid)) {
            await guildMember.roles.remove(rid).catch(() => {});
          }
        }
      }
    } catch (e) {
      console.warn('[DEMOTE_LEADER] Discord role remove error:', e.message);
    }
  }

  // บันทึก Log ไปยังห้อง #log
  await sendBotActionLog(guild, {
    title: '🔻 ปลดตำแหน่งผู้นำ (กลับเป็นสารวัตรทั่วไป)',
    description: `ปลดตำแหน่งผู้นำของ **[${member.duty_id || '-'}] ${member.nickname} (${member.first_name} ${member.last_name})** กลับสู่สถานะสารวัตรนักเรียนทั่วไปประจำผลัดเวร`,
    fields: [
      { name: '👤 สารวัตร', value: `[${member.duty_id || '-'}] ${member.nickname} (<@${member.discord_id}>)`, inline: true },
      { name: '🎖️ ตำแหน่งเดิม', value: `${prevRole === 'PRESIDENT' ? 'ประธาน' : prevRole === 'VICE_PRESIDENT' ? 'รองประธาน' : prevShiftRole === 'SHIFT_HEAD' ? 'หัวหน้าเวร' : prevShiftRole === 'SHIFT_DEPUTY' ? 'รองหัวหน้าเวร' : 'ผู้นำ'}`, inline: true },
      { name: '🛡️ สถานะใหม่', value: 'สารวัตรนักเรียนทั่วไป (MEMBER)', inline: true }
    ],
    color: '#E67E22',
    actor: operatorId ? `<@${operatorId}>` : '⚙️ ระบบอัตโนมัติ'
  });

  return { success: true, member, prevRole, prevShiftRole };
}

/**
 * 🚫 ปลดพ้นสภาพสารวัตรนักเรียน (คืนรหัสเวร, ถอดยศทั้งหมด, ปลดประจำการ)
 */
async function executeDismissMember(memberId, operatorId, guild) {
  const { data: member, error } = await supabase
    .from('members')
    .select('*')
    .eq('id', memberId)
    .single();

  if (error || !member) {
    throw new Error('ไม่พบข้อมูลสารวัตรในระบบ');
  }

  const freedDutyId = member.duty_id;
  const freedDay = member.duty_day;

  await supabase
    .from('members')
    .update({
      status: 'INACTIVE',
      duty_id: null,
      duty_day: null,
      role: 'MEMBER',
      shift_role: 'MEMBER',
      profile_image_url: null,
      updated_at: new Date()
    })
    .eq('id', memberId);

  // ปรับยศใน Discord
  if (member.discord_id && guild) {
    try {
      const guildMember = await guild.members.fetch(member.discord_id).catch(() => null);
      if (guildMember) {
        const rolesToRemove = [
          ROLE_IDS.ADMIN,
          ROLE_IDS.VERIFIED,
          ROLE_IDS.PRESIDENT,
          ROLE_IDS.VICE_PRESIDENT,
          ROLE_IDS.HEAD_S,
          ROLE_IDS.DEPUTY_S,
          ROLE_IDS.DAY_S,
          ...Object.values(ROLE_IDS.DAYS || {}),
          ...Object.values(ROLE_IDS.HEADS || {}),
          ...Object.values(ROLE_IDS.DEPUTIES || {})
        ].filter(Boolean);

        for (const rid of rolesToRemove) {
          if (guildMember.roles?.cache?.has(rid)) {
            await guildMember.roles.remove(rid).catch(() => {});
          }
        }

        if (ROLE_IDS.UNVERIFIED) {
          await guildMember.roles.add(ROLE_IDS.UNVERIFIED).catch(() => {});
        }

        // ลบ prefix [Duty ID] ออกจากชื่อเล่น
        if (guildMember.nickname && guildMember.nickname.startsWith('[')) {
          const cleanedNick = guildMember.nickname.replace(/^\[.*?\]\s*/, '');
          await guildMember.setNickname(cleanedNick.slice(0, 32)).catch(() => {});
        }
      }
    } catch (e) {
      console.warn('[DISMISS_MEMBER] Discord role/nick error:', e.message);
    }
  }

  // บันทึก Log ไปยังห้อง #log
  await sendBotActionLog(guild, {
    title: '🚫 ปลดพ้นสภาพสารวัตรนักเรียน (คืนรหัสเวร)',
    description: `ปลดพ้นสภาพสารวัตรนักเรียนของ **${member.first_name} ${member.last_name} (${member.nickname})** คืนรหัสเวร \`[${freedDutyId || '-'}]\` สู่ระบบแล้ว`,
    fields: [
      { name: '👤 อดีตสารวัตร', value: `${member.first_name} ${member.last_name} (${member.nickname})`, inline: true },
      { name: '🆔 รหัสเวรที่คืน', value: `\`${freedDutyId || '-'}\``, inline: true },
      { name: '📅 ผลัดเวรเดิม', value: `${getDayName(freedDay)}`, inline: true }
    ],
    color: '#C0392B',
    actor: operatorId ? `<@${operatorId}>` : '⚙️ ระบบอัตโนมัติ'
  });

  return { success: true, member, freedDutyId, freedDay };
}

/**
 * ⛔ เมนูหลักเปิดระบบปลดหน้าที่ (รองรับทั้ง /demote และกดปุ่ม)
 */
async function handleOpenDemoteMenu(interaction, targetUser = null) {
  if (interaction.deferred || interaction.replied) {
    // already handled
  } else {
    await interaction.deferReply({ ephemeral: true });
  }

  if (targetUser) {
    const { data: member } = await supabase
      .from('members')
      .select('*')
      .eq('discord_id', targetUser.id)
      .eq('status', 'ACTIVE')
      .maybeSingle();

    if (!member) {
      await interaction.editReply({
        content: `⚠️ ไม่พบข้อมูลสารวัตรสถานะปกติของ <@${targetUser.id}> ในฐานข้อมูล (อาจยังไม่ได้รับการอนุมัติ หรือพ้นสภาพไปแล้ว)`,
        embeds: [],
        components: []
      });
      return;
    }

    return await renderDemoteLevelSelection(interaction, member);
  }

  const { data: members, error } = await supabase
    .from('members')
    .select('*')
    .eq('status', 'ACTIVE')
    .order('duty_day')
    .order('duty_id');

  if (error || !members || members.length === 0) {
    await interaction.editReply({
      content: '⚠️ ไม่มีข้อมูลสารวัตรที่ปฏิบัติหน้าที่อยู่ในระบบขณะนี้',
      embeds: [],
      components: []
    });
    return;
  }

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('select_demote_target_member')
    .setPlaceholder('🔍 เลือกสารวัตรที่ต้องการปลดหน้าที่ / ถอดยศ');

  members.slice(0, 25).forEach(m => {
    const dayText = getDayName(m.duty_day);
    const curRole = m.role === 'PRESIDENT' ? '👑 ประธาน' :
                    m.role === 'VICE_PRESIDENT' ? '🎖️ รองประธาน' :
                    m.shift_role === 'SHIFT_HEAD' ? '👑 หัวหน้าเวร' :
                    m.shift_role === 'SHIFT_DEPUTY' ? '🎖️ รองหัวหน้าเวร' : 'สารวัตรทั่วไป';

    selectMenu.addOptions({
      label: `[${m.duty_id || '-'}] ${m.nickname} (${m.first_name} ${m.last_name})`.slice(0, 100),
      description: `${dayText} | ตำแหน่ง: ${curRole}`.slice(0, 100),
      value: m.id
    });
  });

  const row = new ActionRowBuilder().addComponents(selectMenu);
  const cancelRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_cancel_demote')
      .setLabel('❌ ยกเลิก')
      .setStyle(ButtonStyle.Secondary)
  );

  const embed = new EmbedBuilder()
    .setTitle('⛔ เมนูปลดหน้าที่และถอดยศสารวัตรนักเรียน')
    .setDescription(
      'โปรดเลือกสารวัตรที่ต้องการดำเนินการจากเมนูด้านล่าง:\n\n' +
      '• **ระดับ 1 (🔻):** ปลดเฉพาะตำแหน่งผู้นำ (ประธาน/รองประธาน/หัวหน้าเวร) กลับเป็นสารวัตรทั่วไป\n' +
      '• **ระดับ 2 (🚫):** ปลดพ้นสภาพสารวัตร คืนรหัสเวรว่าง และถอดยศสารวัตรทั้งหมด'
    )
    .setColor('#E74C3C')
    .setFooter({ text: 'SARAWAT Command Center • ระบบปลดหน้าที่' });

  await interaction.editReply({
    embeds: [embed],
    components: [row, cancelRow]
  });
}

/**
 * 📋 แสดงตัวเลือก ระดับ 1 (ปลดผู้นำ) vs ระดับ 2 (ปลดพ้นสภาพ) ให้ผู้ใช้เลือก
 */
async function renderDemoteLevelSelection(interaction, member) {
  const dayText = getDayName(member.duty_day);
  const isLeader = member.role === 'PRESIDENT' ||
                   member.role === 'VICE_PRESIDENT' ||
                   member.shift_role === 'SHIFT_HEAD' ||
                   member.shift_role === 'SHIFT_DEPUTY';

  const roleText = member.role === 'PRESIDENT' ? '👑 ประธานสารวัตรนักเรียน' :
                   member.role === 'VICE_PRESIDENT' ? '🎖️ รองประธานสารวัตรนักเรียน' :
                   member.shift_role === 'SHIFT_HEAD' ? '👑 หัวหน้าเวร' :
                   member.shift_role === 'SHIFT_DEPUTY' ? '🎖️ รองหัวหน้าเวร' : '🛡️ สารวัตรนักเรียนทั่วไป';

  const embed = new EmbedBuilder()
    .setTitle('⛔ จัดการปลดหน้าที่ / ถอดยศสารวัตร')
    .setDescription(
      `👤 **สารวัตร:** **${member.first_name} ${member.last_name} (${member.nickname})**\n` +
      `🆔 **รหัสเวร:** \`[${member.duty_id || '-'}]\` | **ผลัดเวร:** ${dayText}\n` +
      `🎖️ **ตำแหน่งปัจจุบัน:** **${roleText}**\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `กรุณาเลือกระดับการปลดหน้าที่ที่ต้องการดำเนินการ:`
    )
    .setColor('#E67E22')
    .setFooter({ text: 'SARAWAT Demote System • โปรดยืนยันก่อนดำเนินการ' });

  const btnLevel1 = new ButtonBuilder()
    .setCustomId(`btn_demote_level_1_${member.id}`)
    .setLabel('🔻 ระดับ 1: ปลดเฉพาะตำแหน่งผู้นำ')
    .setStyle(ButtonStyle.Primary);

  if (!isLeader) {
    btnLevel1.setDisabled(true);
    btnLevel1.setLabel('🔻 ระดับ 1: ไม่ได้ดำรงตำแหน่งผู้นำ');
  }

  const btnLevel2 = new ButtonBuilder()
    .setCustomId(`btn_demote_level_2_${member.id}`)
    .setLabel('🚫 ระดับ 2: ปลดพ้นสภาพสารวัตร (ถอดยศ/คืนรหัส)')
    .setStyle(ButtonStyle.Danger);

  const btnCancel = new ButtonBuilder()
    .setCustomId('btn_cancel_demote')
    .setLabel('❌ ยกเลิก')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(btnLevel1, btnLevel2, btnCancel);

  if (interaction.isStringSelectMenu() || interaction.isButton()) {
    await interaction.update({
      embeds: [embed],
      components: [row]
    });
  } else {
    await interaction.editReply({
      embeds: [embed],
      components: [row]
    });
  }
}

client.once(Events.ClientReady || 'ready', async () => {
  const guildName = client.guilds.cache.get(process.env.GUILD_ID)?.name || 'Guild';
  console.log(`[SARAWAT-BOT] Online: ${client.user.tag} | ${guildName} | Port: ${PORT}`);

  try {
    client.user.setPresence({
      activities: [{
        name: '🛡️ ปฏิบัติหน้าที่สารวัตรนักเรียน | ร.ร.พระนารายณ์',
        type: ActivityType.Custom,
        state: '🛡️ ปฏิบัติหน้าที่สารวัตรนักเรียน | ร.ร.พระนารายณ์'
      }],
      status: 'online'
    });
  } catch (e) {}

  // ลงทะเบียน Discord Slash Commands (/) อัตโนมัติทันที
  try {
    const targetGuild = client.guilds.cache.get(process.env.GUILD_ID) || client.guilds.cache.first();
    const commandsJson = slashCommands.map(c => c.toJSON());
    if (targetGuild) {
      await targetGuild.commands.set(commandsJson);
      console.log(`[SARAWAT-BOT] Registered ${commandsJson.length} slash commands to guild: ${targetGuild.name}`);
    }
    // ล้าง Global Commands เพื่อป้องกันไม่ให้คำสั่งขึ้นซ้ำ 2 ชุดในเซิร์ฟเวอร์
    if (client.application) {
      await client.application.commands.set([]);
    }
  } catch (err) {
    console.warn('[SARAWAT-BOT] Slash commands registration notice:', err.message);
  }

  // 🧹 เมื่อบอทเริ่มทำงาน / รีสตาร์ต / อัปเดต: เคลียร์ข้อความเก่าและติดตั้งแผงฟีเจอร์เวอร์ชันล่าสุดทุกช่องอัตโนมัติ (ไม่ใช่ D-DAY ข้อมูลไม่หาย)
  try {
    const targetGuild = client.guilds.cache.get(process.env.GUILD_ID) || client.guilds.cache.first();
    if (targetGuild) {
      // ตรวจสอบและสร้างห้องคลังเก็บรูปสำรองถาวรสำหรับบอท
      await getOrCreatePhotoVaultChannel(targetGuild);
      console.log(`[STARTUP] 🧹 กำลังเคลียร์ข้อความเก่าและรีเฟรชแผงปุ่มฟีเจอร์อัตโนมัติใน: ${targetGuild.name}`);
      await refreshAllChannelsAndPanels(targetGuild, { purge: true });
      await purgeResolvedNotificationMessages(targetGuild);
    }
  } catch (err) {
    console.warn('[STARTUP] Auto-refresh channels notice:', err.message);
  }

  // ระบบ Keep-Alive Ping ตรวจสอบสถานะ Supabase ทุก 3 วัน (เงียบๆ ไม่รก Terminal)
  const pingTimer = setInterval(async () => {
    try {
      await supabase.from('members').select('id').limit(1);
    } catch (e) {}
  }, 1000 * 60 * 60 * 24 * 3);
  if (pingTimer.unref) pingTimer.unref();

  // 📸 ระบบตรวจสอบและอัปเดตการ์ด Discord อัตโนมัติเมื่อผู้ใช้ครอปรูปบนเว็บสำเร็จ (Auto-Reconciliation Realtime)
  const cropReconcileTimer = setInterval(async () => {
    if (pendingPhotoConfirmations.size === 0) return;
    try {
      const memberIds = Array.from(pendingPhotoConfirmations.keys());
      const { data: members } = await supabase
        .from('members')
        .select('id, first_name, last_name, nickname, duty_day, grade_class, student_no, photo_cropped_at, profile_image_url, status')
        .in('id', memberIds);

      if (!members || members.length === 0) return;

      const approvalChanId = process.env.APPROVAL_CHANNEL_ID || '1567570916932722778';

      for (const m of members) {
        const pending = pendingPhotoConfirmations.get(m.id);
        if (!pending) continue;

        // หากตรวจพบว่าผู้ใช้ครอปรูปแล้ว (photo_cropped_at เกิดขึ้นหลังการอัปโหลด)
        if (m.photo_cropped_at && new Date(m.photo_cropped_at).getTime() >= (pending.timestamp - 5000)) {
          pendingPhotoConfirmations.delete(m.id);

          // 📲 อัปเดตการ์ดยืนยันข้อมูลในห้องแชทเดิมโดยตรง เพื่อให้ผู้ใช้กดยืนยันในช่องได้ทันที
          if (pending.channelId && pending.promptMsgId) {
            try {
              const ch = await client.channels.fetch(pending.channelId).catch(() => null);
              if (ch) {
                const msg = await ch.messages.fetch(pending.promptMsgId).catch(() => null);
                if (msg) {
                  if (m.status === 'ACTIVE' || pending.isServiceUpdate) {
                    await msg.edit({
                      content: `✨ <@${pending.userId}> อัปเดตรูปถ่ายทำบัตรประจำตัว 3D สำเร็จเรียบร้อยแล้ว!`,
                      embeds: [{
                        title: '✨ อัปเดตรูปถ่ายทำบัตรประจำตัว 3D สำเร็จเรียบร้อยแล้ว!',
                        description:
                          `คุณ **${m.first_name} ${m.last_name} (${m.nickname || '-'})** ได้ตัดแต่งรูปถ่ายขนาด 1 นิ้ว (3:4) เรียบร้อยแล้ว!\n\n` +
                          `✅ บัตรประจำตัวสารวัตรดิจิทัล 3D ของคุณได้รับการอัปเดตรูปใหม่ทันที พร้อมสำรองเข้า Google Drive เรียบร้อยแล้ว`,
                        image: { url: m.profile_image_url },
                        color: 0x2ECC71,
                        footer: { text: 'ระบบบริการสารวัตร • โรงเรียนพระนารายณ์' }
                      }],
                      components: [{
                        type: 1,
                        components: [{
                          type: 2,
                          style: 5,
                          label: '🪪 เปิดดูบัตรประจำตัว 3D',
                          url: `${getBaseUrl()}/card?id=${m.id}`
                        }]
                      }]
                    }).catch(() => {});
                  } else {
                    const { embed, row } = buildPrivateReviewCard(m);
                    await msg.edit({
                      content: `🔒 <@${pending.userId}> ตัดแต่งรูปถ่ายขนาด 1 นิ้วเรียบร้อยแล้ว! โปรดตรวจสอบข้อมูลและกดยืนยันในช่องนี้ได้เลยครับ:`,
                      embeds: [embed],
                      components: [row]
                    }).catch(() => {});
                  }
                }
              }
            } catch (err) {}
          }

          // 📩 ส่งข้อความแจ้งเตือนสั้นๆ เข้า Direct Message (DM) ของผู้สมัคร เพื่อแจ้งเตือนให้กลับมากดยืนยันในช่อง
          if (pending.userId) {
            try {
              const targetUser = await client.users.fetch(pending.userId).catch(() => null);
              if (targetUser) {
                if (m.status === 'ACTIVE' || pending.isServiceUpdate) {
                  await targetUser.send({
                    embeds: [{
                      title: '✨ อัปเดตรูปถ่ายทำบัตรประจำตัว 3D สำเร็จเรียบร้อยแล้ว!',
                      description:
                        `คุณ **${m.first_name} ${m.last_name} (${m.nickname || '-'})** ได้ตัดแต่งรูปถ่ายขนาด 1 นิ้ว (3:4) เรียบร้อยแล้ว!\n\n` +
                        `✅ บัตรประจำตัวสารวัตรดิจิทัล 3D ของคุณได้รับการอัปเดตรูปใหม่ทันที`,
                      image: { url: m.profile_image_url },
                      color: 0x2ECC71,
                      footer: { text: 'ระบบบริการสารวัตร • โรงเรียนพระนารายณ์' }
                    }],
                    components: [{
                      type: 1,
                      components: [{
                        type: 2,
                        style: 5,
                        label: '🪪 เปิดดูบัตรประจำตัว 3D',
                        url: `${getBaseUrl()}/card?id=${m.id}`
                      }]
                    }]
                  }).catch(() => {});
                } else {
                  await targetUser.send({
                    content: `✨ <@${pending.userId}> คุณได้ตัดแต่งรูปถ่ายขนาด 1 นิ้วเรียบร้อยแล้ว!\n👉 **กรุณากลับไปกดยืนยันข้อมูลในช่อง <#${pending.channelId}>** เพื่อส่งคำขออนุมัติไปยังคณะผู้บริหารครับ`
                  }).catch(() => {});
                }
              }
            } catch (dmErr) {}
          }
        }
      }
    } catch (e) {}
  }, 5000);
  if (cropReconcileTimer.unref) cropReconcileTimer.unref();

  // ⏰ ระบบแจ้งเตือนเวรประจำวันอัตโนมัติ (Daily Duty Reminder) เวลา 06:30 น. (เวลาไทย UTC+7)
  let lastReminderDate = '';
  const reminderTimer = setInterval(async () => {
    try {
      const now = new Date();
      const bkkParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).formatToParts(now).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});

      const hours = parseInt(bkkParts.hour, 10);
      const minutes = parseInt(bkkParts.minute, 10);
      const todayKey = `${bkkParts.year}-${bkkParts.month}-${bkkParts.day}`;

      if (hours === 6 && minutes >= 30 && lastReminderDate !== todayKey) {
        lastReminderDate = todayKey;
        const targetGuild = client.guilds.cache.get(process.env.GUILD_ID) || client.guilds.cache.first();
        if (targetGuild) {
          console.log(`[SCHEDULE] ⏰ เริ่มส่งข้อความแจ้งเตือนเวรประจำวันอัตโนมัติ (${todayKey}) [เวลาไทย: ${bkkParts.hour}:${bkkParts.minute}]`);
          await sendDailyDutyReminders(targetGuild, { dryRun: false });
        }
      }
    } catch (e) {
      console.warn('[SCHEDULE] Daily reminder error:', e.message);
    }
  }, 60 * 1000);
  if (reminderTimer.unref) reminderTimer.unref();
});

// ==========================================================
// 📌 คำสั่งตั้งค่าปุ่มเริ่มต้นในห้องต่างๆ
// ==========================================================
client.on('messageCreate', async (message) => {
  // ตรวจจับการส่งไฟล์คลิป Bodycam หรือภาพถ่ายหลักฐานพร้อมระบุรหัสคดี (เช่น CASE-1234 หรือ INSP-1234 ในเธรด)
  if (message.attachments.size > 0 && !message.author.bot) {
    let match = message.content.match(/(CASE|INSP)-\d+/i);
    if (!match && message.channel.isThread && message.channel.isThread() && message.channel.name) {
      match = message.channel.name.match(/(CASE|INSP)-\d+/i);
    }
    if (match) {
      const caseId = match[0].toUpperCase();
      const urls = message.attachments.map(att => att.url);
      const { data: c } = await supabase.from('cases').select('*').eq('case_id', caseId).maybeSingle();
      if (c) {
        const merged = [...(c.evidence_urls || []), ...urls];
        const isFirstPatrolPhoto = (c.status === 'PATROL_WAITING_PHOTO');

        await supabase.from('cases').update({
          evidence_urls: merged,
          status: isFirstPatrolPhoto ? 'PATROL_WAITING_APPROVAL' : c.status,
          resolution_notes: (c.resolution_notes ? c.resolution_notes + '\n' : '') + `[แนบไฟล์หลักฐานโดย ${message.author.username}]: ${urls.join(' , ')}`
        }).eq('case_id', caseId);

        if (isFirstPatrolPhoto) {
          // ดึงข้อมูลสารวัตรผู้ขออนุมัติ
          let requestingMember = null;
          if (c.assigned_officer_id) {
            const { data: m } = await supabase.from('members').select('*').eq('id', c.assigned_officer_id).maybeSingle();
            requestingMember = m;
          }
          if (!requestingMember) {
            const { data: m } = await supabase.from('members').select('*').eq('discord_id', message.author.id).order('updated_at', { ascending: false }).limit(1).maybeSingle();
            requestingMember = m;
          }

          // 🌟 ใช้รูปโปรไฟล์ที่ผู้ใช้งานส่งในช่องส่งรูปทำบัตรเป็นหลัก (profile_image_url)
          const profilePhoto = requestingMember?.profile_image_url || requestingMember?.photo_url || requestingMember?.profile_photo_url || message.author.displayAvatarURL({ dynamic: true, size: 512 });
          const officerDisplay = requestingMember
            ? `[${requestingMember.duty_id || 'สารวัตร'}] คุณ${requestingMember.nickname} (${requestingMember.first_name} ${requestingMember.last_name || ''})`
            : message.author.username;

          const periodMatch = c.description ? c.description.match(/ช่วงเวลา: (.*?)\n/) : null;
          const officersMatch = c.description ? c.description.match(/ผู้ร่วมตรวจ: (.*?)\n/) : null;
          const periodText = periodMatch ? periodMatch[1] : 'ตามเวร';
          const officersText = officersMatch ? officersMatch[1] : 'ปฏิบัติหน้าที่คนเดียว';

          // สร้างการ์ดขออนุมัติออกตรวจ
          const approvalEmbed = new EmbedBuilder()
            .setTitle(`🛡️ [คำขออนุมัติออกตรวจ] รหัสเคส: ${caseId}`)
            .setAuthor({ name: `สารวัตรผู้ขออนุมัติ: ${officerDisplay}`, iconURL: profilePhoto })
            .setThumbnail(profilePhoto)
            .setDescription(
              `### 📋 รายละเอียดการขอออกตรวจพื้นที่\n\n` +
              `👮 **สารวัตรผู้ขออนุมัติ:** ${officerDisplay} (<@${message.author.id}>)\n` +
              `📍 **จุดตรวจ:** **${c.location}**\n` +
              `⏰ **ช่วงเวลา:** **${periodText}**\n` +
              `👥 **ผู้ร่วมตรวจ:** ${officersText}\n` +
              `📸 **ภาพหลักฐานเข้าพื้นที่:** ได้รับแล้ว (${urls.length} ภาพ - แสดงด้านล่าง)\n\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `⏳ **สถานะ:** **รอการตรวจสอบและอนุมัติจากหัวหน้า**\n` +
              `*(ขอเชิญประธาน, รองประธาน หรือหัวหน้าเวร ตรวจสอบภาพและกดปุ่มอนุมัติด้านล่าง)*`
            )
            .setColor('#F1C40F')
            .setThumbnail(profilePhoto)
            .setImage(urls[0])
            .setFooter({ text: `PATROL APPROVAL REQUIRED • ${caseId}` })
            .setTimestamp();

          const approvalRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`btn_approve_insp_${caseId}`)
              .setLabel('อนุมัติ')
              .setStyle(ButtonStyle.Success)
              .setEmoji('✅'),
            new ButtonBuilder()
              .setCustomId(`btn_reject_insp_${caseId}`)
              .setLabel('ไม่อนุมัติ')
              .setStyle(ButtonStyle.Danger)
              .setEmoji('❌')
          );

          // 1. ส่งการ์ดขออนุมัติลงในห้องเคสเธรด
          const threadApprovalMsg = await message.channel.send({ embeds: [approvalEmbed], components: [approvalRow] }).catch(() => null);

          // 2. ส่งการ์ดแจ้งเตือนเข้าห้องประชุมหัวหน้า
          const chLeader = findChannel(message.guild, '👑│ห้องประชุมหัวหน้า') ||
                           findChannel(message.guild, 'ห้องประชุมหัวหน้า') ||
                           findChannel(message.guild, '👑│ผู้นำ-all-in-one');
          let leaderApprovalMsg = null;
          if (chLeader && chLeader.isTextBased()) {
            leaderApprovalMsg = await chLeader.send({
              content: `🚨 **แจ้งเตือนหัวหน้าทุกคน:** มีคำขออนุญาตออกตรวจพื้นที่ใหม่จาก <@${message.author.id}> (${officerDisplay})\n👉 โปรดตรวจสอบภาพหลักฐานและกดอนุมัติที่การ์ดด้านล่าง หรือในเธรด <#${message.channel.id}>`,
              embeds: [approvalEmbed],
              components: [approvalRow]
            }).catch(() => null);
          }

          pendingApprovalMessages.set(caseId, {
            threadChannelId: message.channel.id,
            threadMsgId: threadApprovalMsg?.id,
            leaderChannelId: chLeader?.id,
            leaderMsgId: leaderApprovalMsg?.id
          });
        } else {
          await message.reply({ content: `✅ บันทึกไฟล์หลักฐาน/คลิป Bodycam จำนวน ${urls.length} ไฟล์ เข้าเคส **${caseId}** สำเร็จแล้ว!` }).catch(() => {});
        }
      }
    }
  }

  // ตรวจจับข้อความแจ้งเหตุจาก Google Form Webhook ในห้อง #🔔│แจ้งเหตุใหม่-google-form
  if (message.channel.id === (process.env.INCIDENT_CHANNEL_ID || '1567570890084843530')) {
    if (message.webhookId && message.embeds && message.embeds.length > 0) {
      const embed = message.embeds[0];
      const title = embed.title || '';
      const match = title.match(/CASE-\d+/);
      if (match) {
        const caseId = match[0];
        try {
          await message.react('🚨').catch(() => {});
          await message.react('⏳').catch(() => {});

          // Auto-sync into Supabase cases table if not exists (Failsafe guarantee)
          try {
            const { data: existing } = await supabase.from('cases').select('case_id').eq('case_id', caseId).maybeSingle();
            if (!existing) {
              let reporter = 'ไม่ประสงค์ออกนาม';
              let email = 'anonymous@pranarai.ac.th';
              let contact = '-';
              let details = 'ไม่มีรายละเอียด';
              const evidence = [];

              if (embed.fields) {
                embed.fields.forEach(f => {
                  if (f.name.includes('ผู้ส่ง')) reporter = f.value;
                  if (f.name.includes('อีเมล')) email = f.value;
                  if (f.name.includes('ติดต่อ')) contact = f.value;
                  if (f.name.includes('เรื่อง')) details = f.value;
                  if (f.name.includes('หลักฐาน')) {
                    const m = f.value.match(/https?:\/\/[^\s\)]+/);
                    if (m) evidence.push(m[0]);
                  }
                });
              }

              const isUrgent = title.includes('เหตุด่วน') || details.includes('บุหรี่') || details.includes('ยา') || details.includes('อาวุธ') || details.includes('ตีกัน');
              await supabase.from('cases').insert({
                case_id: caseId,
                reporter_email: email,
                reporter_name: reporter,
                incident_date_time: new Date().toISOString(),
                location: (contact && contact !== '-' && String(contact).trim() !== '') ? String(contact).trim() : 'ไม่ระบุ',
                category: isUrgent ? 'เหตุด่วนความปลอดภัย' : 'แจ้งเหตุทั่วไป',
                description: details,
                evidence_urls: evidence,
                status: 'PENDING'
              });
              console.log(`[INCIDENT AUTO-SYNC] Successfully synced ${caseId} to Supabase database`);
            }
          } catch (syncErr) {
            console.warn('[INCIDENT DB SYNC ERROR]', syncErr.message);
          }

          const thread = await message.startThread({
            name: `คดี [${caseId}] ติดตามและมอบหมายเวร`,
            autoArchiveDuration: 1440
          }).catch(() => null);

          if (thread) {
            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`btn_assign_case_${caseId}`)
                .setLabel('👮 มอบหมายเวร')
                .setStyle(ButtonStyle.Primary),
              new ButtonBuilder()
                .setCustomId(`btn_close_case_${caseId}`)
                .setLabel('📁 ปิดคดี')
                .setStyle(ButtonStyle.Success)
            );

            await thread.send({
              content: `👮 **ศูนย์ติดตามและประสานงานคดี \`[${caseId}]\`**\n` +
                       `กดปุ่มด้านล่างเพื่อมอบหมายเวรรับผิดชอบ หรือปิดคดีเมื่อดำเนินการเสร็จสิ้น`,
              components: [row]
            }).catch(() => {});
          }
        } catch (e) {
          console.warn('[INCIDENT AUTO-THREAD ERROR]', e.message);
        }
      }
    }
  }

  if (message.author.bot) return;

  // คำสั่งเช็คสถานะระบบ SARAWAT-BOT
  if (message.content === '!status' || message.content === '!sarawat') {
    const { count: memberCount } = await supabase.from('members').select('*', { count: 'exact', head: true });
    const { count: activeCount } = await supabase.from('members').select('*', { count: 'exact', head: true }).eq('status', 'ACTIVE');
    const { count: leaveCount } = await supabase.from('leave_requests').select('*', { count: 'exact', head: true });

    const statusEmbed = new EmbedBuilder()
      .setTitle('🛡️ สถานะระบบ SARAWAT-BOT | โรงเรียนพระนารายณ์')
      .setColor('#2ECC71')
      .addFields(
        { name: '🤖 บอทประจำการ', value: `${client.user.tag}`, inline: true },
        { name: '🌐 เซิร์ฟเวอร์', value: `${message.guild?.name || 'SARAWAT'}`, inline: true },
        { name: '⚡ ระบบฐานข้อมูล', value: '🟢 Supabase Online', inline: true },
        { name: '🎓 ภาคเรียนปัจจุบัน', value: `${getSettings().current_semester}`, inline: true },
        { name: '👥 สารวัตรทั้งหมด', value: `${memberCount || 0} คน`, inline: true },
        { name: '✅ ยืนยันตัวตนแล้ว', value: `${activeCount || 0} คน`, inline: true },
        { name: '📝 ประวัติการลา', value: `${leaveCount || 0} รายการ`, inline: true }
      )
      .setFooter({ text: 'SARAWAT-BOT Core API • โรงเรียนพระนารายณ์' })
      .setTimestamp();

    await message.reply({ embeds: [statusEmbed] });
    return;
  }

  // คำสั่งตรวจสอบภาคเรียนปัจจุบัน
  if (message.content === '!semester' || message.content === '!term') {
    const sem = getSettings().current_semester;
    await message.reply({
      content: `🎓 **ภาคเรียนปัจจุบัน:** ${sem} (กำหนดโดยประธานสารวัตรนักเรียน)`
    });
    return;
  }

  // คำสั่งล้างระบบของหาย: !killfile หรือ /KillFile (แบบข้อความ)
  if (message.content === '!killfile' || message.content === '/killfile' || message.content === '/KillFile') {
    const isAdmin = message.member?.permissions.has(PermissionsBitField.Flags.Administrator) ||
                    message.guild?.ownerId === message.author.id;
    if (!isAdmin) {
      await message.reply('⛔ สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถใช้คำสั่งล้างระบบของหายได้');
      return;
    }

    const killEmbed = new EmbedBuilder()
      .setTitle('🗑️ ยืนยันการล้างข้อมูลระบบของหาย (KILLFILE RESET)')
      .setDescription(
        `⚠️ **คำเตือนความปลอดภัย (DESTRUCTIVE ACTION)**\n\n` +
        `คุณกำลังจะลบข้อมูลสิ่งของและคำร้องทั้งหมดในระบบของหาย **เริ่มใหม่แต่ 0**:\n\n` +
        `  • 📦 **สิ่งของที่บันทึกไว้ทั้งหมด** ในฐานข้อมูลและแคชจะถูกลบถาวร\n` +
        `  • 📋 **ประวัติคำร้องขอรับของคืน** จะถูกล้างทั้งหมด\n` +
        `  • 📸 **ภาพหลักฐานการส่งมอบ** ในเครื่องจะถูกเคลียร์\n` +
        `  • 🔄 **ห้อง 📦│แจ้งพบของหาย** จะถูกล้างข้อความเก่าและติดตั้งแผงคู่มือใหม่\n\n` +
        `*(ข้อมูลสารวัตรนักเรียน คดี และการลาเวรจะไม่ได้รับผลกระทบ)*\n\n` +
        `**หากแน่ใจ ให้กดปุ่มยืนยันด้านล่างเพื่อเริ่มกระบวนการ**`
      )
      .setColor('#E74C3C')
      .setFooter({ text: 'SARAWAT LOST & FOUND • KillFile Reset System' });

    const killRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('btn_killfile_confirm')
        .setLabel('🗑️ ยืนยันลบทั้งหมด (เริ่มใหม่แต่ 0)')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('btn_killfile_cancel')
        .setLabel('❌ ยกเลิก')
        .setStyle(ButtonStyle.Secondary)
    );

    await message.reply({ embeds: [killEmbed], components: [killRow] });
    return;
  }

  // คำสั่งซิงค์ยศจาก Supabase สู่ Discord สำหรับทุกคน
  if (message.content === '!sync-roles' || message.content === '!sync') {
    if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
      await message.reply({ content: '⛔ สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น' });
      return;
    }

    const res = await syncAllMemberRoles(message.guild);
    if (!res.success) {
      await message.reply({ content: res.message });
    } else if (res.hasPermissionError) {
      await message.reply({
        content: `⚠️ ซิงค์สำเร็จ ${res.successCount} คน / ล้มเหลว ${res.failCount} คน\n` +
          `**สาเหตุ:** บอทไม่มีสิทธิ์แจกยศเนื่องจาก **ลำดับยศ SARAWAT-BOT อยู่ต่ำกว่ายศที่ต้องแจก**\n` +
          `👉 **วิธีแก้:** ไปที่ Server Settings > Roles > ลากยศ **SARAWAT-BOT** ขึ้นไปไว้ด้านบนสุด แล้วพิมพ์ \`!sync-roles\` ใหม่อีกครั้ง`
      });
    } else {
      await message.reply({
        content: `✅ ซิงค์ยศและชื่อเรียบร้อย: สำเร็จ ${res.successCount} คน`
      });
    }
    return;
  }

  // คำสั่ง D-DAY (Text Prefix Mode)
  if (message.content === '!d-day' || message.content === '!dday') {
    if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator) && message.guild?.ownerId !== message.author.id) {
      await message.reply({ content: '⛔ สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น' });
      return;
    }

    const ddayEmbed = new EmbedBuilder()
      .setTitle('🚨 ปฏิบัติการ D-DAY: รีเซ็ตระบบสารวัตรสู่จุดเริ่มต้น (0)')
      .setDescription(
        `⚠️ **คำเตือนความปลอดภัยขั้นสูงสุด (DESTRUCTIVE ACTION)**\n\n` +
        `คุณกำลังจะสั่งการล้างระบบสารวัตรนักเรียนทั้งหมด ข้อมูลต่อไปนี้จะถูกรีเซ็ตอย่างถาวร:\n\n` +
        `• 🗑️ **ฐานข้อมูล:** ลบข้อมูลสารวัตรทุกคนใน \`members\`, \`leave_requests\`, และ \`cases\`\n` +
        `• 🔄 **รหัสเวร:** เริ่มต้นนับ 1 ใหม่ (เช่น M1, T1, Ts1, S1)\n` +
        `• 🛡️ **ยศ Discord:** ปลดบทบาทสารวัตรและรีเซ็ตชื่อเล่นของทุกคน\n` +
        `• 🧹 **ช่องแชท:** ล้างข้อความเก่าและติดตั้งแผงระบบใหม่ในทุกช่องแชท\n\n` +
        `**หากแน่ใจ ให้กดปุ่มสีแดงด้านล่างและกรอกรหัสยืนยันเพื่อเริ่มปฏิบัติการ**`
      )
      .setColor('#ED4245')
      .setFooter({ text: 'SARAWAT-PRANARAI OS • Security Gate' })
      .setTimestamp();

    const ddayRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('btn_dday_request_confirm')
        .setLabel('🚨 เริ่มต้นกระบวนการ D-DAY')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('btn_dday_cancel')
        .setLabel('❌ ยกเลิก')
        .setStyle(ButtonStyle.Secondary)
    );

    await message.reply({ embeds: [ddayEmbed], components: [ddayRow] });
    return;
  }

  // 📦 ฟังก์ชันดักรับรูปถ่ายสิ่งของที่พบในห้อง #📦│แจ้งพบของหาย
  const isLostFoundChannel = message.channel && message.channel.name && message.channel.name.includes('ของหาย');
  if (isLostFoundChannel && !message.author.bot && message.attachments.size > 0) {
    const attachment = message.attachments.first();
    const isImage = (attachment.contentType && attachment.contentType.startsWith('image/')) ||
                    /\.(jpe?g|png|webp|gif|heic)$/i.test(attachment.name || attachment.url);
    if (isImage) {
      try {
        const reportId = `rep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

        // รายการหมวดหมู่เริ่มต้น
        let categories = [
          { label: 'กระเป๋า / กระเป๋าสตางค์', value: 'กระเป๋า / กระเป๋าสตางค์', emoji: '👛' },
          { label: 'อุปกรณ์ไอที / มือถือ', value: 'อุปกรณ์ไอที / มือถือ', emoji: '📱' },
          { label: 'กุญแจ / ยานพาหนะ', value: 'กุญแจ / ยานพาหนะ', emoji: '🔑' },
          { label: 'เครื่องแต่งกาย / หมวก', value: 'เครื่องแต่งกาย / หมวก', emoji: '👕' },
          { label: 'เครื่องเขียน / หนังสือ', value: 'เครื่องเขียน / หนังสือ', emoji: '📚' },
          { label: 'สิ่งของทั่วไป / อื่นๆ', value: 'สิ่งของทั่วไป / อื่นๆ', emoji: '📦' }
        ];

        try {
          const { data: dbCats } = await supabase.from('lost_categories').select('name, icon').order('name');
          if (dbCats && dbCats.length > 0) {
            categories = dbCats.map(c => ({
              label: c.name.slice(0, 50),
              value: c.name.slice(0, 50),
              emoji: c.icon || '📦'
            }));
          }
        } catch (e) {}

        const selectOptions = [
          ...categories.slice(0, 24).map(c => ({
            label: c.label,
            value: c.value,
            emoji: c.emoji || '📦'
          })),
          {
            label: '➕ เพิ่มหมวดหมู่ใหม่...',
            value: '__NEW_CATEGORY__',
            description: 'พิมพ์ระบุชื่อหมวดหมู่ใหม่ด้วยตนเอง',
            emoji: '✨'
          }
        ];

        const row = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`select_lost_cat_${reportId}`)
            .setPlaceholder('📂 โปรดเลือกหมวดหมู่สิ่งของ...')
            .addOptions(selectOptions)
        );

        const replyEmbed = new EmbedBuilder()
          .setTitle('📦 บันทึกข้อมูลสิ่งของที่พบ')
          .setDescription(
            `ตรวจพบรูปภาพจาก **<@${message.author.id}>** เรียบร้อยแล้ว!\n\n` +
            `👉 **ขั้นตอนถัดไป:** โปรดเลือก **หมวดหมู่** จากเมนูด้านล่าง เพื่อเปิดกล่องระบุชื่อสิ่งของและสถานที่พบ`
          )
          .setThumbnail(attachment.url)
          .setColor('#3498DB')
          .setFooter({ text: 'กรุณาเลือกหมวดหมู่ภายใน 5 นาที' });

        const promptReplyMsg = await message.reply({ embeds: [replyEmbed], components: [row] });

        pendingLostReports.set(reportId, {
          userId: message.author.id,
          attachmentUrl: attachment.url,
          proxyUrl: attachment.proxyURL || attachment.url,
          attachmentName: attachment.name || 'lost_item.jpg',
          channelId: message.channel.id,
          messageId: message.id,
          promptMessageId: promptReplyMsg.id,
          timestamp: Date.now()
        });

        // ล้างข้อความ prompt ตัวเลือกหมวดหมู่ออกอัตโนมัติเมื่อหมดเวลา 5 นาที (หากไม่ได้ทำรายการ)
        setTimeout(async () => {
          if (pendingLostReports.has(reportId)) {
            pendingLostReports.delete(reportId);
            try {
              if (promptReplyMsg && promptReplyMsg.deletable) {
                await promptReplyMsg.delete().catch(() => {});
              }
            } catch (e) {}
          }
        }, 5 * 60 * 1000);

        return;
      } catch (err) {
        console.error('[LOST-FOUND ERROR]', err);
      }
    }
  }

  // ==========================================================
  // 🛎️ ระบบ Auto-Clean Guard และรับรูปถ่ายในห้องศูนย์บริการสารวัตร (# 🛎️│บริการสารวัตร)
  // ==========================================================
  const isServiceHubChannel = message.channel && message.channel.name && (
    message.channel.name.includes('บริการสารวัตร') ||
    (process.env.SERVICE_HUB_CHANNEL_ID && message.channel.id === process.env.SERVICE_HUB_CHANNEL_ID)
  );

  if (isServiceHubChannel && !message.author.bot) {
    const session = activeServicePhotoSessions.get(message.author.id);
    const now = Date.now();

    // กรณีไม่มี Session หรือ Session หมดอายุเกิน 5 นาที
    if (!session || (now - session.timestamp > 5 * 60 * 1000)) {
      if (session) activeServicePhotoSessions.delete(message.author.id);
      await message.delete().catch(() => {});
      const warnMsg = await message.channel.send({
        content: `⚠️ <@${message.author.id}> ช่องนี้สงวนไว้สำหรับการกดทำรายการผ่านปุ่มบริการเท่านั้น (ระบบได้ลบข้อความของคุณอัตโนมัติ เพื่อรักษาความสะอาดของห้อง)`
      }).catch(() => null);
      if (warnMsg) setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
      return;
    }

    // กรณีมี Session แต่ไม่ได้แนบไฟล์รูปภาพมา (เช่น พิมพ์แชทคุย)
    if (message.attachments.size === 0) {
      await message.delete().catch(() => {});
      const warnMsg = await message.channel.send({
        content: `⚠️ <@${message.author.id}> กรุณาแนบส่ง **ไฟล์รูปถ่ายหน้าตรง** เท่านั้นครับ (ระบบได้ลบข้อความตัวอักษรของคุณอัตโนมัติ)`
      }).catch(() => null);
      if (warnMsg) setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
      return;
    }

    // มี Session และแนบไฟล์รูปภาพเข้ามา -> ตรวจสอบชนิดไฟล์
    const attachment = message.attachments.first();
    const isImage = (attachment.contentType && attachment.contentType.startsWith('image/')) ||
                    /\.(jpe?g|png|webp|gif|heic)$/i.test(attachment.name || attachment.url);
    if (!isImage) {
      await message.delete().catch(() => {});
      const warnMsg = await message.channel.send({
        content: `⚠️ <@${message.author.id}> ไฟล์ที่คุณส่งไม่ใช่ไฟล์รูปภาพ กรุณาส่งไฟล์รูปภาพ (JPG, PNG, WEBP) เท่านั้นครับ`
      }).catch(() => null);
      if (warnMsg) setTimeout(() => warnMsg.delete().catch(() => {}), 5000);
      return;
    }

    try {
      // 1. ดาวน์โหลดไฟล์รูปภาพเข้า Memory Buffer ก่อนลบข้อความ
      const imgRes = await fetch(attachment.url);
      if (!imgRes.ok) throw new Error(`ไม่สามารถดาวน์โหลดรูปภาพจาก Discord ได้ (Status ${imgRes.status})`);
      const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

      // 2. ลบข้อความรูปภาพของผู้ใช้เพื่อความสะอาดห้อง
      await message.delete().catch(() => {});

      const member = session.member;
      const extMatch = (attachment.name || attachment.url).match(/\.(jpe?g|png|webp|gif|heic)/i);
      const ext = extMatch ? extMatch[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
      const safeDutyId = (member.duty_id || member.id || 'photo').replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `member_${safeDutyId}_${Date.now()}.${ext}`;

      // 3. บันทึกสำเนาลง Local Storage สำหรับ Web Server
      const uploadDir = path.join(__dirname, '..', 'web', 'public', 'uploads');
      try {
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        fs.writeFileSync(path.join(uploadDir, filename), imgBuffer);
      } catch (fsErr) {
        console.warn('[SERVICE PHOTO] Local save notice:', fsErr.message);
      }

      // 4. อัปโหลดเข้าสู่ Supabase Storage (Bucket: sarawat-photos)
      let permanentUrl = null;
      try {
        const storagePath = `members/${filename}`;
        const { error: storageErr } = await supabase.storage
          .from('sarawat-photos')
          .upload(storagePath, imgBuffer, {
            contentType: attachment.contentType || (ext === 'png' ? 'image/png' : 'image/jpeg'),
            upsert: true
          });
        if (!storageErr) {
          const { data: { publicUrl } } = supabase.storage.from('sarawat-photos').getPublicUrl(storagePath);
          permanentUrl = publicUrl;
        }
      } catch (sErr) {}

      // 5. สำรองไฟล์เข้าห้องคลังรูปสำรองลับของบอท
      const vaultChannel = await getOrCreatePhotoVaultChannel(message.guild);
      let vaultAttachmentUrl = null;
      if (vaultChannel) {
        try {
          const vaultAttachment = new AttachmentBuilder(imgBuffer, { name: filename });
          const vaultEmbed = new EmbedBuilder()
            .setTitle('📸 สำรองรูปถ่ายทำบัตรประจำตัว (บริการปรับรูปสารวัตร)')
            .setDescription(
              `• สมาชิก: **${member.first_name} ${member.last_name} (${member.nickname})**\n` +
              `• รหัสเวร: \`${member.duty_id || '-'}\` • บัญชี Discord: <@${message.author.id}>\n` +
              `• บันทึกเวลา: <t:${Math.floor(Date.now() / 1000)}:F>`
            )
            .setImage(`attachment://${filename}`)
            .setColor('#2ECC71');
          const vaultMsg = await vaultChannel.send({ embeds: [vaultEmbed], files: [vaultAttachment] });
          if (vaultMsg.attachments.size > 0) {
            vaultAttachmentUrl = vaultMsg.attachments.first().url;
          }
        } catch (vErr) {}
      }

      // 6. สำรองไฟล์ภาพเข้าสู่ Google Drive
      let gdriveFileId = null;
      let gdriveFileUrl = null;
      try {
        const gdriveRes = await uploadToGoogleDrive(imgBuffer, filename, {
          memberName: `${member.first_name || ''} ${member.last_name || ''}`.trim() || member.nickname,
          dutyId: member.duty_id || '-'
        });
        if (gdriveRes && gdriveRes.success) {
          gdriveFileId = gdriveRes.fileId;
          gdriveFileUrl = gdriveRes.webViewLink;
        }
      } catch (gdErr) {}

      const finalProfileUrl = permanentUrl || vaultAttachmentUrl || `/uploads/${filename}`;

      // 7. สร้าง Token ชั่วคราว (15 นาที) สำหรับเปิดเว็บเครื่องมือครอปรูป 1 นิ้ว (3:4)
      const cropToken = crypto.randomBytes(32).toString('hex');
      const tokenExpires = new Date(Date.now() + 15 * 60 * 1000);
      const cropUrl = `${getWebDashboardUrl()}/crop?token=${cropToken}`;

      // 8. แสดงการ์ดพรีวิวรูปภาพ พร้อม 2 ปุ่ม (ครอบรูป 1 นิ้ว / เปลี่ยนรูปใหม่)
      const isSpecial = member.duty_day && member.duty_day.endsWith('S');
      const weekday = member.duty_day ? (member.duty_day === 'TSS' ? 'Ts' : member.duty_day.replace(/S+$/, '') || member.duty_day) : 'M';
      const weekdayName = DAY_NAMES[weekday] || weekday;
      const shiftLabel = getShiftLabel(member.duty_day);

      const previewEmbed = new EmbedBuilder()
        .setTitle('📸 ตรวจสอบรูปถ่าย & ปรับเปลี่ยนบัตรประจำตัว 3D')
        .setDescription(
          `สวัสดีครับคุณ **${member.first_name} ${member.last_name} (${member.nickname})**\n` +
          `บอทได้รับรูปถ่ายใหม่ของคุณเรียบร้อยแล้ว กรุณาเลือกดำเนินการ 1 ใน 2 ตัวเลือกด้านล่าง:\n\n` +
          `1️⃣ **[🔲 ปรับแต่ง/ครอบรูป (ขนาด 1 นิ้ว)]** — กดเพื่อเปิดหน้าเว็บจัดสัดส่วนใบหน้า 3:4 (ขนาด 1 นิ้ว) ให้พอดีกับกรอบบัตรประจำตัว 3D\n` +
          `2️⃣ **[🔄 เปลี่ยนรูปภาพใหม่]** — กดหากต้องการยกเลิกรูปนี้ และส่งรูปถ่ายหน้าตรงรูปใหม่อีกครั้ง`
        )
        .addFields(
          {
            name: '👤 ข้อมูลสารวัตร',
            value: `• ชื่อ-สกุล: **${member.first_name} ${member.last_name}**\n• ชื่อเล่น: **${member.nickname || '-'}**\n• รหัสเวร: \`[${member.duty_id || 'สารวัตร'}]\``,
            inline: true
          },
          {
            name: '🛡️ ข้อมูลเวรประจำวัน',
            value: `• วันประจำการ: **วัน${weekdayName} (${weekday})**\n• ผลัดเวร: **${shiftLabel}** ${isSpecial ? '⭐' : ''}`,
            inline: true
          },
          {
            name: '📸 สถานะและการอัปเดตบัตร',
            value: `💡 **เมื่อกดครอบรูปและกดยืนยันบนเว็บ บัตรประจำตัว 3D จะอัปเดตรูปใหม่ทันที!** พร้อมสำรองรูปเข้า Google Drive ของโรงเรียนอัตโนมัติ`,
            inline: false
          }
        )
        .setImage(finalProfileUrl.startsWith('http') ? finalProfileUrl : attachment.url)
        .setColor('#2ECC71')
        .setFooter({ text: 'ระบบบริการสารวัตร • โรงเรียนพระนารายณ์' })
        .setTimestamp();

      const photoActionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('🔲 ปรับแต่ง/ครอบรูป (ขนาด 1 นิ้ว)')
          .setStyle(ButtonStyle.Link)
          .setURL(cropUrl),
        new ButtonBuilder()
          .setCustomId(`btn_reupload_photo_${member.id}`)
          .setLabel('🔄 เปลี่ยนรูปภาพใหม่')
          .setStyle(ButtonStyle.Danger)
      );

      const promptMsg = await message.channel.send({
        content: `📸 <@${message.author.id}> ได้รับรูปถ่ายใหม่ของคุณเรียบร้อยแล้ว! กรุณาเลือกดำเนินการด้านล่าง:`,
        embeds: [previewEmbed],
        components: [photoActionRow]
      });

      // บันทึก crop_tokens พร้อมแนบ discord_meta สำหรับ Realtime Update
      try {
        await supabase.from('crop_tokens').insert({
          token: cropToken,
          member_id: member.id,
          discord_id: message.author.id,
          source_image_url: `${finalProfileUrl.startsWith('http') ? finalProfileUrl : attachment.url}#discord_meta:${message.channel.id}:${promptMsg?.id || ''}`,
          expires_at: tokenExpires.toISOString()
        });
      } catch (tokenErr) {
        console.warn('[CROP TOKEN NOTICE]:', tokenErr.message);
      }

      // ลบ session ออกหลังจากรับรูปเรียบร้อย
      activeServicePhotoSessions.delete(message.author.id);

      // บันทึก pending สำหรับปุ่มเปลี่ยนรูป
      pendingPhotoConfirmations.set(member.id, {
        member,
        photoUrl: finalProfileUrl,
        filename: filename,
        userId: message.author.id,
        cropUrl: cropUrl,
        promptMsgId: promptMsg?.id,
        channelId: message.channel.id,
        isServiceUpdate: true,
        timestamp: Date.now()
      });
      return;
    } catch (err) {
      console.error('[SERVICE PHOTO PROCESS ERROR]:', err);
      const errNotice = await message.channel.send({
        content: `⚠️ <@${message.author.id}> เกิดข้อผิดพลาดในการประมวลผลรูปถ่าย: \`${err.message || 'ระบบขัดข้อง'}\` กรุณาลองใหม่อีกครั้งครับ`
      }).catch(() => null);
      if (errNotice) setTimeout(() => errNotice.delete().catch(() => {}), 15000);
      return;
    }
  }

  // ฟังก์ชันดักรับรูปโปรไฟล์ทำบัตรในห้อง #🛡️│ลงทะเบียนสารวัตรใหม่
  const isVaultChannel = message.channel && message.channel.name && (
    message.channel.name === PHOTO_VAULT_CHANNEL_NAME ||
    message.channel.name.includes('คลังเก็บรูปสำรอง')
  );
  if (isVaultChannel) return;

  const isRegistrationChannel = (VERIFY_CHANNEL_ID && message.channel.id === VERIFY_CHANNEL_ID) ||
    (PHOTO_CHANNEL_ID && message.channel.id === PHOTO_CHANNEL_ID) ||
    (message.channel.id === '1567570864835264542') ||
    (message.channel.id === '1567570866663989389') ||
    (message.channel && message.channel.name && (
      message.channel.name.includes('ลงทะเบียน') ||
      message.channel.name.includes('ยืนยันตัวตน') ||
      message.channel.name.includes('อัปโหลดรูป')
    ));

  if (isRegistrationChannel && !message.author.bot) {
    if (message.attachments.size > 0) {
      const attachment = message.attachments.first();
      const isImage = (attachment.contentType && attachment.contentType.startsWith('image/')) ||
                      /\.(jpe?g|png|webp|gif|heic)$/i.test(attachment.name || attachment.url);
      if (isImage) {
        try {
          const { data: member } = await supabase
            .from('members')
            .select('*')
            .eq('discord_id', message.author.id)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!member) {
            const warnMsg = await message.channel.send({
              content: `⚠️ <@${message.author.id}> ยังไม่พบข้อมูลในระบบ: กรุณากดปุ่ม **"🛡️ เริ่มต้นลงทะเบียนสารวัตร"** ด้านบนเพื่อกรอกข้อมูลก่อนส่งรูปครับ`
            }).catch(() => null);
            if (warnMsg) setTimeout(() => warnMsg.delete().catch(() => {}), 10000);
            return;
          }

          // 1. ดาวน์โหลดไฟล์รูปภาพเข้าสู่ Memory Buffer ทันที ก่อนลบข้อความ เพื่อป้องกันลิงก์ Discord CDN 404/หมดอายุ
          const imgRes = await fetch(attachment.url);
          if (!imgRes.ok) throw new Error(`ไม่สามารถดาวน์โหลดรูปภาพจาก Discord ได้ (Status ${imgRes.status})`);
          const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

          // 2. เมื่อดาวน์โหลดเข้า Memory สำเร็จแล้ว จึงลบข้อความรูปภาพของผู้ใช้เพื่อความเป็นส่วนตัวและรักษาความสะอาดห้อง
          await message.delete().catch(() => {});

          const extMatch = (attachment.name || attachment.url).match(/\.(jpe?g|png|webp|gif|heic)/i);
          const ext = extMatch ? extMatch[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
          const safeDutyId = (member.duty_id || member.id || 'photo').replace(/[^a-zA-Z0-9_-]/g, '_');
          const filename = `member_${safeDutyId}_${Date.now()}.${ext}`;

          // 3. บันทึกสำเนาลง Local Storage สำหรับ Web Server
          const uploadDir = path.join(__dirname, '..', 'web', 'public', 'uploads');
          try {
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
            fs.writeFileSync(path.join(uploadDir, filename), imgBuffer);
          } catch (fsErr) {
            console.warn('[PHOTO UPLOAD] Local save notice:', fsErr.message);
          }

          // 4. อัปโหลดเข้าสู่ Supabase Storage (Bucket: sarawat-photos) เพื่อให้ได้ Public CDN URL ถาวร ไม่หมดอายุ
          let permanentUrl = null;
          try {
            const storagePath = `members/${filename}`;
            const { error: storageErr } = await supabase.storage
              .from('sarawat-photos')
              .upload(storagePath, imgBuffer, {
                contentType: attachment.contentType || (ext === 'png' ? 'image/png' : 'image/jpeg'),
                upsert: true
              });

            if (!storageErr) {
              const { data: { publicUrl } } = supabase.storage.from('sarawat-photos').getPublicUrl(storagePath);
              permanentUrl = publicUrl;
            } else {
              console.warn('[SUPABASE STORAGE NOTICE]:', storageErr.message);
            }
          } catch (sErr) {
            console.warn('[SUPABASE STORAGE ERROR]:', sErr.message);
          }

          // 5. สำรองไฟล์เข้าห้องคลังรูปสำรองลับของบอท (#📸│คลังเก็บรูปสำรอง-bot)
          const vaultChannel = await getOrCreatePhotoVaultChannel(message.guild);
          let vaultAttachmentUrl = null;
          if (vaultChannel) {
            try {
              const vaultAttachment = new AttachmentBuilder(imgBuffer, { name: filename });
              const vaultEmbed = new EmbedBuilder()
                .setTitle('📸 สำรองรูปถ่ายทำบัตรประจำตัว (Vault Archive)')
                .setDescription(
                  `• สมาชิก: **${member.first_name} ${member.last_name} (${member.nickname})**\n` +
                  `• รหัสเวร: \`${member.duty_id || 'รอดำเนินการ'}\` • ผลัดเวร: **${getShiftLabel(member.duty_day)}**\n` +
                  `• บัญชี Discord: <@${message.author.id}> (\`${message.author.id}\`)\n` +
                  `• ชั้น/เลขที่: ม.${member.grade_class || '-'} #${member.student_no || '-'}\n` +
                  `• บันทึกเวลา: <t:${Math.floor(Date.now() / 1000)}:F>`
                )
                .setImage(`attachment://${filename}`)
                .setColor('#3498DB');

              const vaultMsg = await vaultChannel.send({
                embeds: [vaultEmbed],
                files: [vaultAttachment]
              });
              if (vaultMsg.attachments.size > 0) {
                vaultAttachmentUrl = vaultMsg.attachments.first().url;
              }
            } catch (vErr) {
              console.error('[VAULT SEND ERROR]:', vErr.message);
            }
          }

          // 5.1 สำรองไฟล์ภาพเข้าสู่ Google Drive (Zero-dependency Service Account)
          let gdriveFileId = null;
          let gdriveFileUrl = null;
          try {
            const gdriveRes = await uploadToGoogleDrive(imgBuffer, filename, {
              memberName: `${member.first_name || ''} ${member.last_name || ''}`.trim() || member.nickname,
              dutyId: member.duty_id || '-'
            });
            if (gdriveRes && gdriveRes.success) {
              gdriveFileId = gdriveRes.fileId;
              gdriveFileUrl = gdriveRes.webViewLink;
            }
          } catch (gdErr) {
            console.warn('[GDRIVE BOT UPLOAD NOTICE]:', gdErr.message);
          }

          // 6. URL รูปภาพที่บันทึก
          const finalProfileUrl = permanentUrl || vaultAttachmentUrl || `/uploads/${filename}`;

          // หากเป็นสมาชิก ACTIVE อยู่แล้ว -> อัปเดตบัตรได้ทันที
          if (member.status === 'ACTIVE') {
            const updatePayload = { profile_image_url: finalProfileUrl, updated_at: new Date() };
            if (gdriveFileId) updatePayload.gdrive_file_id = gdriveFileId;
            if (gdriveFileUrl) updatePayload.gdrive_file_url = gdriveFileUrl;
            await supabase
              .from('members')
              .update(updatePayload)
              .eq('id', member.id);

            const shiftLabel = getShiftLabel(member.duty_day);
            const cardUrl = `${getBaseUrl()}/card?id=${member.id}`;
            const cardRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setLabel('🪪 เปิดดูบัตรประจำตัว')
                .setStyle(ButtonStyle.Link)
                .setURL(cardUrl)
            );

            const successEmbed = new EmbedBuilder()
              .setTitle('📸 อัปเดตรูปถ่ายทำบัตรสำเร็จ')
              .setDescription(
                `สมาชิก: **${member.first_name} ${member.last_name} (${member.nickname})**\n` +
                `ชั้น: ม.${member.grade_class} #${member.student_no} • รหัสเวร: \`[${member.duty_id || 'สารวัตร'}]\` • เวร: ${shiftLabel}\n\n` +
                `✅ บันทึกรูปถ่ายต้นฉบับเข้าคลังรูปและอัปเดตระบบทำบัตรสารวัตรเรียบร้อยแล้ว`
              )
              .setImage(finalProfileUrl.startsWith('http') ? finalProfileUrl : attachment.url)
              .setColor('#2ECC71');

            const successMsg = await message.channel.send({
              content: `👤 <@${message.author.id}> อัปเดตรูปถ่ายสำเร็จ:`,
              embeds: [successEmbed],
              components: [cardRow]
            }).catch(() => null);
            if (successMsg) setTimeout(() => successMsg.delete().catch(() => {}), 15000);
            return;
          }

          // สร้าง Token ชั่วคราว (อายุ 15 นาที) สำหรับเปิดเว็บเครื่องมือครอปรูป 1:1
          const cropToken = crypto.randomBytes(32).toString('hex');
          const tokenExpires = new Date(Date.now() + 15 * 60 * 1000);
          const cropUrl = `${getWebDashboardUrl()}/crop?token=${cropToken}`;

          // สร้าง Rich Embed พรีวิวรูปถ่าย พร้อมจัดหมวดหมู่ข้อมูลที่เข้าใจง่าย และแสดง 2 ปุ่มทันที (ครอบรูป / เปลี่ยนรูป)
          const isSpecial = member.duty_day && member.duty_day.endsWith('S');
          const weekday = member.duty_day ? (member.duty_day === 'TSS' ? 'Ts' : member.duty_day.replace(/S+$/, '') || member.duty_day) : 'M';
          const weekdayName = DAY_NAMES[weekday] || weekday;
          const shiftLabel = getShiftLabel(member.duty_day);

          const previewEmbed = new EmbedBuilder()
            .setTitle('🛡️ ตรวจสอบรูปถ่าย & ข้อมูลสารวัตรนักเรียน')
            .setDescription(
              `ยินดีต้อนรับคุณ **${member.first_name} ${member.last_name} (${member.nickname})**\n` +
              `ระบบบันทึกข้อมูลการลงทะเบียนของคุณเรียบร้อยแล้ว เหลือเพียงขั้นตอนการจัดสัดส่วนรูปถ่ายหน้าตรง:\n\n` +
              `👉 **กรุณาเลือกดำเนินการ 1 ใน 2 ตัวเลือกด้านล่าง:**\n` +
              `1️⃣ **[🔲 ปรับแต่ง/ครอบรูป (ขนาด 1 นิ้ว)]** — กดเพื่อเปิดหน้าเว็บจัดสัดส่วนใบหน้าและตัดรูป 3:4 (ขนาด 1 นิ้ว) ให้พอดีกับกรอบบัตรประจำตัว\n` +
              `2️⃣ **[🔄 เปลี่ยนรูปภาพใหม่]** — กดหากรูปนี้ไม่ชัดหรือไม่ถูกต้อง เพื่อส่งรูปถ่ายหน้าตรงรูปใหม่อีกครั้ง`
            )
            .addFields(
              {
                name: '👤 ข้อมูลส่วนตัวผู้สมัคร',
                value: `• ชื่อ-สกุล: **${member.first_name} ${member.last_name}**\n• ชื่อเล่น: **${member.nickname || '-'}**\n• ชั้น/ห้อง: **ม.${member.grade_class || '-'}** เลขที่ **#${member.student_no || '-'}**`,
                inline: true
              },
              {
                name: '🛡️ ข้อมูลการปฏิบัติหน้าที่',
                value: `• วันประจำการ: **วัน${weekdayName} (${weekday})**\n• ผลัดเวรสุทธิ: **${shiftLabel}** ${isSpecial ? '⭐' : ''}\n• เบอร์โทร: \`${member.phone_number || '-'}\``,
                inline: true
              },
              {
                name: '📸 สถานะรูปถ่ายและการดำเนินการต่อ',
                value: `⚠️ **รูปถ่ายต้นฉบับ (ยังไม่ได้ตัดแต่ง 1 นิ้ว)**\n` +
                       `• กดปุ่ม **"🔲 ปรับแต่ง/ครอบรูป (ขนาด 1 นิ้ว)"** ด้านล่างเพื่อเข้าสู่หน้าเว็บจัดรูป\n` +
                       `• เมื่อตัดรูปและกดยืนยันบนเว็บ ระบบจะสำรองรูปเข้า **Google Drive** และส่งคำขออนุมัติไปยังผู้บริหารทันที`,
                inline: false
              }
            )
            .setImage(finalProfileUrl.startsWith('http') ? finalProfileUrl : attachment.url)
            .setColor('#F59E0B')
            .setFooter({ text: 'ระบบลงทะเบียนสารวัตร • โรงเรียนพระนารายณ์' })
            .setTimestamp();

          const photoActionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setLabel('🔲 ปรับแต่ง/ครอบรูป (ขนาด 1 นิ้ว)')
              .setStyle(ButtonStyle.Link)
              .setURL(cropUrl),
            new ButtonBuilder()
              .setCustomId(`btn_reupload_photo_${member.id}`)
              .setLabel('🔄 เปลี่ยนรูปภาพใหม่')
              .setStyle(ButtonStyle.Danger)
          );

          const promptMsg = await message.channel.send({
            content: `📸 <@${message.author.id}> ได้รับรูปถ่ายสำหรับทำบัตรสารวัตรเรียบร้อยแล้ว! กรุณาเลือกดำเนินการด้านล่าง:`,
            embeds: [previewEmbed],
            components: [photoActionRow]
          });

          // บันทึก crop_tokens พร้อมแนบ metadata สำหรับ Realtime Discord Card Update
          try {
            await supabase.from('crop_tokens').insert({
              token: cropToken,
              member_id: member.id,
              discord_id: message.author.id,
              source_image_url: `${finalProfileUrl.startsWith('http') ? finalProfileUrl : attachment.url}#discord_meta:${message.channel.id}:${promptMsg?.id || ''}`,
              expires_at: tokenExpires.toISOString()
            });
          } catch (tokenErr) {
            console.warn('[CROP TOKEN NOTICE]:', tokenErr.message);
          }

          // บันทึกสถานะ pending สำหรับกรณีผู้ใช้กดเปลี่ยนรูป
          pendingPhotoConfirmations.set(member.id, {
            member,
            photoUrl: finalProfileUrl,
            filename: filename,
            userId: message.author.id,
            cropUrl: cropUrl,
            promptMsgId: promptMsg?.id,
            channelId: message.channel.id,
            timestamp: Date.now()
          });

          // ตั้งเวลาลบข้อความ Prompt หลัง 5 นาทีเพื่อรักษาความสะอาดห้อง
          if (promptMsg) {
            setTimeout(async () => {
              if (pendingPhotoConfirmations.has(member.id)) {
                await promptMsg.delete().catch(() => {});
              }
            }, 5 * 60 * 1000);
          }
          return;
        } catch (err) {
          logError('Photo Upload Processing Error', err, {
            authorId: message.author.id,
            authorTag: message.author.tag,
            channelId: message.channel.id
          });
          const errNotice = await message.channel.send({
            content: `⚠️ <@${message.author.id}> เกิดข้อผิดพลาดในการประมวลผลรูปถ่าย: \`${err.message || 'ระบบขัดข้อง'}\` กรุณาลองส่งใหม่อีกครั้งครับ`
          }).catch(() => null);
          if (errNotice) setTimeout(() => errNotice.delete().catch(() => {}), 15000);
        }
      }
    }
  }

  // ==========================================================
  // 📑 ระบบตรวจจับและประมวลผลรูปถ่ายใบเช็คชื่อ (Attendance Sheet Vision Ingestion)
  // ==========================================================
  const isAttendanceChannel = (ATTENDANCE_CHANNEL_ID && message.channel.id === ATTENDANCE_CHANNEL_ID) ||
    (message.channel && message.channel.name && (
      message.channel.name.includes('เช็คชื่อ') ||
      message.channel.name.includes('บริการ')
    ));

  const isAttendanceTrigger = isAttendanceChannel ||
    /!(attendance|scan|เช็คชื่อ|สแกน|test-attendance)/i.test(message.content) ||
    message.content.includes('เช็คชื่อ');

  // กรณีคำสั่งทดสอบระบบเช็คชื่อ: !test-attendance หรือ !test-scan
  if (/^!(test-attendance|test-scan)/i.test(message.content.trim())) {
    try {
      const waitMsg = await message.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('🧪 ทดสอบระบบเช็คชื่ออัตโนมัติ (Live Attendance Test)')
            .setDescription(
              '⏳ กำลังเชื่อมต่อ Supabase ตรวจสอบผลัดเวรวันนี้ ดึงประวัติใบลา และจำลองการประมวลผล...'
            )
            .setColor('#F39C12')
        ]
      });

      // ดึงตัวอย่าง shift จากข้อความ เช่น "!test-attendance TS" หรือใช้วันปัจจุบัน
      const matchShift = message.content.match(/(จันทร์|อังคาร|พุธ|พฤหัส|ศุกร์|พิเศษ|M|MS|T|TS|W|Ts|TH|F|FS|S)/i);
      const testShift = matchShift ? matchShift[0] : null;

      const result = await processAttendancePhoto({
        supabase,
        imageBuffer: Buffer.from(''),
        mimeType: 'image/jpeg',
        shiftInput: testShift,
        scannedBy: `${message.author.username} (คำสั่งทดสอบ !test-attendance)`
      });

      const { embed, row } = buildAttendanceDiscordCard({
        session: result.session,
        summary: result.summary,
        records: result.records,
        shiftInfo: result.shiftInfo,
        webUrl: getWebDashboardUrl()
      });

      await waitMsg.edit({ embeds: [embed], components: [row] });
      return;
    } catch (err) {
      console.error('[ATTENDANCE TEST ERROR]', err);
      await message.reply({ content: `❌ ทดสอบระบบเช็คชื่อไม่สำเร็จ: ${err.message}` }).catch(() => {});
      return;
    }
  }

  // กรณีมีการส่งรูปถ่ายในห้องเช็คชื่อ หรือส่งพร้อมข้อความเช็คชื่อ
  if (isAttendanceTrigger && message.attachments.size > 0 && !message.author.bot) {
    const attachment = message.attachments.find(a => 
      (a.contentType && a.contentType.startsWith('image/')) ||
      /\.(jpe?g|png|webp|gif|heic)$/i.test(a.name || a.url)
    );

    if (attachment) {
      try {
        const waitMsg = await message.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle('⚡ กำลังประมวลผลใบเช็คชื่อด้วย Gemini Vision AI')
              .setDescription(
                '📸 **ตรวจพบภาพถ่ายใบเช็คชื่อ/การเข้าเวร**\n' +
                '⏳ บอทกำลังส่งภาพให้ Gemini Vision วิเคราะห์พิกัดวงกลม OMR ตรวจสอบรายชื่อประจำผลัด และเทียบการลาใน Supabase...'
              )
              .setColor('#F39C12')
              .setFooter({ text: 'SARAWAT PRANARAI OS • VISION AI OMR' })
          ]
        });

        // 1. ดาวน์โหลดรูปภาพ
        const imgRes = await fetch(attachment.url);
        if (!imgRes.ok) throw new Error(`ไม่สามารถดาวน์โหลดภาพได้ (${imgRes.status})`);
        const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

        // 2. ตรวจสอบข้อมูลจากรอบรออัปโหลด (Pending Flow) หรือจากข้อความ
        const pendingUpload = pendingAttendanceUploads.get(message.author.id);
        if (pendingUpload) {
          pendingAttendanceUploads.delete(message.author.id);
        }

        const matchShift = message.content.match(/(จันทร์|อังคาร|พุธ|พฤหัส|ศุกร์|พิเศษ|M|MS|T|TS|W|Ts|TH|F|FS|S)/i);
        const shiftParam = pendingUpload ? pendingUpload.shift : (matchShift ? matchShift[0] : null);
        const targetDate = pendingUpload ? pendingUpload.dateStr : 'วันนี้';

        // 3. ประมวลผล OMR และบันทึกลงฐานข้อมูล
        const result = await processAttendancePhoto({
          supabase,
          imageBuffer: imgBuffer,
          mimeType: attachment.contentType || 'image/jpeg',
          shiftInput: shiftParam,
          targetDate,
          scannedBy: message.member?.displayName || message.author.username
        });

        // 4. สร้าง URL เชื่อมต่อไปยัง Web App สำหรับขั้นตอน Calibration (ปรับ 4 จุด) & Verification
        const sessionUrl = `${getWebDashboardUrl()}/attendance-scan?session=${result.session.id}&image_url=${encodeURIComponent(result.session.raw_image_url || '')}&shift=${result.shiftInfo.code}&date=${encodeURIComponent(targetDate)}`;

        // 5. สร้างการ์ดผลลัพธ์พร้อมปุ่มเปิดหน้าเว็บปรับจุด 4 มุมตาม Flowchart
        const { embed, row } = buildAttendanceDiscordCard({
          session: result.session,
          summary: result.summary,
          records: result.records,
          shiftInfo: result.shiftInfo,
          webUrl: getWebDashboardUrl()
        });

        // เพิ่มปุ่มพิเศษสำหรับเปิดหน้าเว็บปรับมุมตารางเป็นปุ่มแรก
        row.components.unshift(
          new ButtonBuilder()
            .setLabel('🎯 ปรับจุด 4 มุมและยืนยันข้อมูลบนเว็บ')
            .setStyle(ButtonStyle.Link)
            .setURL(sessionUrl)
        );

        embed.setTitle('⚡ ตรวจจับขอบตารางและวิเคราะห์ OMR เรียบร้อย');
        embed.setDescription(
          `📸 **รับภาพถ่ายและคำนวณพิกัดตั้งต้น 4 มุมเรียบร้อยแล้ว**\n` +
          `• **ผลัดเวร:** ${result.shiftInfo.name} [Shift ${result.shiftInfo.code}]\n` +
          `• **ประจำวันที่:** ${targetDate}\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `👉 **ขั้นตอนถัดไป (Calibration & Verification):**\n` +
          `1. คลิกปุ่ม **"🎯 ปรับจุด 4 มุมและยืนยันข้อมูลบนเว็บ"** ด้านล่าง\n` +
          `2. ตรวจสอบจุด 4 มุม หากไม่ตรงตารางสามารถลากปรับได้ด้วยตนเอง\n` +
          `3. กดยืนยันพิกัด เพื่อให้ระบบ Crop & Warp และอ่านสถานะการมาเรียน\n` +
          `4. ตรวจสอบตารางรายชื่อ ติ๊กแก้ไขรายบุคคล และกดปุ่ม **"ลงข้อมูล"**\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `**📊 สรุปยอดเบื้องต้น:** มา ${result.summary.present} / สาย ${result.summary.late} / ลา ${result.summary.leave} / ขาด ${result.summary.absent} (ความพร้อม ${result.summary.attendance_rate}%)`
        );

        await waitMsg.edit({ embeds: [embed], components: [row] });
        return;
      } catch (err) {
        console.error('[ATTENDANCE VISION ERROR]', err);
        await message.reply({
          content: `⚠️ เกิดข้อผิดพลาดในการประมวลผลภาพถ่ายเช็คชื่อ: ${err.message}`
        }).catch(() => {});
        return;
      }
    }
  }

  if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return;

  if (message.content === '!setup-verify') {
    await sendVerifyPanel(message.channel);
    await message.delete().catch(() => {});
  }

  if (message.content === '!setup-leave') {
    const embed = new EmbedBuilder()
      .setTitle('📝 ระบบขอลาเวรปฏิบัติหน้าที่ | สารวัตรนักเรียน')
      .setDescription('สารวัตรนักเรียนที่มีความจำเป็นต้องลาเวร กรุณากดปุ่มด้านล่าง\n\nเมื่อส่งแล้ว ระบบจะ **ส่งข้อความแจ้งเตือนส่วนตัว (DM) ไปยังหัวหน้าและรองหัวหน้าเวรของคุณทันที**')
      .setColor('#E67E22');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('btn_request_leave')
        .setLabel('📝 ขอลาเวรปฏิบัติหน้าที่')
        .setStyle(ButtonStyle.Danger)
    );

    await message.channel.send({ embeds: [embed], components: [row] });
    await message.delete().catch(() => {});
  }

  if (message.content === '!setup-inspector') {
    const embed = new EmbedBuilder()
      .setTitle('👥 แดชบอร์ดตรวจสอบข้อมูลสารวัตรนักเรียน')
      .setDescription('สงวนสิทธิ์เฉพาะ **ประธาน, รองประธาน, หัวหน้าเวร และรองหัวหน้าเวร**\nกดปุ่มเพื่อดูรายชื่อ Preview และเลือกดูข้อมูล/เบอร์โทรศัพท์/ประวัติการลา')
      .setColor('#9B59B6');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('btn_inspect_roster')
        .setLabel('👥 ดูข้อมูลสมาชิกสารวัตรทั้งหมด')
        .setStyle(ButtonStyle.Secondary)
    );

    await message.channel.send({ embeds: [embed], components: [row] });
    await message.delete().catch(() => {});
  }

  if (message.content === '!setup-attendance') {
    await sendAttendancePanel(message.channel);
    await message.delete().catch(() => {});
  }

  if (message.content === '!setup-photo') {
    await sendPhotoPanel(message.channel);
    await message.delete().catch(() => {});
  }

  if (message.content === '!setup-appoint' || message.content === '!appoint') {
    await sendAppointPanel(message.channel);
    await message.delete().catch(() => {});
  }

  if (message.content === '!setup-all' || message.content === '!clean-restart' || message.content === '!refresh') {
    const guild = message.guild;
    const res = await refreshAllChannelsAndPanels(guild, { purge: true });
    await message.reply({
      content: `✅ เคลียร์ข้อความเก่าและติดตั้งแผงฟีเจอร์เวอร์ชันล่าสุดเรียบร้อยแล้วทั้งหมด ${res.count || 0} ช่อง!\n*(ข้อมูลสารวัตร คดี และยศทั้งหมดยังคงอยู่ครบถ้วน ไม่ใช่ D-Day)*`
    });
  }

  // 🧪 คำสั่งตรวจสอบและวินิจฉัยระบบทุกฟีเจอร์ของบอท
  if (message.content === '!test' || message.content === '!test-bot' || message.content === '!test-all' || message.content === '!test-features') {
    const report = await runSystemDiagnostics(message.guild);
    const embed = new EmbedBuilder()
      .setTitle('🛠️ SARAWAT-BOT SYSTEM DIAGNOSTIC REPORT')
      .setDescription(`ผลการตรวจสอบความพร้อมทุกฟีเจอร์ของระบบสารวัตรนักเรียน\nเซิร์ฟเวอร์: **${report.guild}** • ผลลัพธ์: ${report.overallSuccess ? '🟢 **ผ่านทั้งหมด (ALL SYSTEMS GO)**' : '🟡 **พบข้อควรระวัง/ไม่สมบูรณ์**'}`)
      .setColor(report.overallSuccess ? '#2ECC71' : '#F39C12')
      .setFooter({ text: 'SARAWAT DIAGNOSTIC SUITE • โรงเรียนพระนารายณ์' })
      .setTimestamp();

    report.checks.forEach(c => {
      embed.addFields({
        name: `${c.pass ? '✅' : '❌'} ${c.category}`,
        value: c.detail,
        inline: false
      });
    });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('btn_test_reminder_dryrun')
        .setLabel('🔔 ทดสอบแจ้งเตือนเวร (Dry-run)')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('btn_test_refresh_panels')
        .setLabel('🔄 รีเฟรชทุกช่องระบบ')
        .setStyle(ButtonStyle.Secondary)
    );

    await message.reply({ embeds: [embed], components: [row] });
  }

  // 🔔 คำสั่งทดสอบส่งข้อความแจ้งเตือนเวรประจำวัน
  if (message.content === '!duty-reminder' || message.content === '!test-duty-reminder' || message.content === '!send-reminders') {
    const res = await sendDailyDutyReminders(message.guild, { dryRun: false });
    await message.reply({
      content: `🔔 ส่งข้อความแจ้งเตือนเวรประจำวันสำเร็จแล้ว: ${res.count || 0} นาย (เป้าหมาย: ${res.codes?.join(', ') || '-'})`
    });
  }
});

// ==========================================================
// 🔍 ระบบขออนุญาตออกตรวจพื้นที่ด่วน (Step-by-Step Flow)
// ==========================================================
const inspectionDrafts = new Map();

function getDutyPeriodNow() {
  const now = new Date();
  const bkkHours = (now.getUTCHours() + 7) % 24;
  const bkkMinutes = now.getUTCMinutes();
  const totalMins = bkkHours * 60 + bkkMinutes;

  if (totalMins < 11 * 60) {
    return 'พักเช้า / ก่อนเข้าแถว';
  } else if (totalMins < 14 * 60 + 30) {
    return 'พักกลางวัน';
  } else {
    return 'เลิกเรียน / เย็น';
  }
}

function getInspectionDraft(userId) {
  let draft = inspectionDrafts.get(userId);
  if (!draft || (Date.now() - draft.updatedAt > 15 * 60 * 1000)) {
    draft = {
      target: null,
      period: getDutyPeriodNow(),
      partnerIds: [],
      partnersText: 'ปฏิบัติหน้าที่คนเดียว',
      updatedAt: Date.now()
    };
    inspectionDrafts.set(userId, draft);
  }
  return draft;
}

// สเตป 1: เลือกสถานที่
function buildStep1Panel(member, user) {
  const profilePhoto = member?.profile_image_url || 
                       member?.photo_url || 
                       member?.profile_photo_url || 
                       user?.displayAvatarURL?.({ dynamic: true, size: 512 }) ||
                       null;

  const officerName = member
    ? `[${member.duty_id || 'สารวัตร'}] ${member.first_name} (${member.nickname})`
    : (user?.username || 'สารวัตรนักเรียน');

  const embed = new EmbedBuilder()
    .setTitle('📋 ขออนุญาตออกตรวจพื้นที่ (ขั้นตอน 1/2)')
    .setDescription(
      `👮 **สารวัตรผู้ขอ:** **${officerName}**\n\n` +
      `📍 **กรุณาเลือกสถานที่ / จุดตรวจที่ต้องการออกตรวจ:**`
    )
    .setColor('#2980B9')
    .setFooter({ text: 'ขั้นตอนที่ 1 จาก 2 • แตะเลือกสถานที่' });

  if (profilePhoto) {
    embed.setThumbnail(profilePhoto);
  }

  // แถวเดียว 5 ปุ่มสถานที่ยอดนิยม
  const locRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_insp_loc_canteen')
      .setLabel('🍜 โรงอาหาร')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('btn_insp_loc_bldg3')
      .setLabel('🏢 หลังอาคาร 3')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('btn_insp_loc_coop')
      .setLabel('🏬 สหกรณ์')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('btn_insp_loc_toilet')
      .setLabel('🚻 บริเวณห้องน้ำ')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('btn_insp_loc_custom')
      .setLabel('✏️ อื่นๆ/ระบุเอง')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [locRow], ephemeral: true };
}

// สเตป 2: เลือกผู้ร่วมตรวจ (คนเดียว หรือ มีเพื่อน)
function buildStep2Panel(member, draft, user) {
  const profilePhoto = member?.profile_image_url || 
                       member?.photo_url || 
                       member?.profile_photo_url || 
                       user?.displayAvatarURL?.({ dynamic: true, size: 512 }) ||
                       null;

  const officerName = member
    ? `[${member.duty_id || 'สารวัตร'}] ${member.first_name} (${member.nickname})`
    : (user?.username || 'สารวัตรนักเรียน');

  const embed = new EmbedBuilder()
    .setTitle('📋 ขออนุญาตออกตรวจพื้นที่ (ขั้นตอน 2/2)')
    .setDescription(
      `👮 **สารวัตรผู้ขอ:** **${officerName}**\n` +
      `📍 **สถานที่ตรวจ:** **${draft.target}**\n\n` +
      `👥 **ต้องการออกตรวจคนเดียว หรือมีเพื่อนร่วมตรวจครับ?**`
    )
    .setColor('#2980B9')
    .setFooter({ text: 'ขั้นตอนที่ 2 จาก 2 • เลือกเพื่อนร่วมตรวจ' });

  if (profilePhoto) {
    embed.setThumbnail(profilePhoto);
  }

  const partnerRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_insp_partner_solo')
      .setLabel('👤 ออกตรวจคนเดียว')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('btn_insp_partner_pick')
      .setLabel('👥 มีเพื่อนร่วมตรวจ')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('btn_insp_back_step1')
      .setLabel('⬅️ เปลี่ยนสถานที่')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [partnerRow], ephemeral: true };
}

// สเตป 2.1: ถ้าเลือกมีเพื่อนร่วมตรวจ ให้เลือกจาก UserSelectMenu
function buildStep2WithFriendPanel(member, draft, user) {
  const profilePhoto = member?.profile_image_url || 
                       member?.photo_url || 
                       member?.profile_photo_url || 
                       user?.displayAvatarURL?.({ dynamic: true, size: 512 }) ||
                       null;

  const embed = new EmbedBuilder()
    .setTitle('👥 เลือกสารวัตรที่ร่วมออกตรวจ')
    .setDescription(
      `📍 **สถานที่ตรวจ:** **${draft.target}**\n\n` +
      `👇 **เลือกสารวัตรที่ร่วมตรวจจากเมนูด้านล่าง:**\n` +
      `*(เมื่อเลือกแล้ว ระบบจะสร้างเคสและดึงเพื่อนทุกคนเข้าห้องเธรดให้ทันที)*`
    )
    .setColor('#2980B9')
    .setFooter({ text: 'เลือกแท็กเพื่อนแล้วระบบจะเปิดห้องเคสทันที' });

  if (profilePhoto) {
    embed.setThumbnail(profilePhoto);
  }

  const userSelect = new UserSelectMenuBuilder()
    .setCustomId('select_insp_friends')
    .setPlaceholder('👥 เลือกเพื่อนสารวัตรที่ร่วมตรวจ (1-5 คน)')
    .setMinValues(1)
    .setMaxValues(5);

  const selectRow = new ActionRowBuilder().addComponents(userSelect);

  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_insp_back_step2')
      .setLabel('⬅️ ย้อนกลับ')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [selectRow, backRow], ephemeral: true };
}

const pendingApprovalMessages = new Map();

async function cleanUpPendingNotificationMessages(guild, caseId, currentInteraction = null) {
  if (!guild || !caseId) return;

  // 1. ลบจาก Cache ทันทีหากมีข้อมูล
  const cached = pendingApprovalMessages.get(caseId);
  if (cached) {
    if (cached.leaderChannelId && cached.leaderMsgId) {
      const ch = guild.channels.cache.get(cached.leaderChannelId);
      if (ch && ch.isTextBased()) {
        await ch.messages.delete(cached.leaderMsgId).catch(() => {});
      }
    }
    if (cached.threadChannelId && cached.threadMsgId) {
      const ch = guild.channels.cache.get(cached.threadChannelId);
      if (ch && ch.isTextBased()) {
        await ch.messages.delete(cached.threadMsgId).catch(() => {});
      }
    }
    pendingApprovalMessages.delete(caseId);
  }

  // 2. หากการกดอนุมัติ/ปฏิเสธเกิดขึ้นที่ข้อความนั้น ให้ลบข้อความต้นทางทิ้ง
  if (currentInteraction && currentInteraction.message && currentInteraction.message.deletable) {
    await currentInteraction.message.delete().catch(() => {});
  }

  // 3. กวาดล้างข้อความแจ้งเตือนที่ยังค้างอยู่ในห้องประชุมหัวหน้าและห้องผู้นำ (Failsafe Guarantee)
  const leaderChannels = [
    findChannel(guild, '👑│ห้องประชุมหัวหน้า'),
    findChannel(guild, 'ห้องประชุมหัวหน้า'),
    findChannel(guild, '👑│ผู้นำ-all-in-one'),
    findChannel(guild, '📁│ติดตามและปิดคดี')
  ].filter(Boolean);

  for (const ch of leaderChannels) {
    if (!ch || !ch.isTextBased()) continue;
    try {
      const fetched = await ch.messages.fetch({ limit: 40 }).catch(() => null);
      if (!fetched) continue;

      for (const msg of fetched.values()) {
        const matchesCase =
          (msg.content && msg.content.includes(caseId)) ||
          (msg.embeds && msg.embeds.some(e =>
            (e.title && e.title.includes(caseId)) ||
            (e.footer?.text && e.footer.text.includes(caseId)) ||
            (e.description && e.description.includes(caseId))
          )) ||
          (msg.components && msg.components.some(row =>
            row.components.some(c => c.customId && c.customId.includes(caseId))
          ));

        if (matchesCase) {
          const isPending = msg.components?.some(row =>
            row.components.some(c =>
              c.customId?.includes('btn_approve_') ||
              c.customId?.includes('btn_reject_')
            )
          ) || (msg.content && msg.content.includes('แจ้งเตือนหัวหน้า'));

          if (isPending && msg.deletable) {
            await msg.delete().catch(() => {});
          }
        }
      }
    } catch (e) {
      console.warn('[CLEANUP NOTIFICATION NOTICE]:', e?.message);
    }
  }
}

async function purgeResolvedNotificationMessages(guild) {
  if (!guild) return;
  const leaderChannels = [
    findChannel(guild, '👑│ห้องประชุมหัวหน้า'),
    findChannel(guild, 'ห้องประชุมหัวหน้า'),
    findChannel(guild, '👑│ผู้นำ-all-in-one')
  ].filter(Boolean);

  for (const ch of leaderChannels) {
    if (!ch || !ch.isTextBased()) continue;
    try {
      const fetched = await ch.messages.fetch({ limit: 50 }).catch(() => null);
      if (!fetched) continue;

      for (const msg of fetched.values()) {
        const fullText = (msg.content || '') + ' ' + (msg.embeds?.[0]?.title || '') + ' ' + (msg.embeds?.[0]?.footer?.text || '') + ' ' + (msg.embeds?.[0]?.description || '');
        const match = fullText.match(/(INSP-\d+|CASE-\d+)/);
        if (match) {
          const cId = match[1];
          const { data: c } = await supabase.from('cases').select('status').eq('case_id', cId).maybeSingle();
          if (c && (c.status === 'IN_PROGRESS' || c.status === 'RESOLVED' || c.status === 'REJECTED' || c.status === 'APPROVED')) {
            const hasButtons = msg.components?.some(row =>
              row.components.some(c => c.customId?.includes('btn_approve_') || c.customId?.includes('btn_reject_'))
            );
            if (hasButtons || msg.content?.includes('แจ้งเตือนหัวหน้า')) {
              await msg.delete().catch(() => {});
              console.log(`[PURGE LINGERING] Automatically deleted resolved notification for ${cId} from ${ch.name}`);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[PURGE LINGERING NOTICE]:', e?.message);
    }
  }
}

async function createInspectionTicket(interaction, { target, period, officers, partnerIds = [], member }) {
  const caseId = 'INSP-' + Math.floor(1000 + Math.random() * 9000);

  const officerName = member
    ? `[${member.duty_id || 'สารวัตร'}] ${member.first_name} (${member.nickname})`
    : (interaction.member?.displayName || interaction.user.username);

  const profilePhoto = member?.profile_image_url || 
                       member?.photo_url || 
                       member?.profile_photo_url || 
                       interaction.user.displayAvatarURL({ dynamic: true, size: 512 });

  // บันทึกลง Supabase cases table
  await supabase.from('cases').insert({
    case_id: caseId,
    reporter_email: member?.email || `${interaction.user.id}@discord.local`,
    reporter_name: officerName,
    incident_date_time: new Date().toISOString(),
    location: target,
    category: 'ขอออกตรวจพื้นที่',
    description: `[ปฏิบัติการขอออกตรวจพื้นที่]\nจุดตรวจ: ${target}\nช่วงเวลา: ${period}\nผู้ร่วมตรวจ: ${officers}\nผู้ขอ: ${officerName} (<@${interaction.user.id}>)`,
    status: 'PATROL_WAITING_PHOTO',
    assigned_duty_day: member?.duty_day || null,
    assigned_officer_id: member?.id || null,
    resolution_notes: `[เริ่มเคสออกตรวจ]: จุดตรวจ ${target} (${period}) โดย ${officerName}`
  });

  const guild = interaction.guild;
  const chIncident = findChannel(guild, '📁│ติดตามและปิดคดี') ||
                     findChannel(guild, '🚨│แจ้งเหตุใหม่-google-form') ||
                     findChannel(guild, 'แจ้งเหตุใหม่') ||
                     findChannel(guild, '👑│ผู้นำ-all-in-one') ||
                     interaction.channel;

  const rootEmbed = new EmbedBuilder()
    .setTitle(`🚨 [เคสขอออกตรวจ] ${target} (${caseId})`)
    .setAuthor({ name: `สารวัตรผู้ขอออกตรวจ: ${officerName}`, iconURL: profilePhoto })
    .setThumbnail(profilePhoto)
    .setDescription(
      `👮 **สารวัตรผู้ขอออกตรวจ:** ${officerName} (<@${interaction.user.id}>)\n` +
      `📍 **จุดตรวจ:** **${target}**\n` +
      `⏰ **ช่วงเวลา:** **${period}**\n` +
      `👥 **ผู้ร่วมตรวจ:** ${officers}\n` +
      `📊 **สถานะ:** 🟡 กำลังรอส่งภาพหลักฐานการเข้าพื้นที่\n\n` +
      `*(ห้องเคสสำหรับส่งภาพและดำเนินภารกิจได้เปิดไว้ในเธรดด้านล่างแล้ว)*`
    )
    .setColor('#F39C12')
    .setFooter({ text: `INSPECTION TICKET • ${caseId}` })
    .setTimestamp();

  let thread = null;
  if (chIncident && chIncident.isTextBased()) {
    const rootMsg = await chIncident.send({ embeds: [rootEmbed] }).catch(() => null);
    if (rootMsg) {
      const safeTarget = target.replace(/[^\u0E00-\u0E7Fa-zA-Z0-9_-]/g, '').slice(0, 15);
      thread = await rootMsg.startThread({
        name: `🎫│ตรวจ-${safeTarget || 'พื้นที่'}-${caseId}`,
        autoArchiveDuration: 1440
      }).catch(() => null);

      if (thread) {
        await thread.members.add(interaction.user.id).catch(() => {});
        if (partnerIds && Array.isArray(partnerIds)) {
          for (const pid of partnerIds) {
            await thread.members.add(pid).catch(() => {});
          }
        }

        // ส่งข้อความขนาดใหญ่ในห้อง Ticket เธรด
        await thread.send({
          content:
            `# 🚨 ปฏิบัติการขอออกตรวจพื้นที่: ${target}\n` +
            `### 🎫 รหัสเคส: \`${caseId}\`\n\n` +
            `👮 **สารวัตรรับผิดชอบ:** <@${interaction.user.id}> (${officerName})\n` +
            `📍 **จุดตรวจ:** **${target}**\n` +
            `⏰ **ช่วงเวลา:** **${period}**\n` +
            `👥 **ผู้ร่วมตรวจ:** ${officers}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `# 📸 กรุณาส่งรูปภาพหลักฐานการเข้าพื้นที่\n` +
            `> ให้สารวัตรถ่ายภาพจุดตรวจหรือภาพขณะเข้าพื้นที่ แล้วส่งรูปลงในเธรดนี้ได้เลยครับ\n` +
            `> **เมื่อส่งภาพแล้ว บอทจะส่งสัญญาณขออนุมัติให้หัวหน้าตรวจเช็กทันที!**\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
        }).catch(() => {});
      }
    }
  }

  const responsePayload = {
    content:
      `# ✅ เปิดห้องเคสขอออกตรวจเรียบร้อยแล้ว!\n` +
      `- **รหัสเคส:** \`${caseId}\`\n` +
      `- **จุดตรวจ:** **${target}**\n` +
      `- **ช่วงเวลา:** ${period}\n` +
      `- **ผู้ร่วมตรวจ:** ${officers}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      (thread ? `👉 **กดเข้าไปที่ห้องเคสได้ทันที:** <#${thread.id}>\n` : '') +
      `กรุณาส่งภาพถ่ายหลักฐานการเข้าพื้นที่ในห้องเคสเพื่อเริ่มปฏิบัติการครับ`,
    embeds: [],
    components: []
  };

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(responsePayload);
  } else {
    await interaction.reply({ ...responsePayload, ephemeral: true });
  }
}

// ==========================================================
// ⚡ จัดการ INTERACTION ทั้งหมด
// ==========================================================
client.on('interactionCreate', async (interaction) => {
  // ⏱️ ตั้งค่าข้อความแบบ "Only you can see" (ephemeral) ให้หายไปอัตโนมัติใน 2 นาที (120 วินาที)
  const EPHEMERAL_TTL_MS = 2 * 60 * 1000;
  let isEphemeralSession = false;
  let autoDeleteTimer = null;

  const scheduleAutoDelete = () => {
    if (autoDeleteTimer) clearTimeout(autoDeleteTimer);
    autoDeleteTimer = setTimeout(() => {
      interaction.deleteReply().catch(() => {});
    }, EPHEMERAL_TTL_MS);
  };

  const sanitizeEphemeralOptions = (opts) => {
    if (!opts) return opts;
    if (typeof opts === 'string') return opts;
    if (typeof opts === 'object') {
      if (opts.ephemeral) {
        isEphemeralSession = true;
        delete opts.ephemeral;
        opts.flags = (opts.flags || 0) | MessageFlags.Ephemeral;
      } else if (opts.flags && (opts.flags & MessageFlags.Ephemeral)) {
        isEphemeralSession = true;
      }
    }
    return opts;
  };

  const origReply = interaction.reply ? interaction.reply.bind(interaction) : null;
  if (origReply) {
    interaction.reply = async function(opts) {
      const sanitized = sanitizeEphemeralOptions(opts);
      const res = await origReply(sanitized);
      if (isEphemeralSession) {
        scheduleAutoDelete();
      }
      return res;
    };
  }

  if (interaction.deferReply) {
    const origDefer = interaction.deferReply.bind(interaction);
    interaction.deferReply = async function(opts) {
      const sanitized = sanitizeEphemeralOptions(opts);
      const res = await origDefer(sanitized);
      if (isEphemeralSession) {
        scheduleAutoDelete();
      }
      return res;
    };
  }

  if (interaction.editReply) {
    const origEdit = interaction.editReply.bind(interaction);
    interaction.editReply = async function(opts) {
      const res = await origEdit(opts);
      if (isEphemeralSession) {
        scheduleAutoDelete();
      }
      return res;
    };
  }

  if (interaction.update) {
    const origUpdate = interaction.update.bind(interaction);
    interaction.update = async function(opts) {
      const res = await origUpdate(opts);
      if (isEphemeralSession) {
        scheduleAutoDelete();
      }
      return res;
    };
  }

  if (interaction.followUp) {
    const origFollowUp = interaction.followUp.bind(interaction);
    interaction.followUp = async function(opts) {
      const sanitized = sanitizeEphemeralOptions(opts);
      const res = await origFollowUp(sanitized);
      if (isEphemeralSession && res && typeof res.delete === 'function') {
        setTimeout(() => {
          res.delete().catch(() => {});
        }, EPHEMERAL_TTL_MS);
      }
      return res;
    };
  }

  try {

    // ==========================================================
    // ⚡ DISCORD SLASH COMMANDS (/) ROUTING
    // ==========================================================
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      if (commandName === 'test-duty') {
        const mode = interaction.options.getString('mode') || 'dry_run';
        const day = interaction.options.getString('day') || 'today';
        const forceDay = (day && day !== 'today') ? day : null;
        const actorName = `👮 คุณ${interaction.member?.displayName || interaction.user.username}`;

        if (mode === 'self') {
          const { data: callerMember } = await supabase
            .from('members')
            .select('*')
            .eq('discord_id', interaction.user.id)
            .maybeSingle();

          const sampleMember = callerMember || {
            id: 'sample-test-id',
            nickname: interaction.user.username,
            first_name: interaction.user.username,
            last_name: '(ทดสอบระบบ)',
            duty_id: 'TEST-01',
            duty_day: forceDay || 'TS'
          };

          const todayThaiDate = new Date().toLocaleDateString('th-TH', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: 'Asia/Bangkok'
          });
          const baseDay = sampleMember.duty_day === 'TSS' ? 'Ts' : sampleMember.duty_day.replace(/S+$/, '');
          const shiftLabel = getShiftLabel(sampleMember.duty_day);

          const sampleEmbed = new EmbedBuilder()
            .setTitle('🔔 [ทดสอบ] แจ้งเตือนเวรสารวัตรนักเรียนประจำวัน')
            .setDescription(
              `# ☀️ วันนี้เป็นเวรปฏิบัติหน้าที่ของคุณ! (ข้อความทดสอบ)\n\n` +
              `### 👮 [${sampleMember.duty_id}] คุณ${sampleMember.nickname} (${sampleMember.first_name} ${sampleMember.last_name})\n` +
              `📅 **ประจำวัน:** **${todayThaiDate}** (${shiftLabel})\n` +
              `⏰ **ข้อปฏิบัติ:** สวมปลอกแขน/เครื่องแบบสารวัตร และเข้าประจำจุดตรวจตามเวลา\n\n` +
              `━━━━━━━━━━━━━━━━━━━━\n` +
              `### ⚠️ หากติดภารกิจและต้องการลาเวร\n` +
              `กดปุ่ม **"📝 ขอลาเวรวันนี้"** ด้านล่างได้ทันทีเพื่อเลือกประเภทการลาและระบุหมายเหตุ`
            )
            .setColor('#F39C12')
            .setFooter({ text: `[โหมดทดสอบ] เวร${DAY_NAMES[baseDay] || sampleMember.duty_day} • กลุ่มงานสารวัตรนักเรียน` })
            .setTimestamp();

          const sampleRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`btn_dm_quick_leave_${sampleMember.id}`)
              .setLabel('📝 ขอลาเวรวันนี้ (ทดสอบกดได้)')
              .setStyle(ButtonStyle.Danger)
          );

          try {
            await interaction.user.send({ embeds: [sampleEmbed], components: [sampleRow] });
            await sendBotActionLog(interaction.guild, {
              title: '🧪 [ทดสอบแจ้งเตือนเวร] ส่งตัวอย่างเข้า DM ผู้สั่งการ',
              description: 'ผู้ดูแลระบบได้ทำการทดสอบส่งการ์ดแจ้งเตือนเวรประจำวันเข้าสู่ DM ส่วนตัวเพื่อตรวจสอบความเรียบร้อย',
              color: '#3498DB',
              actor: actorName,
              fields: [
                { name: '👤 เป้าหมาย', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
                { name: '🏷️ ผลัดเวรที่ทดสอบ', value: `${forceDay || 'เวรวันนี้'} (${shiftLabel})`, inline: true }
              ]
            });
            await interaction.reply({
              content: `✅ ส่งตัวอย่างการ์ดแจ้งเตือนเวรเข้าสู่ DM ของคุณ (<@${interaction.user.id}>) เรียบร้อยแล้ว! ตรวจสอบกล่องข้อความส่วนตัวได้เลยครับ`,
              ephemeral: true
            });
          } catch (dmErr) {
            await interaction.reply({
              content: '⚠️ ไม่สามารถส่งข้อความเข้า DM ของคุณได้ กรุณาเปิดการตั้งค่า "Allow direct messages from server members" ใน Discord ครับ',
              ephemeral: true
            });
          }
          return;
        }

        // Mode: dry_run or all
        await interaction.deferReply({ ephemeral: true });
        const isDryRun = mode === 'dry_run';
        const res = await sendDailyDutyReminders(interaction.guild, {
          dryRun: isDryRun,
          forceDay: forceDay,
          actor: actorName
        });

        await interaction.editReply({
          content: isDryRun
            ? `🧪 **ผลการจำลองแจ้งเตือนเวร (Dry-Run):**\n` +
              `• ผลัดเวรเป้าหมาย: \`${res.codes?.join(', ') || '-'}\`\n` +
              `• พบสารวัตรที่มีเวร: **${res.count || 0}** นาย (ทั้งหมดในตาราง: ${res.totalTargeted || 0} นาย)\n` +
              `• *ระบบไม่ได้ส่งข้อความจริงไปยังผู้ใช้ (บันทึก Log เรียบร้อย)*`
            : `🔔 **ส่งแจ้งเตือนเวรประจำวันสำเร็จแล้ว!**\n` +
              `• ผลัดเวรเป้าหมาย: \`${res.codes?.join(', ') || '-'}\`\n` +
              `• ส่งสำเร็จจริง: **${res.count || 0}** นาย\n` +
              `• บันทึกข้อมูลและรายชื่อลงห้อง **Log** เรียบร้อยแล้ว`
        });
        return;
      }

      if (commandName === 'status') {
        const { count: memberCount } = await supabase.from('members').select('*', { count: 'exact', head: true });
        const { count: activeCount } = await supabase.from('members').select('*', { count: 'exact', head: true }).eq('status', 'ACTIVE');
        const { count: leaveCount } = await supabase.from('leave_requests').select('*', { count: 'exact', head: true });

        const statusEmbed = new EmbedBuilder()
          .setTitle('🛡️ สถานะระบบ SARAWAT-BOT | โรงเรียนพระนารายณ์')
          .setColor('#2ECC71')
          .addFields(
            { name: '🤖 บอทประจำการ', value: `${client.user.tag}`, inline: true },
            { name: '🌐 เซิร์ฟเวอร์', value: `${interaction.guild?.name || 'SARAWAT'}`, inline: true },
            { name: '⚡ ระบบฐานข้อมูล', value: '🟢 Supabase Online', inline: true },
            { name: '🎓 ภาคเรียนปัจจุบัน', value: `${getSettings().current_semester}`, inline: true },
            { name: '👥 สารวัตรทั้งหมด', value: `${memberCount || 0} คน`, inline: true },
            { name: '✅ ยืนยันตัวตนแล้ว', value: `${activeCount || 0} คน`, inline: true },
            { name: '📝 ประวัติการลา', value: `${leaveCount || 0} รายการ`, inline: true }
          )
          .setFooter({ text: 'SARAWAT-BOT Core API • โรงเรียนพระนารายณ์' })
          .setTimestamp();

        const diagRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('btn_run_diagnostics')
            .setLabel('🛠️ ตรวจสอบระบบทุกฟีเจอร์ (Diagnostics)')
            .setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({ embeds: [statusEmbed], components: [diagRow] });
        return;
      }

      if (commandName === 'my-card') {
        const { data: member } = await supabase
          .from('members')
          .select('*')
          .eq('discord_id', interaction.user.id)
          .single();

        if (!member) {
          await interaction.reply({
            content: '❌ **ไม่พบข้อมูลสารวัตรนักเรียนของคุณในระบบ**\nกรุณาลงทะเบียนยืนยันตัวตนที่ห้อง `🛡️│ยืนยันตัวตน` ก่อนนะครับ',
            ephemeral: true
          });
          return;
        }

        const roleTitle = member.role === 'PRESIDENT' ? '👑 ประธานสารวัตร' :
                          member.role === 'VICE_PRESIDENT' ? '🎖️ รองประธานสารวัตร' :
                          member.shift_role === 'SHIFT_HEAD' ? '👑 หัวหน้าเวร' :
                          member.shift_role === 'SHIFT_DEPUTY' ? '🎖️ รองหัวหน้าเวร' :
                          '🛡️ สารวัตรนักเรียนทั่วไป';

        const cardUrl = `${getBaseUrl()}/card?id=${member.id}`;

        const cardEmbed = new EmbedBuilder()
          .setTitle('🪪 บัตรประจำตัวสารวัตรนักเรียนดิจิทัล')
          .setDescription(
            `👤 **ชื่อ-นามสกุล:** ${member.first_name} ${member.last_name} (${member.nickname})\n` +
            `🏷️ **รหัสเวร:** \`[${member.duty_id || 'รออนุมัติ'}]\`\n` +
            `📅 **เวรประจำวัน:** ${getDayName(member.duty_day)}\n` +
            `🎖️ **ตำแหน่ง:** ${roleTitle}\n` +
            `🏫 **ชั้นเรียน:** ม.${member.grade_class || '-'} #${member.student_no || '-'}\n` +
            `🛡️ **สถานะ:** ${member.status === 'ACTIVE' ? '✅ อนุมัติแล้ว (ACTIVE)' : '⏳ รออนุมัติ'}\n\n` +
            `🔗 **คลิกลิงก์เพื่อเปิดดูและโหลดรูปบัตร (PNG):**\n${cardUrl}`
          )
          .setColor('#3B82F6')
          .setFooter({ text: 'โรงเรียนพระนารายณ์ • กลุ่มงานกิจการนักเรียน' });

        if (member.profile_image_url) {
          cardEmbed.setThumbnail(member.profile_image_url);
        }

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel('🪪 เปิดดูบัตรประจำตัว & บันทึกรูปภาพ')
            .setStyle(ButtonStyle.Link)
            .setURL(cardUrl)
        );

        await interaction.reply({ embeds: [cardEmbed], components: [row], ephemeral: true });
        return;
      }



      if (commandName === 'semester') {
        const period = getAcademicPeriod();
        const modeText = period.isAuto ? '✨ ตรวจจับอัตโนมัติตามปฏิทิน' : '🛠️ กำหนดเองโดยผู้ดูแล (Manual)';

        const embed = new EmbedBuilder()
          .setTitle('🎓 ข้อมูลปีการศึกษาและไตรมาสปฏิบัติหน้าที่')
          .setDescription(
            `• 📅 **ไตรมาสปัจจุบัน:** **${period.quarterName}**\n` +
            `• 🎓 **ปีการศึกษา:** **${period.academicYear}** (พ.ศ.)\n` +
            `• 🏫 **ภาคเรียน:** **${period.semesterName}**\n` +
            `• ⚙️ **โหมดระบบ:** \`${modeText}\`\n\n` +
            `_ระบบจะตรวจจับไตรมาสและปีการศึกษาอัตโนมัติตามวันปัจจุบัน หรือสามารถกดปุ่มตั้งค่าเองได้_`
          )
          .setColor('#3498DB');

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('btn_set_semester')
            .setLabel('⚙️ ตั้งค่า ปี/ไตรมาส')
            .setEmoji('📅')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('btn_reset_semester_auto')
            .setLabel('🔄 คืนค่าตรวจจับอัตโนมัติ')
            .setStyle(ButtonStyle.Secondary)
        );
        await interaction.reply({
          embeds: [embed],
          components: [row],
          ephemeral: true
        });
        return;
      }

      if (commandName === 'sync-roles') {
        if (!interaction.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
          await interaction.reply({ content: '⛔ สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น', ephemeral: true });
          return;
        }

        await interaction.deferReply({ ephemeral: true });
        const res = await syncAllMemberRoles(interaction.guild);
        if (!res.success) {
          await interaction.editReply({ content: res.message });
        } else if (res.hasPermissionError) {
          await interaction.editReply({
            content: `⚠️ ซิงค์สำเร็จ ${res.successCount} คน / ล้มเหลว ${res.failCount} คน\n` +
              `**สาเหตุ:** บอทไม่มีสิทธิ์แจกยศเนื่องจาก **ลำดับยศ SARAWAT-BOT อยู่ต่ำกว่ายศที่ต้องแจก**\n` +
              `👉 **วิธีแก้:** ไปที่ Server Settings > Roles > ลากยศ **SARAWAT-BOT** ขึ้นไปไว้ด้านบนสุด แล้วสั่ง \`/sync-roles\` อีกครั้ง`
          });
        } else {
          const chService = findChannel(interaction.guild, '🛎️│บริการสารวัตร') || findChannel(interaction.guild, 'บริการสารวัตร');
          const chLost = findChannel(interaction.guild, '📦│แจ้งพบของหาย') || findChannel(interaction.guild, 'แจ้งพบของหาย');
          if (chService) await ensureInspectorChannelAccess(interaction.guild, chService, { allowSend: true });
          if (chLost) await ensureInspectorChannelAccess(interaction.guild, chLost, { allowSend: true });

          await interaction.editReply({ content: `✅ ซิงค์ยศและชื่อเรียบร้อย: สำเร็จ ${res.successCount} คน (พร้อมอัปเดตสิทธิ์การเข้าถึงศูนย์บริการและจุดรับแจ้งของหาย)` });
        }
        return;
      }

      if (commandName === 'setup-verify') {
        if (!interaction.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
          await interaction.reply({ content: '⛔ สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น', ephemeral: true });
          return;
        }
        await sendVerifyPanel(interaction.channel);
        await interaction.reply({ content: '✅ ติดตั้งแผงปุ่มยืนยันตัวตนเรียบร้อยแล้ว', ephemeral: true });
        return;
      }

      if (commandName === 'setup-leave') {
        if (!interaction.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
          await interaction.reply({ content: '⛔ สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น', ephemeral: true });
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle('📝 ระบบขอลาเวรปฏิบัติหน้าที่ | สารวัตรนักเรียน')
          .setDescription('สารวัตรนักเรียนที่มีความจำเป็นต้องลาเวร กรุณากดปุ่มด้านล่าง\n\nเมื่อส่งแล้ว ระบบจะ **ส่งข้อความแจ้งเตือนส่วนตัว (DM) ไปยังหัวหน้าและรองหัวหน้าเวรของคุณทันที**')
          .setColor('#E67E22');
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('btn_request_leave')
            .setLabel('📝 ขอลาเวรปฏิบัติหน้าที่')
            .setStyle(ButtonStyle.Danger)
        );
        await interaction.channel.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: '✅ ติดตั้งแผงปุ่มขอลาเวรเรียบร้อยแล้ว', ephemeral: true });
        return;
      }

      if (commandName === 'setup-attendance') {
        if (!interaction.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
          await interaction.reply({ content: '⛔ สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น', ephemeral: true });
          return;
        }
        await sendAttendancePanel(interaction.channel);
        await interaction.reply({ content: '✅ ติดตั้งแผงปุ่มขอใบตารางเช็คชื่อเรียบร้อยแล้ว', ephemeral: true });
        return;
      }

      if (commandName === 'setup-photo') {
        if (!interaction.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
          await interaction.reply({ content: '⛔ สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น', ephemeral: true });
          return;
        }
        await sendPhotoPanel(interaction.channel);
        await interaction.reply({ content: '✅ ติดตั้งแผงปุ่มส่งรูปถ่ายทำบัตรเรียบร้อยแล้ว', ephemeral: true });
        return;
      }

      if (commandName === 'setup-appoint') {
        if (!interaction.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
          await interaction.reply({ content: '⛔ สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น', ephemeral: true });
          return;
        }
        await sendAppointPanel(interaction.channel);
        await interaction.reply({ content: '✅ ติดตั้งแผงแต่งตั้งตำแหน่งเรียบร้อยแล้ว', ephemeral: true });
        return;
      }

      if (commandName === 'setup-all') {
        if (!interaction.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
          await interaction.reply({ content: '⛔ สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น', ephemeral: true });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        const res = await refreshAllChannelsAndPanels(interaction.guild, { purge: true });
        await interaction.editReply({
          content: `✅ เคลียร์ข้อความเก่าและติดตั้งแผงฟีเจอร์เวอร์ชันล่าสุดเรียบร้อยแล้วทั้งหมด ${res.count || 0} ช่อง!\n*(ข้อมูลสารวัตร คดี และยศทั้งหมดยังคงอยู่ครบถ้วน ไม่ใช่ D-Day)*`
        });
        return;
      }

      if (commandName === 'setup-lost-found') {
        if (!interaction.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
          await interaction.reply({ content: '⛔ สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น', ephemeral: true });
          return;
        }
        await sendLostFoundGuidePanel(interaction.channel);
        await ensureInspectorChannelAccess(interaction.guild, interaction.channel, { allowSend: true });
        await interaction.reply({ content: '✅ ติดตั้งแผงจุดรับแจ้งของหาย และตั้งค่าสิทธิ์ให้สารวัตรทุกคนส่งรูป/ข้อความได้เรียบร้อยแล้ว', ephemeral: true });
        return;
      }

      if (commandName === 'setup-service') {
        if (!interaction.member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
          await interaction.reply({ content: '⛔ สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น', ephemeral: true });
          return;
        }
        await sendInspectorServicePanel(interaction.channel);
        await ensureInspectorChannelAccess(interaction.guild, interaction.channel, { allowSend: true });
        await interaction.reply({ content: '✅ ติดตั้งแผงศูนย์บริการสารวัตร (+ขออนุญาตตัว / +ส่งหลักฐานคดี) และเปิดสิทธิ์พร้อมระบบ Auto-Clean เรียบร้อยแล้ว', ephemeral: true });
        return;
      }

      if (commandName === 'd-day') {
        const isAdmin = interaction.member?.permissions.has(PermissionsBitField.Flags.Administrator) ||
                        interaction.guild?.ownerId === interaction.user.id;
        if (!isAdmin) {
          await interaction.reply({
            content: '⛔ สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin) หรือเจ้าของเซิร์ฟเวอร์เท่านั้นในการสั่งการ D-DAY',
            ephemeral: true
          });
          return;
        }

        const ddayEmbed = new EmbedBuilder()
          .setTitle('🚨 ปฏิบัติการ D-DAY: รีเซ็ตระบบสารวัตรสู่จุดเริ่มต้น (0)')
          .setDescription(
            `⚠️ **คำเตือนความปลอดภัยขั้นสูงสุด (DESTRUCTIVE ACTION)**\n\n` +
            `คุณกำลังจะสั่งการล้างระบบสารวัตรนักเรียนทั้งหมด ข้อมูลต่อไปนี้จะถูกรีเซ็ตอย่างถาวร:\n\n` +
            `• 🗑️ **ฐานข้อมูล:** ลบข้อมูลสารวัตรทุกคนใน \`members\`, \`leave_requests\`, และ \`cases\`\n` +
            `• 🔄 **รหัสเวร:** เริ่มต้นนับ 1 ใหม่ (เช่น M1, T1, Ts1, S1)\n` +
            `• 🛡️ **ยศ Discord:** ปลดบทบาทสารวัตรและรีเซ็ตชื่อเล่นของทุกคน\n` +
            `• 🧹 **ช่องแชท:** ล้างข้อความเก่าและติดตั้งแผงระบบใหม่ในทุกช่องแชท\n\n` +
            `**หากแน่ใจ ให้กดปุ่มสีแดงด้านล่างและกรอกรหัสยืนยันเพื่อเริ่มปฏิบัติการ**`
          )
          .setColor('#ED4245')
          .setFooter({ text: 'SARAWAT-PRANARAI OS • Security Gate' })
          .setTimestamp();

        const ddayRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('btn_dday_request_confirm')
            .setLabel('🚨 เริ่มต้นกระบวนการ D-DAY')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('btn_dday_cancel')
            .setLabel('❌ ยกเลิก')
            .setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({ embeds: [ddayEmbed], components: [ddayRow], ephemeral: true });
        return;
      }

      if (commandName === 'killfile') {
        const isAdmin = interaction.member?.permissions.has(PermissionsBitField.Flags.Administrator) ||
                        interaction.guild?.ownerId === interaction.user.id;
        if (!isAdmin) {
          await interaction.reply({
            content: '⛔ สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin) หรือเจ้าของเซิร์ฟเวอร์เท่านั้นในการสั่งการ KillFile',
            ephemeral: true
          });
          return;
        }

        const killEmbed = new EmbedBuilder()
          .setTitle('🗑️ ยืนยันการล้างข้อมูลระบบของหาย (KILLFILE RESET)')
          .setDescription(
            `⚠️ **คำเตือนความปลอดภัย (DESTRUCTIVE ACTION)**\n\n` +
            `คุณกำลังจะลบข้อมูลสิ่งของและคำร้องทั้งหมดในระบบของหาย **เริ่มใหม่แต่ 0**:\n\n` +
            `• 📦 **สิ่งของที่บันทึกไว้ทั้งหมด** ในฐานข้อมูลและแคชจะถูกลบถาวร\n` +
            `• 📋 **ประวัติคำร้องขอรับของคืน** จะถูกล้างทั้งหมด\n` +
            `• 📸 **ภาพหลักฐานการส่งมอบ** ในเครื่องจะถูกเคลียร์\n` +
            `• 🔄 **ห้อง 📦│แจ้งพบของหาย** จะถูกล้างข้อความเก่าและติดตั้งแผงคู่มือใหม่\n\n` +
            `*(ข้อมูลสารวัตรนักเรียน คดี และการลาเวรจะไม่ได้รับผลกระทบ)*\n\n` +
            `**หากแน่ใจ ให้กดปุ่มยืนยันด้านล่างเพื่อเริ่มกระบวนการ**`
          )
          .setColor('#E74C3C')
          .setFooter({ text: 'SARAWAT LOST & FOUND • KillFile Reset System' });

        const killRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('btn_killfile_confirm')
            .setLabel('🗑️ ยืนยันลบทั้งหมด (เริ่มใหม่แต่ 0)')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('btn_killfile_cancel')
            .setLabel('❌ ยกเลิก')
            .setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({ embeds: [killEmbed], components: [killRow], ephemeral: true });
        return;
      }

      if (commandName === 'purge-system-data') {
        const isAdmin = interaction.member?.permissions.has(PermissionsBitField.Flags.Administrator) ||
                        interaction.guild?.ownerId === interaction.user.id;
        if (!isAdmin) {
          await interaction.reply({
            content: '⛔ สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin) หรือเจ้าของเซิร์ฟเวอร์เท่านั้นในการสั่งการ Purge',
            ephemeral: true
          });
          return;
        }

        const purgeEmbed = new EmbedBuilder()
          .setTitle('🚨 ยืนยันการล้างข้อมูลปฏิบัติการทั้งระบบ (PURGE SYSTEM DATA)')
          .setDescription(
            `⚠️ **คำเตือนความปลอดภัยระดับสูง (HIGH IMPACT ACTION)**\n\n` +
            `คำสั่งนี้จะล้างข้อมูลประวัติและข้อมูลปฏิบัติการทั้งหมด ยกเว้นข้อมูลสมาชิกสารวัตร:\n\n` +
            `• 📂 **คดีและเรื่องร้องเรียน (cases):** ล้างประวัติและหลักฐานทั้งหมด\n` +
            `• 📋 **คำขอออกตรวจและคำขอลาเวร (leave_requests):** ล้างประวัติทั้งหมด\n` +
            `• 📦 **คลังของหายและคำร้อง (lost_items & lost_claims):** ล้างทั้งหมด\n` +
            `• ⏱️ **ประวัติการลงเวลาเวร (attendance_records):** ล้างทั้งหมด\n` +
            `• 🛡️ **ข้อมูลสมาชิกสารวัตร (members):** ✅ **ปลอดภัย 100% ไม่ถูกลบ**\n\n` +
            `**หากแน่ใจ ให้กดปุ่มยืนยันด้านล่างเพื่อเริ่มกระบวนการ**`
          )
          .setColor('#C0392B')
          .setFooter({ text: 'SARAWAT OPERATIONAL PURGE • ข้อมูลสมาชิกจะไม่ได้รับผลกระทบ' });

        const purgeRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('btn_purge_sys_confirm')
            .setLabel('🚨 ยืนยันลบข้อมูลระบบทั้งหมด (ยกเว้นสมาชิก)')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('btn_purge_sys_cancel')
            .setLabel('❌ ยกเลิก')
            .setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({ embeds: [purgeEmbed], components: [purgeRow], ephemeral: true });
        return;
      }

      if (commandName === 'demote') {
        const isLeadership = interaction.member?.permissions.has(PermissionsBitField.Flags.Administrator) ||
                             (ROLE_IDS.ADMIN && interaction.member?.roles.cache.has(ROLE_IDS.ADMIN)) ||
                             interaction.member?.roles.cache.has(ROLE_IDS.PRESIDENT) ||
                             interaction.member?.roles.cache.has(ROLE_IDS.VICE_PRESIDENT) ||
                             interaction.guild?.ownerId === interaction.user.id;

        if (!isLeadership) {
          await interaction.reply({
            content: '⛔ สงวนสิทธิ์เฉพาะผู้บริหาร, ประธาน และรองประธานสารวัตรเท่านั้นในการสั่งการปลดหน้าที่',
            ephemeral: true
          });
          return;
        }

        const targetUser = interaction.options.getUser('target');
        await handleOpenDemoteMenu(interaction, targetUser);
        return;
      }

      if (commandName === 'send') {
        const isLeadership = interaction.member?.permissions.has(PermissionsBitField.Flags.Administrator) ||
                             (ROLE_IDS.ADMIN && interaction.member?.roles.cache.has(ROLE_IDS.ADMIN)) ||
                             interaction.member?.roles.cache.has(ROLE_IDS.PRESIDENT) ||
                             interaction.member?.roles.cache.has(ROLE_IDS.VICE_PRESIDENT) ||
                             interaction.guild?.ownerId === interaction.user.id;
        if (!isLeadership) {
          await interaction.reply({
            content: '⛔ สงวนสิทธิ์เฉพาะผู้บริหาร, ประธาน และรองประธานสารวัตรเท่านั้นในการประกาศข้อความ',
            ephemeral: true
          });
          return;
        }

        const msgText = interaction.options.getString('message');
        const userAvatar = interaction.user.displayAvatarURL({ dynamic: true });
        const senderName = interaction.member?.displayName || interaction.user.username;

        const broadcastEmbed = new EmbedBuilder()
          .setTitle('📢 ประกาศจากฝ่ายบริหารงานสารวัตรนักเรียน')
          .setDescription(msgText)
          .setColor('#E74C3C')
          .setAuthor({ name: `ผู้ประกาศ: ${senderName}`, iconURL: userAvatar })
          .setFooter({ text: 'ระบบสารวัตรนักเรียน • โรงเรียนพระนารายณ์' })
          .setTimestamp();

        await interaction.channel.send({
          content: '@everyone 📢 **มีประกาศด่วนจากฝ่ายบริหารงานสารวัตรนักเรียน!**',
          embeds: [broadcastEmbed]
        });

        await interaction.reply({
          content: '✅ ส่งประกาศถึงทุกคน (@everyone) ในช่องนี้เรียบร้อยแล้ว',
          ephemeral: true
        });
        return;
      }

      if (commandName === 'update') {
        const isLeadership = interaction.member?.permissions.has(PermissionsBitField.Flags.Administrator) ||
                             (ROLE_IDS.ADMIN && interaction.member?.roles.cache.has(ROLE_IDS.ADMIN)) ||
                             interaction.member?.roles.cache.has(ROLE_IDS.PRESIDENT) ||
                             interaction.member?.roles.cache.has(ROLE_IDS.VICE_PRESIDENT) ||
                             interaction.guild?.ownerId === interaction.user.id;
        if (!isLeadership) {
          await interaction.reply({
            content: '⛔ สงวนสิทธิ์เฉพาะผู้บริหาร และ Admin ในการสั่งอัปเดตระบบ',
            ephemeral: true
          });
          return;
        }

        await interaction.deferReply({ ephemeral: true });

        // 1. ซิงค์ยศและชื่อเล่น
        const roleRes = await syncAllMemberRoles(interaction.guild);

        // 2. แปลงรูป Discord CDN ที่หมดอายุเป็น Supabase ถาวร
        let rehostedCount = 0;
        try {
          const { data: cdnMembers } = await supabase
            .from('members')
            .select('id, duty_id, profile_image_url')
            .or('profile_image_url.like.%cdn.discordapp.com%,profile_image_url.like.%media.discordapp.net%');

          if (cdnMembers && cdnMembers.length > 0) {
            for (const m of cdnMembers) {
              try {
                const imgRes = await fetch(m.profile_image_url);
                if (imgRes.ok) {
                  const buf = Buffer.from(await imgRes.arrayBuffer());
                  const storagePath = `members/profile_${(m.duty_id || m.id).replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}.jpg`;
                  const { error: upErr } = await supabase.storage.from('sarawat-photos').upload(storagePath, buf, { contentType: 'image/jpeg', upsert: true });
                  if (!upErr) {
                    const { data: { publicUrl } } = supabase.storage.from('sarawat-photos').getPublicUrl(storagePath);
                    await supabase.from('members').update({ profile_image_url: publicUrl }).eq('id', m.id);
                    rehostedCount++;
                  }
                }
              } catch (e) {}
            }
          }
        } catch (e) {}

        // 3. ซิงค์สื่อทั้งหมดเข้าสู่ Google Drive
        const gdriveRes = await syncAllMediaToGoogleDrive();

        const summaryEmbed = new EmbedBuilder()
          .setTitle('🔄 อัปเดตและกู้คืนระบบฐานข้อมูลสำเร็จ')
          .setDescription(
            `ศูนย์บัญชาการสารวัตรนักเรียน ได้ตรวจสอบและอัปเดตข้อมูลสู่ฐานข้อมูลเรียบร้อยแล้ว:\n\n` +
            `• 🛡️ **ซิงค์ยศและชื่อเล่น:** สำเร็จ ${roleRes.successCount} คน (ล้มเหลว ${roleRes.failCount} คน)\n` +
            `• 📸 **กู้คืนรูปลิงก์ Discord CDN สู่ Supabase ถาวร:** ${rehostedCount} รายการ\n` +
            `• 📁 **สำรองเข้า Google Drive (SARAWAT):**\n` +
            `  - รูปโปรไฟล์: ${gdriveRes.profileCount} รูป\n` +
            `  - หลักฐานคดี & Bodycam: ${gdriveRes.evidenceCount} ไฟล์\n` +
            `  - ของหาย: ${gdriveRes.lostCount} ชิ้น\n\n` +
            `✨ *ข้อมูลสมาชิกและการสำรองข้อมูลทั้งหมดเป็นปัจจุบันแล้ว 100%*`
          )
          .setColor('#2ECC71')
          .setFooter({ text: 'SARAWAT DATABASE SYNC • โรงเรียนพระนารายณ์' })
          .setTimestamp();

        await interaction.editReply({ embeds: [summaryEmbed] });
        return;
      }
    }

    // ==========================================================
    // 🗑️ KILLFILE BUTTON HANDLING (ล้างระบบของหาย เริ่มใหม่แต่ 0)
    // ==========================================================
    if (interaction.isButton() && interaction.customId === 'btn_killfile_cancel') {
      await interaction.update({
        content: '✅ **ยกเลิกการล้างข้อมูลระบบของหายแล้ว** ข้อมูลทุกรายการยังคงปลอดภัย 100%',
        embeds: [],
        components: []
      });
      return;
    }

    if (interaction.isButton() && interaction.customId === 'btn_killfile_confirm') {
      const isAdmin = interaction.member?.permissions.has(PermissionsBitField.Flags.Administrator) ||
                      interaction.guild?.ownerId === interaction.user.id;
      if (!isAdmin) {
        await interaction.reply({
          content: '⛔ สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นในการสั่งการ KillFile',
          ephemeral: true
        });
        return;
      }

      await interaction.deferUpdate();

      const killResult = await executeKillFile(interaction.guild, interaction.user);

      const embedDone = new EmbedBuilder()
        .setTitle('🗑️ ล้างระบบของหายสำเร็จ (เริ่มใหม่แต่ 0)')
        .setDescription(
          `ศูนย์บัญชาการสารวัตรนักเรียน ได้ล้างข้อมูลระบบของหายทั้งหมดเรียบร้อยแล้ว:\n\n` +
          `• 📦 **สิ่งของที่ถูกลบ:** ${killResult.deletedItems} รายการ\n` +
          `• 📋 **คำร้องที่ถูกลบ:** ${killResult.deletedClaims} รายการ\n` +
          `• 🔄 **ห้อง 📦│แจ้งพบของหาย:** ติดตั้งแผงคู่มือใหม่เรียบร้อย (${killResult.resetChannels} ช่อง)\n\n` +
          `✨ *ระบบของหายพร้อมเริ่มรับแจ้งและส่งมอบของชิ้นใหม่จาก 0 เรียบร้อยแล้ว*`
        )
        .setColor('#2ECC71')
        .setFooter({ text: 'SARAWAT LOST & FOUND • KillFile Reset' })
        .setTimestamp();

      const btnRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('🌐 ตรวจสอบหน้าเว็บ (Web)')
          .setStyle(ButtonStyle.Link)
          .setURL(`${getWebDashboardUrl()}/lost-found`)
      );

      await interaction.editReply({
        content: '',
        embeds: [embedDone],
        components: [btnRow]
      });
      return;
    }

    // ==========================================================
    // 🚨 PURGE SYSTEM DATA BUTTON HANDLING (ลบข้อมูลระบบยกเว้นสมาชิก)
    // ==========================================================
    if (interaction.isButton() && interaction.customId === 'btn_purge_sys_cancel') {
      await interaction.update({
        content: '✅ **ยกเลิกการล้างข้อมูลระบบแล้ว** ข้อมูลทุกอย่างยังคงปลอดภัย 100%',
        embeds: [],
        components: []
      });
      return;
    }

    if (interaction.isButton() && interaction.customId === 'btn_purge_sys_confirm') {
      const isAdmin = interaction.member?.permissions.has(PermissionsBitField.Flags.Administrator) ||
                      interaction.guild?.ownerId === interaction.user.id;
      if (!isAdmin) {
        await interaction.reply({
          content: '⛔ สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นในการสั่งการ Purge',
          ephemeral: true
        });
        return;
      }

      await interaction.deferUpdate();

      const purgeResult = await executePurgeSystemData(interaction.guild, interaction.user);

      const embedDone = new EmbedBuilder()
        .setTitle('🚨 ล้างข้อมูลระบบสำเร็จ (ข้อมูลสมาชิกปลอดภัย 100%)')
        .setDescription(
          `ศูนย์บัญชาการสารวัตรนักเรียน ได้ดำเนินการล้างข้อมูลปฏิบัติการทั้งหมดเรียบร้อยแล้ว:\n\n` +
          `• 📂 **คดีและเรื่องร้องเรียนที่ถูกลบ:** ${purgeResult.deletedCases} รายการ\n` +
          `• 📋 **คำขอออกตรวจและคำขอลาเวรที่ถูกลบ:** ${purgeResult.deletedLeaves} รายการ\n` +
          `• 📦 **สิ่งของในคลังของหายที่ถูกลบ:** ${purgeResult.deletedLostItems} รายการ\n` +
          `• 📑 **คำร้องขอรับของหายที่ถูกลบ:** ${purgeResult.deletedLostClaims} รายการ\n` +
          `• ⏱️ **ประวัติลงเวลาเวรที่ถูกลบ:** ${purgeResult.deletedAttendance} รายการ\n\n` +
          `🛡️ **ข้อมูลสมาชิก (members):** ปลอดภัยครบถ้วน ไม่มีการแก้ไขหรือลบใดๆ`
        )
        .setColor('#2ECC71')
        .setFooter({ text: 'SARAWAT OPERATIONAL PURGE • ดำเนินการสำเร็จ' })
        .setTimestamp();

      await interaction.editReply({
        content: '',
        embeds: [embedDone],
        components: []
      });
      return;
    }

    // ==========================================================
    // 🚨 D-DAY SAFETY BUTTON & MODAL HANDLING
    // ==========================================================
    if (interaction.isButton() && interaction.customId === 'btn_dday_request_confirm') {
      const isAdmin = interaction.member?.permissions.has(PermissionsBitField.Flags.Administrator) ||
                      interaction.guild?.ownerId === interaction.user.id;
      if (!isAdmin) {
        await interaction.reply({
          content: '⛔ สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin) หรือเจ้าของเซิร์ฟเวอร์เท่านั้นในการสั่งการ D-DAY',
          ephemeral: true
        });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId('modal_dday_confirm')
        .setTitle('🚨 ยืนยันคำสั่ง D-DAY (รีเซ็ตระบบ)');

      const input = new TextInputBuilder()
        .setCustomId('dday_confirm_code')
        .setLabel("พิมพ์ 'CONFIRM D-DAY' ด้วยตัวพิมพ์ใหญ่")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('CONFIRM D-DAY')
        .setRequired(true)
        .setMaxLength(20);

      const row = new ActionRowBuilder().addComponents(input);
      modal.addComponents(row);
      await interaction.showModal(modal);
      return;
    }

    if (interaction.isButton() && interaction.customId === 'btn_dday_cancel') {
      await interaction.update({
        content: '✅ **ยกเลิกปฏิบัติการ D-DAY เรียบร้อยแล้ว** ข้อมูลสารวัตรและบทบาทยังคงปลอดภัย 100%',
        embeds: [],
        components: []
      });
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_dday_confirm') {
      const isAdmin = interaction.member?.permissions.has(PermissionsBitField.Flags.Administrator) ||
                      interaction.guild?.ownerId === interaction.user.id;
      if (!isAdmin) {
        await interaction.reply({
          content: '⛔ สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin) หรือเจ้าของเซิร์ฟเวอร์เท่านั้น',
          ephemeral: true
        });
        return;
      }

      const code = interaction.fields.getTextInputValue('dday_confirm_code').trim();
      if (code !== 'CONFIRM D-DAY') {
        await interaction.reply({
          content: `❌ **รหัสยืนยันไม่ถูกต้อง!** (คุณพิมพ์: \`${code}\`)\n🛑 ระบบยกเลิกคำสั่ง D-DAY ทันที ข้อมูลทั้งหมดยังคงปลอดภัย`,
          ephemeral: true
        });
        return;
      }

      await interaction.deferReply({ ephemeral: false });

      const ddayResult = await executeDDay(interaction.guild, interaction.user);

      const embedDone = new EmbedBuilder()
        .setTitle('🚨 ปฏิบัติการ D-DAY: เสร็จสมบูรณ์')
        .setDescription(
          `ศูนย์บัญชาการสารวัตรนักเรียน โรงเรียนพระนารายณ์ ได้รีเซ็ตระบบทั้งหมดสู่จุดเริ่มต้น (0) สำเร็จลุล่วงแล้ว\n\n` +
          `• 🗑️ **ฐานข้อมูล:** ลบข้อมูลสารวัตร ${ddayResult.deletedMembers} นาย, คำขอลา ${ddayResult.deletedLeaves} รายการ, คดี ${ddayResult.deletedCases} เรื่อง\n` +
          `• 🔄 **รหัสเวร:** เริ่มต้นนับ 1 ใหม่ สำหรับการลงทะเบียนใหม่ (เช่น M1, T1, Ts1, S1)\n` +
          `• 🛡️ **ยศ Discord:** ปลดบทบาทและล้างชื่อเล่นสมาชิกสารวัตรเดิม ${ddayResult.wipedMembers} นาย\n` +
          `• 🧹 **ช่องแชท:** ล้างข้อความและติดตั้งแผงระบบใหม่ใน ${ddayResult.resetChannels} ช่อง\n\n` +
          `📢 สารวัตรนักเรียนทุกท่านสามารถเริ่มลงทะเบียนใหม่ได้ทันทีที่ห้องยืนยันตัวตน`
        )
        .setColor('#2ECC71')
        .setFooter({ text: 'SARAWAT-PRANARAI OS • D-Day Reset' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embedDone] });
      return;
    }

    // กำหนดภาคเรียนปัจจุบัน (เฉพาะประธานและแอดมิน)
    if (interaction.isButton() && interaction.customId === 'btn_set_semester') {
      const isLeader = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
                       (ROLE_IDS.ADMIN && interaction.member.roles.cache.has(ROLE_IDS.ADMIN)) ||
                       interaction.member.roles.cache.has(ROLE_IDS.PRESIDENT) ||
                       interaction.member.roles.cache.has(ROLE_IDS.VICE_PRESIDENT);

      if (!isLeader) {
        await interaction.reply({
          content: '⛔ สงวนสิทธิ์เฉพาะ **ประธานสารวัตรนักเรียน** เท่านั้นในการกำหนดภาคเรียน',
          ephemeral: true
        });
        return;
      }

      const period = getAcademicPeriod();
      const modal = new ModalBuilder()
        .setCustomId('modal_set_semester')
        .setTitle('⚙️ ตั้งค่า ปีการศึกษา และ ไตรมาส');

      const yearInput = new TextInputBuilder()
        .setCustomId('input_academic_year')
        .setLabel('ปีการศึกษา (พ.ศ. เช่น 2569)')
        .setValue(String(period.academicYear))
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const quarterInput = new TextInputBuilder()
        .setCustomId('input_quarter')
        .setLabel('ไตรมาส (ระบุเลข 1, 2, 3 หรือ 4)')
        .setValue(String(period.quarter))
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const semInput = new TextInputBuilder()
        .setCustomId('input_semester')
        .setLabel('ชื่อภาคเรียน (เช่น ภาค 2 ปี 2569)')
        .setValue(period.semesterName)
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(yearInput),
        new ActionRowBuilder().addComponents(quarterInput),
        new ActionRowBuilder().addComponents(semInput)
      );
      await interaction.showModal(modal);
      return;
    }

    if (interaction.isButton() && interaction.customId === 'btn_reset_semester_auto') {
      const newPeriod = updateAcademicPeriod({ mode: 'auto' }, interaction.user.id);
      await interaction.reply({
        content: `✅ **คืนค่าตรวจจับอัตโนมัติตามปฏิทินเรียบร้อยแล้ว!**\n` +
                 `• 📅 **ไตรมาส:** ${newPeriod.quarterName}\n` +
                 `• 🎓 **ปีการศึกษา:** ${newPeriod.academicYear}\n` +
                 `• 🏫 **ภาคเรียน:** ${newPeriod.semesterName}`,
        ephemeral: true
      });
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_set_semester') {
      const acadYear = interaction.fields.getTextInputValue('input_academic_year').trim();
      const quarter = interaction.fields.getTextInputValue('input_quarter').trim();
      const newSemester = interaction.fields.fields.has('input_semester')
        ? interaction.fields.getTextInputValue('input_semester').trim()
        : null;

      const newPeriod = updateAcademicPeriod({
        academicYear: parseInt(acadYear, 10) || 2569,
        quarter: parseInt(quarter, 10) || 1,
        semester: newSemester,
        mode: 'manual'
      }, interaction.user.id);

      await interaction.reply({
        content: `✅ **บันทึกปีการศึกษาและไตรมาสสำเร็จ!**\n` +
                 `• 📅 **ไตรมาส:** ${newPeriod.quarterName}\n` +
                 `• 🎓 **ปีการศึกษา:** ${newPeriod.academicYear}\n` +
                 `• 🏫 **ภาคเรียน:** ${newPeriod.semesterName}`,
        ephemeral: true
      });

      const chAnnounce = interaction.guild.channels.cache.find(c => c.name.includes('ประกาศและมอบหมายงาน'));
      const leaderRoom = interaction.guild.channels.cache.find(c => c.name.includes('ห้องประชุมหัวหน้า'));

      const announceEmbed = new EmbedBuilder()
        .setTitle('🎓 ประกาศ: กำหนดปีการศึกษาและไตรมาสปฏิบัติหน้าที่')
        .setDescription(
          `ประธานสารวัตรนักเรียน <@${interaction.user.id}> ได้กำหนดช่วงเวลาปฏิบัติหน้าที่ใหม่:\n\n` +
          `• 📅 **ไตรมาส:** **${newPeriod.quarterName}**\n` +
          `• 🎓 **ปีการศึกษา:** **${newPeriod.academicYear}**\n` +
          `• 🏫 **ภาคเรียน:** **${newPeriod.semesterName}**\n\n` +
          `*แบบตารางเช็คชื่อ A4 และระบบสแกนเช็คชื่อทั้งหมดจะอัปเดตเป็นช่วงเวลานี้อัตโนมัติ*`
        )
        .setColor('#F1C40F')
        .setTimestamp();

      if (chAnnounce) await chAnnounce.send({ embeds: [announceEmbed] }).catch(() => {});
      if (leaderRoom) await leaderRoom.send({ embeds: [announceEmbed] }).catch(() => {});
      return;
    }

    // 0. ตรวจสอบรูปภาพโปรไฟล์ตนเอง
    if (interaction.isButton() && interaction.customId === 'btn_check_my_photo') {
      await interaction.deferReply({ ephemeral: true });
      const { data: member } = await supabase
        .from('members')
        .select('*')
        .eq('discord_id', interaction.user.id)
        .single();

      if (!member) {
        await interaction.editReply({
          content: '⚠️ ไม่พบข้อมูล: กรุณายืนยันตัวตนที่ห้อง **#🛡️│ยืนยันตัวตน** ก่อนนะครับ'
        });
        return;
      }

      if (!member.profile_image_url) {
        await interaction.editReply({
          content: `ℹ️ **${member.nickname} (${member.first_name} ${member.last_name})** ยังไม่ได้ส่งรูปโปรไฟล์ทำบัตร\nกรุณาแนบรูปหน้าตรงส่งเข้ามาในห้องนี้ได้เลย`
        });
        return;
      }

      const shiftLabel = getShiftLabel(member.duty_day);
      const dutyTag = member.duty_id ? `\`[${member.duty_id}]\`` : '`[รออนุมัติ]`';
      const statusText = member.status === 'ACTIVE' ? '✅ อนุมัติแล้ว' : '⏳ รออนุมัติ';

      const previewEmbed = new EmbedBuilder()
        .setTitle('📸 รูปทำบัตรของคุณ')
        .setDescription(
          `**${member.first_name} ${member.last_name} (${member.nickname})**\n` +
          `ม.${member.grade_class} #${member.student_no} • ${dutyTag} ${shiftLabel} • ${statusText}`
        )
        .setImage(member.profile_image_url)
        .setColor('#2ECC71');

      const cardUrl = `${getBaseUrl()}/card?id=${member.id}`;
      const cardRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('🪪 เปิดดูบัตรประจำตัว 3D')
          .setStyle(ButtonStyle.Link)
          .setURL(cardUrl)
      );

      await interaction.editReply({ embeds: [previewEmbed], components: [cardRow] });
      return;
    }

    // ==========================================================
    // 📸 PHOTO UPLOAD CHOICE: KEEP ORIGINAL OR REMOVE BACKGROUND
    // ==========================================================
    if (interaction.isButton() && (interaction.customId.startsWith('btn_photo_keep_orig_') || interaction.customId.startsWith('btn_photo_remove_bg_'))) {
      const isRemoveBg = interaction.customId.startsWith('btn_photo_remove_bg_');
      const memberId = isRemoveBg
        ? interaction.customId.replace('btn_photo_remove_bg_', '')
        : interaction.customId.replace('btn_photo_keep_orig_', '');

      const { data: member } = await supabase
        .from('members')
        .select('*')
        .eq('id', memberId)
        .maybeSingle();

      if (!member) {
        await interaction.reply({ content: '⚠️ ไม่พบข้อมูลสมาชิกในระบบ', ephemeral: true }).catch(() => {});
        return;
      }

      const isOwnerOrAdmin = interaction.user.id === member.discord_id ||
        interaction.member?.permissions.has(PermissionsBitField.Flags.Administrator);

      if (!isOwnerOrAdmin) {
        await interaction.reply({
          content: '⚠️ เฉพาะเจ้าของรูปถ่ายหรือผู้ดูแลระบบเท่านั้นที่สามารถเลือกการจัดการรูปนี้ได้',
          ephemeral: true
        }).catch(() => {});
        return;
      }

      // Find the image URL from pending cache or fallback to message embed
      const pending = pendingPhotoUploads.get(member.id);
      const rawUrl = pending?.url || interaction.message?.embeds?.[0]?.image?.url || interaction.message?.embeds?.[0]?.thumbnail?.url;

      if (!rawUrl) {
        await interaction.reply({
          content: '⚠️ ไม่พบ URL รูปภาพ กรุณาส่งรูปเข้ามาใหม่อีกครั้งที่ห้องนี้ครับ',
          ephemeral: true
        }).catch(() => {});
        return;
      }

      const shiftLabel = getShiftLabel(member.duty_day);
      const dutyTag = member.duty_id ? `\`[${member.duty_id}]\`` : '`[รออนุมัติ]`';
      const cardUrl = `${getBaseUrl()}/card?id=${member.id}`;
      const cardRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('🪪 เปิดดูบัตรประจำตัวแนวตั้ง')
          .setStyle(ButtonStyle.Link)
          .setURL(cardUrl)
      );

      if (!isRemoveBg) {
        // Option 1: Keep Original Photo
        await interaction.deferUpdate();
        await supabase
          .from('members')
          .update({ profile_image_url: rawUrl, updated_at: new Date() })
          .eq('id', member.id);

        pendingPhotoUploads.delete(member.id);

        const successEmbed = new EmbedBuilder()
          .setTitle('📸 บันทึกรูปทำบัตรสำเร็จ (รูปต้นฉบับ)')
          .setDescription(
            `ชื่อ: **${member.first_name} ${member.last_name} (${member.nickname})**\n` +
            `ชั้น: ม.${member.grade_class} #${member.student_no}\n` +
            `รหัสเวร: ${dutyTag} | เวร: ${shiftLabel}\n\n` +
            `✅ บันทึกรูปต้นฉบับเข้าสู่ระบบเรียบร้อยแล้ว`
          )
          .setImage(rawUrl)
          .setColor('#2ECC71');

        await interaction.editReply({
          content: `✅ <@${interaction.user.id}> บันทึกรูปโปรไฟล์ทำบัตรแบบต้นฉบับสำเร็จ`,
          embeds: [successEmbed],
          components: [cardRow]
        }).catch(() => {});
        return;
      } else {
        // ฟีเจอร์ตัดพื้นหลังถูกยกเลิกแล้ว -> บันทึกรูปต้นฉบับแทน
        await interaction.deferUpdate();
        await supabase
          .from('members')
          .update({ profile_image_url: rawUrl, updated_at: new Date() })
          .eq('id', member.id);

        pendingPhotoUploads.delete(member.id);

        const successEmbed = new EmbedBuilder()
          .setTitle('📸 บันทึกรูปทำบัตรสำเร็จ (รูปต้นฉบับ)')
          .setDescription(
            `ชื่อ: **${member.first_name} ${member.last_name} (${member.nickname})**\n` +
            `ชั้น: ม.${member.grade_class} #${member.student_no}\n` +
            `รหัสเวร: ${dutyTag} | เวร: ${shiftLabel}\n\n` +
            `ℹ️ ระบบได้ยกเลิกฟีเจอร์ตัดพื้นหลัง AI และบันทึกเป็นรูปต้นฉบับเข้าสู่ระบบเรียบร้อยแล้ว`
          )
          .setImage(rawUrl)
          .setColor('#2ECC71');

        await interaction.editReply({
          content: `✅ <@${interaction.user.id}> บันทึกรูปโปรไฟล์ทำบัตรสำเร็จเรียบร้อย`,
          embeds: [successEmbed],
          components: [cardRow]
        }).catch(() => {});
        return;
      }
    }

    // 📦 เมื่อผู้ใช้เลือกหมวดหมู่สิ่งของที่พบ
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_lost_cat_')) {
      const reportId = interaction.customId.replace('select_lost_cat_', '');
      const report = pendingLostReports.get(reportId);
      if (!report) {
        await interaction.reply({ content: '⚠️ รายการนี้หมดอายุแล้ว กรุณาส่งรูปภาพใหม่อีกครั้งครับ', ephemeral: true });
        return;
      }
      if (report.userId !== interaction.user.id) {
        await interaction.reply({ content: '❌ สิทธิ์นี้เฉพาะผู้ที่ส่งรูปภาพเข้ามาเท่านั้นครับ', ephemeral: true });
        return;
      }

      const selectedCat = interaction.values[0];
      report.selectedCategory = selectedCat;
      if (interaction.message?.id) {
        report.promptMessageId = interaction.message.id;
      }

      if (selectedCat === '__NEW_CATEGORY__') {
        const modal = new ModalBuilder()
          .setCustomId(`modal_lost_item_${reportId}`)
          .setTitle('✨ เพิ่มหมวดหมู่ & บันทึกสิ่งของ');

        const catInput = new TextInputBuilder()
          .setCustomId('input_new_category')
          .setLabel('ชื่อหมวดหมู่ใหม่')
          .setPlaceholder('เช่น อุปกรณ์กีฬา, แว่นตา, ร่ม')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const titleInput = new TextInputBuilder()
          .setCustomId('input_item_title')
          .setLabel('ของที่พบคืออะไร (ชื่อสิ่งของ)')
          .setPlaceholder('เช่น แว่นตากรอบดำ Ray-Ban, ลูกบาสเกตบอล')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const locInput = new TextInputBuilder()
          .setCustomId('input_item_location')
          .setLabel('หายหรือพบที่ไหน (เว้นว่างได้)')
          .setPlaceholder('เช่น หน้าห้องสมุด, โดมกิจกรรม หรือเว้นว่างได้')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(catInput),
          new ActionRowBuilder().addComponents(titleInput),
          new ActionRowBuilder().addComponents(locInput)
        );

        await interaction.showModal(modal);
      } else {
        const modal = new ModalBuilder()
          .setCustomId(`modal_lost_item_${reportId}`)
          .setTitle(`📦 ระบุรายละเอียด [${selectedCat.slice(0, 25)}]`);

        const titleInput = new TextInputBuilder()
          .setCustomId('input_item_title')
          .setLabel('ของที่พบคืออะไร (ชื่อสิ่งของ)')
          .setPlaceholder('เช่น กระเป๋าสตางค์หนัง Tough, หูฟัง AirPods Pro 2')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const locInput = new TextInputBuilder()
          .setCustomId('input_item_location')
          .setLabel('หายหรือพบที่ไหน (เว้นว่างได้)')
          .setPlaceholder('เช่น โต๊ะม้าหินอ่อนหน้าอาคาร 3 หรือเว้นว่างได้')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(titleInput),
          new ActionRowBuilder().addComponents(locInput)
        );

        await interaction.showModal(modal);
      }
      return;
    }

    // 📦 เมื่อผู้ใช้ส่งฟอร์มข้อมูลสิ่งของที่พบ
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_lost_item_')) {
      await interaction.deferReply();
      const reportId = interaction.customId.replace('modal_lost_item_', '');
      const report = pendingLostReports.get(reportId);
      if (!report) {
        await interaction.editReply({ content: '⚠️ ข้อมูลการแจ้งหมดอายุ กรุณาส่งรูปใหม่อีกครั้งครับ' });
        return;
      }

      let category = report.selectedCategory;
      if (category === '__NEW_CATEGORY__') {
        category = interaction.fields.getTextInputValue('input_new_category').trim();
        try {
          await supabase.from('lost_categories').insert({
            name: category,
            code: `CAT-${Date.now().toString(36).toUpperCase()}`,
            icon: '📦'
          });
        } catch (e) {}
      }

      const itemTitle = interaction.fields.getTextInputValue('input_item_title').trim();
      let locationFound = '-';
      try {
        const loc = interaction.fields.getTextInputValue('input_item_location')?.trim();
        if (loc) locationFound = loc;
      } catch (e) {}

      let finderName = interaction.member?.displayName || interaction.user.username;
      let finderDutyId = '-';
      let finderAvatar = interaction.user.displayAvatarURL();

      try {
        const { data: member } = await supabase
          .from('members')
          .select('*')
          .eq('discord_id', interaction.user.id)
          .maybeSingle();

        if (member) {
          const fn = member.full_name || `${member.first_name || ''} ${member.last_name || ''}`.trim();
          finderName = member.nickname ? `${fn} (${member.nickname})` : fn;
          finderDutyId = member.duty_id || '-';
          if (member.photo_url) finderAvatar = member.photo_url;
        }
      } catch (e) {}

      const now = new Date();
      const timeStr = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + ' น.';
      const dateStr = now.toISOString().slice(0, 10);
      const itemCode = `LF-${now.getFullYear()}-${String(Date.now()).slice(-4)}`;

      const newItem = {
        item_code: itemCode,
        title: itemTitle,
        category: category,
        characteristics: itemTitle,
        location_found: locationFound,
        found_date: dateStr,
        found_time: timeStr,
        status: 'WAITING_OWNER',
        storage_location: 'ห้องสารวัตรนักเรียน',
        image_url: report.attachmentUrl,
        finder_name: finderName,
        finder_duty_id: finderDutyId,
        finder_avatar_url: finderAvatar,
        created_at: now.toISOString(),
        updated_at: now.toISOString()
      };

      // 1. ซิงค์ลง Supabase Database (หากสร้างตารางไว้แล้ว)
      try {
        await supabase.from('lost_items').insert(newItem);
      } catch (e) {
        console.error('[SUPABASE INSERT LOST ITEM ERROR]:', e?.message || e);
      }

      // 2. ซิงค์ยิงตรงเข้า Web Dashboard API ผ่าน HTTP POST (ทั้ง Render & Localhost)
      const webTargets = [
        getWebDashboardUrl(),
        'https://sarawat-pranarai-web.onrender.com',
        'http://localhost:10001'
      ];
      const uniqueTargets = [...new Set(webTargets.filter(Boolean))];

      for (const targetUrl of uniqueTargets) {
        try {
          const controller = new AbortController();
          const tId = setTimeout(() => controller.abort(), 3500);
          await fetch(`${targetUrl.replace(/\/$/, '')}/api/lost-found/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newItem),
            signal: controller.signal
          });
          clearTimeout(tId);
        } catch (postErr) {
          // ไม่ขัดจังหวะกรณี target ไหนออฟไลน์
        }
      }

      // 3. ซิงค์ลงแคชไฟล์ Local (กรณีรันบนโฮสต์ที่มีโฟลเดอร์ web/data)
      try {
        const cacheTargets = [
          path.join(__dirname, '..', 'data', 'lost_found_db.json'),
          path.join(__dirname, '..', 'web', 'lost_items_cache.json'),
          path.join(__dirname, 'lost_items_cache.json')
        ];
        for (const cp of cacheTargets) {
          try {
            if (fs.existsSync(path.dirname(cp))) {
              let parsed = null;
              if (fs.existsSync(cp)) {
                parsed = JSON.parse(fs.readFileSync(cp, 'utf8') || 'null');
              }
              if (Array.isArray(parsed)) {
                parsed.unshift({ id: `lf-${Date.now()}`, ...newItem });
                fs.writeFileSync(cp, JSON.stringify(parsed, null, 2), 'utf8');
              } else if (parsed && typeof parsed === 'object') {
                parsed.items = parsed.items || [];
                parsed.items.unshift({ id: `lf-${Date.now()}`, ...newItem });
                fs.writeFileSync(cp, JSON.stringify(parsed, null, 2), 'utf8');
              }
            }
          } catch (e) {}
        }
      } catch (e) {}

      pendingLostReports.delete(reportId);

      // ลบข้อความตัวเลือกหมวดหมู่ (Prompt Message) ทันทีเมื่อทำรายการเสร็จสิ้น
      try {
        if (report.promptMessageId) {
          const ch = interaction.channel || (client.channels ? await client.channels.fetch(report.channelId).catch(() => null) : null);
          if (ch) {
            const promptMsg = await ch.messages.fetch(report.promptMessageId).catch(() => null);
            if (promptMsg && promptMsg.deletable) {
              await promptMsg.delete().catch(() => {});
            }
          }
        }
      } catch (delErr) {
        console.error('[DELETE PROMPT MESSAGE ERROR]:', delErr?.message || delErr);
      }

      const successEmbed = new EmbedBuilder()
        .setTitle(`📦 บันทึกข้อมูลของหายสำเร็จ! [${itemCode}]`)
        .setDescription(
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `🏷️ **สิ่งของ:** ${itemTitle}\n` +
          `📂 **หมวดหมู่:** ${category}\n` +
          `📍 **สถานที่พบ:** ${locationFound}\n` +
          `📅 **วันเวลา:** ${dateStr} (${timeStr})\n` +
          `🛡️ **ผู้บันทึก:** ${finderName} \`[${finderDutyId}]\`\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `*🌐 ข้อมูลและรูปภาพ (Discord CDN) ซิงค์ขึ้นศูนย์บัญชาการสารวัตรบนหน้าเว็บแล้ว*`
        )
        .setImage(report.attachmentUrl)
        .setThumbnail(finderAvatar)
        .setColor('#2ECC71')
        .setFooter({ text: 'SARAWAT LOST & FOUND • โรงเรียนพระนารายณ์' })
        .setTimestamp();

      const btnRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('🌐 เปิดดูบนหน้าเว็บ (Web)')
          .setStyle(ButtonStyle.Link)
          .setURL(`${getWebDashboardUrl()}/lost-found`)
      );

      await interaction.editReply({ embeds: [successEmbed], components: [btnRow] });
      return;
    }

    // 1. เริ่มต้นลงทะเบียนสารวัตรใหม่ (ให้เลือกระหว่าง [🎒 สารวัตรนักเรียน] และ [👨‍🏫 ครูที่ปรึกษา])
    if (interaction.isButton() && interaction.customId === 'btn_start_verify') {
      // ตรวจสอบว่าบัญชีนี้ได้รับการอนุมัติเป็นสารวัตรอยู่แล้วหรือไม่
      const { data: existingActive } = await supabase
        .from('members')
        .select('*')
        .eq('discord_id', interaction.user.id)
        .eq('status', 'ACTIVE')
        .maybeSingle();

      if (existingActive) {
        const isTeacher = existingActive.role === 'TEACHER';
        const roleLabel = isTeacher ? '👨‍🏫 ครูที่ปรึกษา' :
                          (existingActive.role === 'ADMIN' ? '⚡ ผู้ดูแลระบบ' :
                          (existingActive.shift_role === 'SHIFT_HEAD' ? '👑 หัวหน้าเวร' :
                          (existingActive.shift_role === 'SHIFT_DEPUTY' ? '🎖️ รองหัวหน้าเวร' : 'สารวัตรประจำเวร')));
        const dutyText = isTeacher ? 'ครูที่ปรึกษางานสารวัตร (ทุกวัน/ทุกผลัด)' : getShiftLabel(existingActive.duty_day);
        await interaction.reply({
          content: `✅ คุณได้รับการยืนยันตัวตนและอนุมัติในระบบแล้ว:\n` +
                   `• ชื่อ: ${existingActive.first_name} ${existingActive.last_name} (${existingActive.nickname})\n` +
                   `• ตำแหน่ง: ${roleLabel}\n` +
                   `• สังกัด/เวร: ${dutyText}\n\n` +
                   `*(หากต้องการอัปเดตรูปถ่ายทำบัตร สามารถส่งรูปใหม่เข้ามาในช่องนี้ได้ตลอดเวลาครับ)*`,
          ephemeral: true
        });
        return;
      }

      // 🌟 ขั้นตอนที่ 1: ให้เลือกระหว่าง [🎒 สารวัตรนักเรียน] หรือ [👨‍🏫 ครูที่ปรึกษา]
      const chooseRoleEmbed = new EmbedBuilder()
        .setTitle('🛡️ เลือกประเภทการลงทะเบียนสารวัตร')
        .setDescription(
          'ยินดีต้อนรับสู่ระบบบริหารงานสารวัตรนักเรียน โรงเรียนพระนารายณ์\n\n' +
          'โปรดเลือกประเภทผู้ใช้งานของคุณ เพื่อเข้าสู่แบบฟอร์มลงทะเบียนที่เหมาะสม:\n\n' +
          '• **[🎒 สารวัตรนักเรียน]** สำหรับนักเรียนที่ปฏิบัติหน้าที่สารวัตรประจำวัน\n' +
          '• **[👨‍🏫 ครูที่ปรึกษา]** สำหรับคณะครูและอาจารย์ที่ปรึกษางานสารวัตรนักเรียน'
        )
        .setColor('#3498DB')
        .setFooter({ text: 'ฝ่ายบริหารงานสารวัตรนักเรียน • โรงเรียนพระนารายณ์' });

      const chooseRoleRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('btn_reg_choose_student')
          .setLabel('🎒 สารวัตรนักเรียน (นักเรียน)')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('btn_reg_choose_teacher')
          .setLabel('👨‍🏫 ครูที่ปรึกษา (คุณครู)')
          .setStyle(ButtonStyle.Success)
      );

      await interaction.reply({
        embeds: [chooseRoleEmbed],
        components: [chooseRoleRow],
        ephemeral: true
      });
      return;
    }

    if (interaction.isButton() && interaction.customId === 'btn_reg_choose_student') {
      const modal = new ModalBuilder()
        .setCustomId('modal_new_member')
        .setTitle('📝 แบบฟอร์มลงทะเบียนสารวัตรใหม่');

      const nameInput = new TextInputBuilder()
        .setCustomId('input_full_name')
        .setLabel('ชื่อจริง-นามสกุล (มี นาย/นาง/นางสาว ติดชื่อ)')
        .setPlaceholder('เช่น นายสมชาย ใจดี หรือ นางสาวสมหญิง รักเรียน')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const nicknameInput = new TextInputBuilder()
        .setCustomId('input_nickname')
        .setLabel('ชื่อเล่น')
        .setPlaceholder('เช่น น้ำเหนือ, ปัน, นน')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const classInput = new TextInputBuilder()
        .setCustomId('input_class')
        .setLabel('ระดับชั้น (เช่น 6/7, 4/10 ไม่ต้องใส่ ม.)')
        .setPlaceholder('เช่น 6/7, 4/10, 5/2 (ห้ามใส่ ม.)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const noInput = new TextInputBuilder()
        .setCustomId('input_no')
        .setLabel('เลขที่')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const phoneInput = new TextInputBuilder()
        .setCustomId('input_phone')
        .setLabel('เบอร์โทรศัพท์ (เช่น 0891234567)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(nicknameInput),
        new ActionRowBuilder().addComponents(classInput),
        new ActionRowBuilder().addComponents(noInput),
        new ActionRowBuilder().addComponents(phoneInput)
      );

      await interaction.showModal(modal);
      return;
    }

    if (interaction.isButton() && interaction.customId === 'btn_reg_choose_teacher') {
      const modal = new ModalBuilder()
        .setCustomId('modal_teacher_register')
        .setTitle('👨‍🏫 แบบฟอร์มลงทะเบียนครูที่ปรึกษา');

      const nameInput = new TextInputBuilder()
        .setCustomId('input_teacher_full_name')
        .setLabel('ชื่อจริง-นามสกุล (มี นาย/นาง/นางสาว/ครู ติดชื่อ)')
        .setPlaceholder('เช่น นายสมศักดิ์ สุขใจ หรือ นางสาวพัชรี มีสุข')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const nicknameInput = new TextInputBuilder()
        .setCustomId('input_teacher_nickname')
        .setLabel('ชื่อเล่น หรือ ชื่อที่ให้เรียก')
        .setPlaceholder('เช่น ครูหนึ่ง, ครูกบ, ครูบอย')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const deptInput = new TextInputBuilder()
        .setCustomId('input_teacher_dept')
        .setLabel('กลุ่มสาระการเรียนรู้ / กลุ่มงานที่สังกัด')
        .setPlaceholder('เช่น ภาษาไทย, กิจการนักเรียน, วิทยาศาสตร์')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const phoneInput = new TextInputBuilder()
        .setCustomId('input_teacher_phone')
        .setLabel('เบอร์โทรศัพท์ติดต่อ')
        .setPlaceholder('เช่น 0891234567')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(nicknameInput),
        new ActionRowBuilder().addComponents(deptInput),
        new ActionRowBuilder().addComponents(phoneInput)
      );

      await interaction.showModal(modal);
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_member_identity') {
      const selectedValue = interaction.values[0];

      if (selectedValue === 'action_add_new_member') {
        const modal = new ModalBuilder()
          .setCustomId('modal_new_member')
          .setTitle('📝 แบบฟอร์มเพิ่มชื่อสารวัตรใหม่');

        const nameInput = new TextInputBuilder()
          .setCustomId('input_full_name')
          .setLabel('ชื่อจริง-นามสกุล (มี นาย/นาง/นางสาว ติดชื่อ)')
          .setPlaceholder('เช่น นายสมชาย ใจดี หรือ นางสาวสมหญิง รักเรียน')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const nicknameInput = new TextInputBuilder()
          .setCustomId('input_nickname')
          .setLabel('ชื่อเล่น')
          .setPlaceholder('เช่น น้ำเหนือ, ปัน, นน')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const classInput = new TextInputBuilder()
          .setCustomId('input_class')
          .setLabel('ระดับชั้น (เช่น 6/7, 4/10 ไม่ต้องใส่ ม.)')
          .setPlaceholder('เช่น 6/7, 4/10, 5/2 (ห้ามใส่ ม.)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const noInput = new TextInputBuilder()
          .setCustomId('input_no')
          .setLabel('เลขที่')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const phoneInput = new TextInputBuilder()
          .setCustomId('input_phone')
          .setLabel('เบอร์โทรศัพท์ (เช่น 0891234567)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(nameInput),
          new ActionRowBuilder().addComponents(nicknameInput),
          new ActionRowBuilder().addComponents(classInput),
          new ActionRowBuilder().addComponents(noInput),
          new ActionRowBuilder().addComponents(phoneInput)
        );

        await interaction.showModal(modal);
        return;
      }

      const { data: member } = await supabase.from('members').select('*').eq('id', selectedValue).single();

      if (!member.phone_number) {
        const phoneModal = new ModalBuilder()
          .setCustomId(`modal_fill_phone_${member.id}`)
          .setTitle('📞 ระบุเบอร์โทรศัพท์เพื่อยืนยัน');

        const phoneInput = new TextInputBuilder()
          .setCustomId('input_phone')
          .setLabel('เบอร์โทรศัพท์ (เช่น 0891234567)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        phoneModal.addComponents(new ActionRowBuilder().addComponents(phoneInput));
        await interaction.showModal(phoneModal);
        return;
      }

      const confirmEmbed = new EmbedBuilder()
        .setTitle('🛡️ [ขั้นตอนที่ 1/3] ตรวจสอบข้อมูลตัวตนของคุณ')
        .setColor('#3498DB')
        .setDescription(
          `โปรดตรวจสอบข้อมูลด้านล่างนี้ว่าถูกต้องและตรงกับตัวคุณหรือไม่\n\n` +
          `👤 **ชื่อ-นามสกุล:** ${member.first_name} ${member.last_name} (**${member.nickname}**)\n` +
          `🏫 **ชั้นเรียน:** มัธยมศึกษาปีที่ **${member.grade_class}** (เลขที่ **${member.student_no}**)\n` +
          `📞 **เบอร์โทรศัพท์:** \`${member.phone_number || '-'}\`\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `🔹 **สถานะขั้นตอน:** 🟩⬜⬜ (ขั้นตอนที่ 1 จาก 3)`
        );

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`btn_confirm_identity_${member.id}`)
          .setLabel('✅ ข้อมูลถูกต้อง ยืนยันตัวตน')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('btn_start_verify')
          .setLabel('↩️ ไม่ใช่ / เลือกชื่อใหม่')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.update({
        embeds: [confirmEmbed],
        content: null,
        components: [confirmRow]
      });
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_new_member') {
      await interaction.deferReply({ ephemeral: true });

      const rawFullName = interaction.fields.getTextInputValue('input_full_name').trim();
      const nickname = interaction.fields.getTextInputValue('input_nickname').trim();
      const rawClass = interaction.fields.getTextInputValue('input_class').trim();
      const studentNo = parseInt(interaction.fields.getTextInputValue('input_no').trim(), 10) || 0;
      const phone = interaction.fields.getTextInputValue('input_phone').trim();

      // 1. ตรวจสอบและจัดระเบียบคำนำหน้าชื่อจริง (ต้องขึ้นต้นด้วย นาย/นาง/นางสาว ติดกับชื่อจริงเลย)
      const cleanedFullName = cleanFullName(rawFullName);
      if (!/^(นาย|นางสาว|นาง|ด\.ช\.|ด\.ญ\.)/.test(cleanedFullName)) {
        await interaction.editReply({
          content: '❌ **ข้อมูลชื่อจริงไม่ถูกต้อง:** ต้องขึ้นต้นด้วยคำนำหน้า **นาย**, **นาง** หรือ **นางสาว** ติดกับชื่อจริงเลย\n*(ตัวอย่างที่ถูกต้อง: `นายสมชาย ใจดี` หรือ `นางสาวสมหญิง รักเรียน`)*'
        });
        return;
      }

      // 2. จัดรูปแบบระดับชั้น (ตัด "ม." ออก เอาเฉพาะ เลข/เลข เช่น 6/7, 4/10)
      const cleanedGradeClass = cleanGradeClass(rawClass);
      if (!cleanedGradeClass || !/^[1-6]\/[0-9]+$/.test(cleanedGradeClass)) {
        await interaction.editReply({
          content: '❌ **ข้อมูลระดับชั้นไม่ถูกต้อง:** กรุณาระบุเฉพาะเลขชั้น/ห้อง เช่น `6/7`, `4/10`, `5/2` *(ไม่ต้องใส่ "ม.")*'
        });
        return;
      }

      const nameParts = cleanedFullName.split(' ');
      const firstName = nameParts[0] || cleanedFullName;
      const lastName = nameParts.slice(1).join(' ') || '-';

      // 3. ตรวจสอบข้อมูลสมาชิกเดิม (ค้นหาตาม discord_id ก่อน ไม่ว่าจะสถานะใด เพื่อป้องกัน UNIQUE constraint collision)
      let existingMember = null;
      try {
        const { data: byDiscord } = await supabase
          .from('members')
          .select('id, status, duty_day, duty_id')
          .eq('discord_id', interaction.user.id)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (byDiscord?.id) existingMember = byDiscord;

        if (!existingMember) {
          const { data: byName } = await supabase
            .from('members')
            .select('id, status, duty_day, duty_id')
            .eq('first_name', firstName)
            .eq('last_name', lastName)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (byName?.id) existingMember = byName;
        }
      } catch (e) {
        console.warn('[CHECK EXISTING MEMBER NOTICE]:', e.message);
      }

      let newMember = null;
      if (existingMember?.id) {
        // หากผู้ใช้นี้มี discord_id ผูกกับแถวอื่น ให้ปลดล็อกแถวอื่นก่อนเพื่อความปลอดภัย
        await supabase
          .from('members')
          .update({ discord_id: null })
          .eq('discord_id', interaction.user.id)
          .neq('id', existingMember.id);

        const updatePayload = {
          first_name: firstName,
          last_name: lastName,
          nickname: nickname,
          grade_class: cleanedGradeClass,
          student_no: studentNo,
          phone_number: phone,
          discord_id: interaction.user.id,
          updated_at: new Date()
        };
        // ถ้าสถานะเดิมไม่ใช่ ACTIVE ให้ตั้งเป็น PENDING_APPROVAL
        if (existingMember.status !== 'ACTIVE') {
          updatePayload.status = 'PENDING_APPROVAL';
        }

        const { data: updatedMember, error: upErr } = await supabase
          .from('members')
          .update(updatePayload)
          .eq('id', existingMember.id)
          .select()
          .single();

        if (upErr) throw upErr;
        newMember = updatedMember;
      } else {
        // เคลียร์ discord_id ออกจากแถวอื่นที่อาจตกค้างก่อน insert
        await supabase
          .from('members')
          .update({ discord_id: null })
          .eq('discord_id', interaction.user.id);

        const { data: insertedMember, error: inErr } = await supabase
          .from('members')
          .insert({
            first_name: firstName,
            last_name: lastName,
            nickname: nickname,
            grade_class: cleanedGradeClass,
            student_no: studentNo,
            phone_number: phone,
            discord_id: interaction.user.id,
            role: 'MEMBER',
            shift_role: 'MEMBER',
            status: 'PENDING_APPROVAL'
          })
          .select()
          .single();

        if (inErr) throw inErr;
        newMember = insertedMember;
      }

      await showDutySelection(interaction, newMember.id, nickname, `${firstName} ${lastName}`);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_teacher_register') {
      await interaction.deferReply({ ephemeral: true });

      const rawFullName = interaction.fields.getTextInputValue('input_teacher_full_name').trim();
      const nickname = interaction.fields.getTextInputValue('input_teacher_nickname').trim();
      const rawDept = interaction.fields.getTextInputValue('input_teacher_dept').trim();
      const phone = interaction.fields.getTextInputValue('input_teacher_phone').trim();

      const cleanedFullName = cleanFullName(rawFullName);
      const nameParts = cleanedFullName.split(' ');
      const firstName = nameParts[0] || cleanedFullName;
      const lastName = nameParts.slice(1).join(' ') || '-';
      const dept = `กลุ่มสาระฯ ${rawDept.replace('กลุ่มสาระฯ', '').replace('กลุ่มสาระ', '').trim()}`;

      // ตรวจสอบสมาชิกเดิม
      let existingMember = null;
      try {
        const { data: byDiscord } = await supabase
          .from('members')
          .select('id, status, role')
          .eq('discord_id', interaction.user.id)
          .maybeSingle();
        if (byDiscord) existingMember = byDiscord;
      } catch (e) {}

      let teacherMember = null;
      if (existingMember?.id) {
        await supabase
          .from('members')
          .update({ discord_id: null })
          .eq('discord_id', interaction.user.id)
          .neq('id', existingMember.id);

        const { data: updated, error: upErr } = await supabase
          .from('members')
          .update({
            first_name: firstName,
            last_name: lastName,
            nickname: nickname,
            grade_class: dept,
            student_no: null,
            phone_number: phone,
            duty_day: 'ALL',
            duty_id: null,
            role: 'TEACHER',
            shift_role: 'TEACHER',
            discord_id: interaction.user.id,
            status: existingMember.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING_APPROVAL',
            updated_at: new Date()
          })
          .eq('id', existingMember.id)
          .select()
          .single();
        if (upErr) throw upErr;
        teacherMember = updated;
      } else {
        await supabase
          .from('members')
          .update({ discord_id: null })
          .eq('discord_id', interaction.user.id);

        const { data: inserted, error: inErr } = await supabase
          .from('members')
          .insert({
            first_name: firstName,
            last_name: lastName,
            nickname: nickname,
            grade_class: dept,
            student_no: null,
            phone_number: phone,
            duty_day: 'ALL',
            duty_id: null,
            role: 'TEACHER',
            shift_role: 'TEACHER',
            discord_id: interaction.user.id,
            status: 'PENDING_APPROVAL'
          })
          .select()
          .single();
        if (inErr) throw inErr;
        teacherMember = inserted;
      }

      // ส่งข้อความแจ้งให้ครูแนบรูปถ่ายหน้าตรงในช่องนี้
      const teacherSuccessEmbed = new EmbedBuilder()
        .setTitle('✅ บันทึกข้อมูลครูที่ปรึกษาเรียบร้อยแล้ว')
        .setDescription(
          `สวัสดีครับ อาจารย์ **${firstName} ${lastName} (${nickname})**\n` +
          `• 🏫 **สังกัด:** ${dept}\n` +
          `• 📞 **เบอร์ติดต่อ:** ${phone}\n` +
          `• 🎖️ **ตำแหน่ง:** 👨‍🏫 ครูที่ปรึกษางานสารวัตรนักเรียน\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `📸 **ขั้นตอนสุดท้าย: แนบรูปถ่ายหน้าตรงเพื่อทำบัตรประจำตัว (3D Card)**\n` +
          `โปรดส่งรูปถ่ายหน้าตรงในเครื่องแบบของคุณครู เข้ามาในห้องนี้ได้ทันที\n` +
          `เมื่อส่งรูปแล้ว ระบบจะประมวลผลและส่งคำขออนุมัติไปยังคณะผู้บริหารโดยอัตโนมัติครับ\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━`
        )
        .setColor('#F1C40F')
        .setFooter({ text: 'ระบบลงทะเบียนครูที่ปรึกษา • โรงเรียนพระนารายณ์' });

      await interaction.editReply({ embeds: [teacherSuccessEmbed] });
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_fill_phone_')) {
      const memberId = interaction.customId.replace('modal_fill_phone_', '');
      const phone = interaction.fields.getTextInputValue('input_phone').trim();

      await supabase.from('members').update({ phone_number: phone }).eq('id', memberId);
      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).single();
      await showDutySelection(interaction, member.id, member.nickname, `${member.first_name} ${member.last_name}`);
    }

    if (interaction.isButton() && interaction.customId.startsWith('btn_confirm_identity_')) {
      const memberId = interaction.customId.replace('btn_confirm_identity_', '');
      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).single();
      await showDutySelection(interaction, member.id, member.nickname, `${member.first_name} ${member.last_name}`);
    }

    // 2. เลือกเวรประจำสัปดาห์ (จันทร์ - ศุกร์) -> ขั้นถัดไปถามเรื่องเวรพิเศษ
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_duty_day_')) {
      await interaction.deferUpdate();
      const memberId = interaction.customId.replace('select_duty_day_', '');
      const selectedWeekday = interaction.values[0];

      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).single();
      const weekdayName = DAY_NAMES[selectedWeekday] || selectedWeekday;
      const specialCodePreview = selectedWeekday === 'Ts' ? 'TSS' : `${selectedWeekday}S`;

      // สร้างปุ่มถามว่า เป็นเวรพิเศษ (ปฏิบัติหน้าที่ทุกวัน) ด้วยหรือไม่?
      const specialEmbed = new EmbedBuilder()
        .setTitle('⭐ [ขั้นตอนที่ 2/3] เลือกลักษณะการปฏิบัติหน้าที่')
        .setColor('#9B59B6')
        .setDescription(
          `คุณได้เลือกวันเวรหลักเรียบร้อยแล้ว โปรดระบุว่าคุณเป็น **เวรพิเศษ** หรือไม่\n\n` +
          `👤 **สารวัตร:** ${member?.first_name || ''} ${member?.last_name || ''} (**${member?.nickname || ''}**)\n` +
          `📅 **เวรประจำวันหลัก:** **เวรวัน${weekdayName}** (\`${selectedWeekday}\`)\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `📌 **คำอธิบายความแตกต่าง:**\n` +
          `• **เวรพิเศษ (มาทุกวัน):** ได้รับรหัส \`[${specialCodePreview}]\` ปฏิบัติหน้าที่อำนวยความสะดวกทุกวัน\n` +
          `• **เวรเฉพาะวัน:** ปฏิบัติหน้าที่เฉพาะวัน${weekdayName} เท่านั้น ได้รับรหัส \`[${selectedWeekday}]\`\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `🔹 **สถานะขั้นตอน:** 🟩🟩⬜ (ขั้นตอนที่ 2 จาก 3)`
        );

      const specialRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`btn_special_shift_yes_${memberId}_${selectedWeekday}`)
          .setLabel('⭐ ใช่ เป็นเวรพิเศษ (มาทุกวัน)')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`btn_special_shift_no_${memberId}_${selectedWeekday}`)
          .setLabel('👤 ปฏิบัติหน้าที่เฉพาะวันเท่านั้น')
          .setStyle(ButtonStyle.Secondary)
      );

      const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`btn_back_to_duty_${memberId}`)
          .setLabel('↩️ ย้อนกลับไปเลือกวันเวรใหม่')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({
        embeds: [specialEmbed],
        content: null,
        components: [specialRow, backRow]
      });
      return;
    }

    // ปุ่มย้อนกลับไปเลือกวันเวรประจำสัปดาห์ใหม่
    if (interaction.isButton() && interaction.customId.startsWith('btn_back_to_duty_')) {
      await interaction.deferUpdate();
      const memberId = interaction.customId.replace('btn_back_to_duty_', '');
      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).single();
      if (member) {
        await showDutySelection(interaction, member.id, member.nickname, `${member.first_name} ${member.last_name}`);
      }
      return;
    }

    // จัดการการเลือกเวรพิเศษ (ใช่ / ไม่ใช่) แล้วส่งให้ผู้บริหารอนุมัติ
    if (interaction.isButton() && (interaction.customId.startsWith('btn_special_shift_yes_') || interaction.customId.startsWith('btn_special_shift_no_'))) {
      await interaction.deferUpdate();
      const isSpecial = interaction.customId.startsWith('btn_special_shift_yes_');
      const prefix = isSpecial ? 'btn_special_shift_yes_' : 'btn_special_shift_no_';
      const parts = interaction.customId.replace(prefix, '').split('_');
      const memberId = parts[0];
      const weekday = parts[1] || 'M';

      // ถ้าเป็นเวรพิเศษ รหัสผลัดจะเป็น: M -> MS, T -> TS, W -> WS, Ts -> TSS, F -> FS
      const effectiveDutyDay = isSpecial ? (weekday === 'Ts' ? 'TSS' : `${weekday}S`) : weekday;

      // เคลียร์ discord_id ออกจากแถวอื่นของผู้ใช้นี้ก่อน เพื่อป้องกัน UNIQUE constraint collision
      await supabase
        .from('members')
        .update({ discord_id: null })
        .eq('discord_id', interaction.user.id)
        .neq('id', memberId);

      const { error: updateErr } = await supabase
        .from('members')
        .update({
          discord_id: interaction.user.id,
          duty_day: effectiveDutyDay,
          status: 'PENDING_APPROVAL',
          updated_at: new Date()
        })
        .eq('id', memberId);

      if (updateErr) {
        console.error('Failed to update member duty_day/discord_id in special selection:', updateErr);
      }

      if (ROLE_IDS.UNVERIFIED) {
        try {
          const gm = await interaction.guild.members.fetch(interaction.user.id);
          await gm.roles.add(ROLE_IDS.UNVERIFIED).catch(() => {});
        } catch (e) {}
      }

      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).single();

      const shiftLabel = getShiftLabel(effectiveDutyDay);

      const promptPhotoEmbed = new EmbedBuilder()
        .setTitle('📸 [ขั้นตอนสุดท้าย] กรุณาส่งรูปถ่ายหน้าตรงของคุณ')
        .setColor('#F39C12')
        .setDescription(
          `ระบบได้บันทึกข้อมูลส่วนตัวของ **${member.first_name} ${member.last_name} (${member.nickname})** เรียบร้อยแล้ว!\n\n` +
          `👉 **ส่งรูปในช่องนี้เพื่ออัพโหลดรูปหน้าคุณ**\n` +
          `*(แนบไฟล์รูปถ่ายหน้าตรงในเครื่องแบบของคุณ เพื่อนำไปจัดทำบัตรประจำตัวและส่งขออนุมัติ)*\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `💡 *เมื่อคุณส่งรูปเข้ามาในช่องนี้แล้ว บอทจะบันทึกรูปและให้คุณตรวจสอบเพื่อกดยืนยันก่อนเสนอผู้บริหารทันที*`
        )
        .setFooter({ text: 'ระบบลงทะเบียนสารวัตร • โรงเรียนพระนารายณ์' });

      await interaction.editReply({
        embeds: [promptPhotoEmbed],
        content: null,
        components: []
      });
      return;
    }

/**
 * 🛡️ สร้าง Rich Embed และแถบปุ่มสำหรับหน้าตรวจสอบข้อมูลสารวัตรและรูปถ่ายก่อนส่งขออนุมัติ
 */
function buildPreApprovalEmbed(member, photoUrl, cropUrl) {
  const isTeacher = member.role === 'TEACHER';
  const isCropped = !!(member.photo_cropped_at);
  const isSpecial = member.duty_day && member.duty_day.endsWith('S');
  const weekday = member.duty_day ? (member.duty_day === 'TSS' ? 'Ts' : member.duty_day.replace(/S+$/, '') || member.duty_day) : 'M';
  const weekdayName = DAY_NAMES[weekday] || weekday;
  const shiftLabel = isTeacher ? '👨‍🏫 ครูที่ปรึกษา (ทุกวัน/ทุกผลัด)' : getShiftLabel(member.duty_day);

  const fields = [
    { name: '👤 ชื่อ-นามสกุล', value: `\`${member.first_name} ${member.last_name}\``, inline: true },
    { name: '🏷️ ชื่อเล่น', value: `\`${member.nickname || '-'}\``, inline: true }
  ];

  if (isTeacher) {
    fields.push({ name: '🏫 กลุ่มสาระ/สังกัด', value: `\`${member.grade_class || 'กลุ่มสาระการเรียนรู้'}\``, inline: true });
    fields.push({ name: '📞 เบอร์โทรศัพท์', value: `\`${member.phone_number || '-'}\``, inline: true });
    fields.push({ name: '🎖️ ตำแหน่ง / หน้าที่', value: '**👨‍🏫 ครูที่ปรึกษางานสารวัตร**', inline: true });
  } else {
    fields.push({ name: '🏫 ชั้น / เลขที่', value: `ม.\`${member.grade_class || '-'}\` เลขที่ \`#${member.student_no || '-'}\``, inline: true });
    fields.push({ name: '📞 เบอร์โทรศัพท์', value: `\`${member.phone_number || '-'}\``, inline: true });
    fields.push({ name: '📅 วันปฏิบัติหน้าที่', value: `วัน${weekdayName} (\`${weekday}\`)`, inline: true });
    fields.push({ name: '🏷️ ผลัดเวรสุทธิ', value: `**${shiftLabel}** ${isSpecial ? '⭐' : ''}`, inline: true });
  }

  fields.push({
    name: '📸 สถานะรูปถ่าย',
    value: isCropped
      ? '✅ **ปรับแต่ง/ครอปรูปขนาด 1 นิ้ว เรียบร้อยแล้ว** (มาตรฐานรูปหน้าปกเอกสาร พร้อมจัดทำบัตรดิจิทัล 3D)'
      : '⚠️ **รูปถ่ายต้นฉบับ (ยังไม่ได้ครอป 1 นิ้ว)** — แนะนำให้กดปุ่มครอปรูปบนเว็บเพื่อความสวยงามเหมือนหน้าปกเอกสาร',
    inline: false
  });

  const embed = new EmbedBuilder()
    .setTitle(isTeacher ? '👨‍🏫 ตรวจสอบข้อมูลการลงทะเบียนครูที่ปรึกษา [ก่อนส่งขออนุมัติ]' : '🛡️ ตรวจสอบข้อมูลการลงทะเบียนสารวัตร [ก่อนส่งขออนุมัติ]')
    .setDescription(
      `สวัสดีครับ ${isTeacher ? 'อาจารย์' : 'คุณ'} **${member.first_name} ${member.last_name} (${member.nickname})**\n` +
      `โปรดตรวจสอบข้อมูลส่วนตัวและรูปถ่ายทำบัตรของคุณด้านล่างให้ถูกต้องครบถ้วน:\n\n` +
      `• **หากข้อมูลและรูปถูกต้องแล้ว:** กด **"✅ ยืนยันข้อมูล & ส่งขออนุมัติ"**\n` +
      `• **หากเพิ่งตัดต่อ/ครอปรูปบนเว็บมา:** กด **"🔄 รีเฟรชรูปภาพ"** เพื่อดึงรูปใหม่ทันที\n` +
      `• **หากต้องการปรับตำแหน่งรูป:** กด **"🔲 ปรับแต่ง/ครอปรูปบนเว็บ"** (ขนาด 1 นิ้ว)`
    )
    .addFields(fields)
    .setImage(photoUrl)
    .setColor(isTeacher ? '#F1C40F' : (isCropped ? '#2ECC71' : '#3498DB'))
    .setFooter({ text: 'ระบบลงทะเบียนสารวัตร • โรงเรียนพระนารายณ์ (ข้อความนี้เห็นเฉพาะคุณ)' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`btn_confirm_photo_${member.id}`)
      .setLabel('✅ ยืนยันข้อมูล & ส่งขออนุมัติ')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setLabel('🔲 ปรับแต่ง/ครอปรูปบนเว็บ')
      .setStyle(ButtonStyle.Link)
      .setURL(cropUrl),
    new ButtonBuilder()
      .setCustomId(`btn_refresh_photo_${member.id}`)
      .setLabel('🔄 รีเฟรชรูปภาพ')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`btn_reupload_photo_${member.id}`)
      .setLabel('❌ เปลี่ยนรูปใหม่')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embed, row };
}

    // 👁️ ปุ่มตรวจสอบสถานะการสมัครของฉันบนแผงลงทะเบียน (เฉพาะบุคคล - Ephemeral)
    if (interaction.isButton() && interaction.customId === 'btn_check_my_registration_status') {
      const { data: member } = await supabase
        .from('members')
        .select('*')
        .eq('discord_id', interaction.user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!member) {
        await interaction.reply({
          content: '⚠️ ไม่พบข้อมูลการลงทะเบียนของคุณในระบบ กรุณากดปุ่ม **"🛡️ เริ่มต้นลงทะเบียนสารวัตร"** ด้านบนเพื่อเริ่มต้นลงทะเบียนครับ',
          ephemeral: true
        });
        return;
      }

      if (member.status === 'ACTIVE') {
        const activeEmbed = new EmbedBuilder()
          .setTitle('✅ คุณเป็นสารวัตรนักเรียนที่ได้รับการอนุมัติแล้ว')
          .setDescription(
            `สวัสดีครับคุณ **${member.first_name} ${member.last_name} (${member.nickname || '-'})**\n` +
            `รหัสเวร: \`[${member.duty_id || 'สารวัตร'}]\` | ผลัด: \`${member.duty_day || '-'}\`\n\n` +
            `บัตรประจำตัวสารวัตรดิจิทัล 3D ของคุณพร้อมใช้งานแล้ว สามารถกดดูได้ที่ปุ่มด้านล่างครับ`
          )
          .setColor('#2ECC71')
          .setFooter({ text: 'ระบบบริการสารวัตร • โรงเรียนพระนารายณ์ (ข้อความนี้เห็นเฉพาะคุณ)' });

        const activeRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel('🪪 เปิดดูบัตรประจำตัว 3D')
            .setStyle(ButtonStyle.Link)
            .setURL(`${getWebDashboardUrl()}/card?id=${member.id}`)
        );

        await interaction.reply({ embeds: [activeEmbed], components: [activeRow], ephemeral: true });
        return;
      }

      if (member.status === 'PENDING_APPROVAL') {
        const pendingEmbed = new EmbedBuilder()
          .setTitle('⏳ ข้อมูลของคุณอยู่ระหว่างรอคณะผู้บริหารตรวจสอบและอนุมัติ')
          .setDescription(
            `สวัสดีครับคุณ **${member.first_name} ${member.last_name} (${member.nickname || '-'})**\n` +
            `คำขอลงทะเบียนและรูปถ่ายของคุณได้ถูกส่งไปยังห้องประชุมของคณะผู้บริหารแล้ว\n\n` +
            `เมื่อได้รับการอนุมัติเรียบร้อย บอทจะแจ้งเตือนและจัดทำ **บัตรประจำตัวสารวัตร 3D** ให้คุณทันทีครับ!`
          )
          .setImage(member.profile_image_url)
          .setColor('#F59E0B')
          .setFooter({ text: 'ระบบลงทะเบียนสารวัตร • โรงเรียนพระนารายณ์ (ข้อความนี้เห็นเฉพาะคุณ)' });

        await interaction.reply({ embeds: [pendingEmbed], ephemeral: true });
        return;
      }

      // หากมีรูปหรือยังไม่ได้ยืนยัน ให้เปิดการ์ดตรวจสอบข้อมูลส่วนตัว
      const { embed, row } = buildPrivateReviewCard(member);
      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      return;
    }

    // 🛡️ ปุ่มเปิดดูข้อมูลส่วนตัวและรูปถ่ายขนาด 1 นิ้ว (เฉพาะบุคคล - Ephemeral)
    if (interaction.isButton() && (interaction.customId.startsWith('btn_view_private_profile_') || interaction.customId.startsWith('btn_view_photo_'))) {
      const isProfile = interaction.customId.startsWith('btn_view_private_profile_');
      const memberId = interaction.customId.replace(isProfile ? 'btn_view_private_profile_' : 'btn_view_photo_', '');
      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).maybeSingle();
      if (!member || member.discord_id !== interaction.user.id) {
        await interaction.reply({ content: '⛔ เมนูนี้สามารถดูได้เฉพาะเจ้าของข้อมูลเท่านั้นครับ', ephemeral: true });
        return;
      }

      const { embed, row } = buildPrivateReviewCard(member);

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [embed], components: [row] });
      } else {
        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      }
      return;
    }

    // ✏️ ปุ่มเมนูเลือกรายการแก้ไขข้อมูลผู้สมัคร (ตัวอักษร หรือ รูปภาพ)
    if (interaction.isButton() && interaction.customId.startsWith('btn_edit_registration_info_')) {
      const memberId = interaction.customId.replace('btn_edit_registration_info_', '');
      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).maybeSingle();
      if (!member || member.discord_id !== interaction.user.id) {
        await interaction.reply({ content: '⛔ เมนูนี้เฉพาะเจ้าของข้อมูลเท่านั้นครับ', ephemeral: true });
        return;
      }

      const editMenuEmbed = new EmbedBuilder()
        .setTitle('✏️ เลือกรายการที่ต้องการแก้ไข')
        .setDescription(
          `คุณ **${member.first_name} ${member.last_name} (${member.nickname || '-'})** สามารถเลือกแก้ไขได้ดังนี้:\n\n` +
          `1️⃣ **[✏️ แก้ไขข้อมูลตัวอักษร]** — แก้ไขชื่อ-สกุล, ชื่อเล่น, ชั้น/ห้อง, เลขที่, หรือเบอร์โทรศัพท์\n` +
          `2️⃣ **[🔄 เปลี่ยนรูปถ่ายใหม่]** — ยกเลิกรูปถ่ายปัจจุบัน และส่งรูปถ่ายหน้าตรงรูปใหม่`
        )
        .setColor('#F39C12')
        .setFooter({ text: 'ระบบลงทะเบียนสารวัตร • โรงเรียนพระนารายณ์ (ข้อความนี้เห็นเฉพาะคุณ)' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`btn_edit_reg_text_${member.id}`)
          .setLabel('✏️ แก้ไขข้อมูลตัวอักษร')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`btn_reupload_photo_${member.id}`)
          .setLabel('🔄 เปลี่ยนรูปถ่ายใหม่')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`btn_view_private_profile_${member.id}`)
          .setLabel('⬅️ ย้อนกลับ')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.update({
        embeds: [editMenuEmbed],
        components: [row]
      });
      return;
    }

    // ✏️ ปุ่มเปิด Modal แก้ไขข้อมูลตัวอักษร
    if (interaction.isButton() && interaction.customId.startsWith('btn_edit_reg_text_')) {
      const memberId = interaction.customId.replace('btn_edit_reg_text_', '');
      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).maybeSingle();
      if (!member || member.discord_id !== interaction.user.id) {
        await interaction.reply({ content: '⛔ เมนูนี้เฉพาะเจ้าของข้อมูลเท่านั้นครับ', ephemeral: true });
        return;
      }

      const modal = buildRegistrationEditModal(member);
      await interaction.showModal(modal);
      return;
    }

    // 📝 จัดการการส่ง Modal แก้ไขข้อมูลผู้สมัคร
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_edit_reg_')) {
      await interaction.deferUpdate();
      const memberId = interaction.customId.replace('modal_edit_reg_', '');
      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).maybeSingle();
      if (!member || member.discord_id !== interaction.user.id) {
        return;
      }

      const rawFullName = interaction.fields.getTextInputValue('input_name').trim();
      const nickname = interaction.fields.getTextInputValue('input_nickname').trim();
      const rawClass = interaction.fields.getTextInputValue('input_grade').trim();
      const studentNo = parseInt(interaction.fields.getTextInputValue('input_student_no').trim(), 10) || member.student_no;
      const phone = interaction.fields.getTextInputValue('input_phone').trim();

      const cleanedFullName = cleanFullName(rawFullName);
      const cleanedGradeClass = cleanGradeClass(rawClass) || member.grade_class;
      const nameParts = cleanedFullName.split(' ');
      const firstName = nameParts[0] || cleanedFullName;
      const lastName = nameParts.slice(1).join(' ') || member.last_name;

      await supabase
        .from('members')
        .update({
          first_name: firstName,
          last_name: lastName,
          nickname: nickname,
          grade_class: cleanedGradeClass,
          student_no: studentNo,
          phone_number: phone,
          updated_at: new Date()
        })
        .eq('id', member.id);

      const { data: updatedMember } = await supabase.from('members').select('*').eq('id', member.id).single();
      const { embed, row } = buildPrivateReviewCard(updatedMember);

      await interaction.editReply({
        content: `✅ บันทึกการแก้ไขข้อมูลเรียบร้อยแล้ว! โปรดตรวจสอบข้อมูลและกดยืนยันด้านล่าง:`,
        embeds: [embed],
        components: [row]
      });
      return;
    }

    // 🔄 รีเฟรชรูปภาพเพื่อดึงรูปที่เพิ่งครอปบนเว็บมาแสดงทันที
    if (interaction.isButton() && interaction.customId.startsWith('btn_refresh_photo_')) {
      const memberId = interaction.customId.replace('btn_refresh_photo_', '');
      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).maybeSingle();
      if (!member || member.discord_id !== interaction.user.id) {
        await interaction.reply({ content: '⛔ เมนูนี้เฉพาะเจ้าของรูปภาพเท่านั้นครับ', ephemeral: true });
        return;
      }

      const pending = pendingPhotoConfirmations.get(memberId);
      const photoUrl = (member.photo_cropped_at && member.profile_image_url)
        ? member.profile_image_url
        : (pending?.photoUrl || member.profile_image_url);

      if (!photoUrl) {
        await interaction.reply({ content: '⚠️ ไม่พบข้อมูลรูปถ่าย กรุณาส่งรูปใหม่อีกครั้งในช่องนี้ครับ', ephemeral: true });
        return;
      }

      let cropUrl = pending?.cropUrl;
      if (!cropUrl) {
        const cropToken = crypto.randomBytes(32).toString('hex');
        try {
          await supabase.from('crop_tokens').insert({
            token: cropToken,
            member_id: member.id,
            discord_id: interaction.user.id,
            source_image_url: photoUrl,
            expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
          });
          cropUrl = `${getWebDashboardUrl()}/crop?token=${cropToken}`;
        } catch (e) {
          cropUrl = `${getWebDashboardUrl()}/crop`;
        }
      }

      const { embed, row } = buildPreApprovalEmbed(member, photoUrl, cropUrl);

      await interaction.update({
        embeds: [embed],
        components: [row]
      });
      return;
    }

    // 📸 จัดการปุ่มยืนยันหรือเปลี่ยนรูปถ่ายหน้าตรงสารวัตร (ก่อนส่งขออนุมัติ)
    if (interaction.isButton() && (interaction.customId.startsWith('btn_confirm_photo_') || interaction.customId.startsWith('btn_confirm_send_approval_') || interaction.customId.startsWith('btn_reupload_photo_'))) {
      const isConfirm = interaction.customId.startsWith('btn_confirm_photo_') || interaction.customId.startsWith('btn_confirm_send_approval_');
      const memberId = interaction.customId
        .replace('btn_confirm_send_approval_', '')
        .replace('btn_confirm_photo_', '')
        .replace('btn_reupload_photo_', '');

      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).maybeSingle();
      if (!member || member.discord_id !== interaction.user.id) {
        await interaction.reply({ content: '⛔ ปุ่มนี้สำหรับเจ้าของข้อมูลเท่านั้นครับ', ephemeral: true });
        return;
      }

      const pending = pendingPhotoConfirmations.get(memberId);

      if (!isConfirm) {
        // กดยกเลิก / ขอเปลี่ยนรูปภาพใหม่ -> นำผู้ใช้กลับสู่กระบวนการส่งรูปใหม่อีกครั้ง
        const isServiceUpdate = pending?.isServiceUpdate;
        pendingPhotoConfirmations.delete(memberId);
        if (isServiceUpdate && member.discord_id) {
          activeServicePhotoSessions.set(member.discord_id, {
            member,
            timestamp: Date.now()
          });
        }
        await interaction.update({
          content: `🔄 <@${interaction.user.id}> คุณได้ยกเลิกรูปถ่ายเดิมเรียบร้อยแล้ว **กรุณาแนบและส่งรูปถ่ายหน้าตรงรูปใหม่ในช่องนี้ได้เลยครับ**`,
          embeds: [],
          components: []
        }).catch(async () => {
          await interaction.reply({
            content: `🔄 <@${interaction.user.id}> คุณได้ยกเลิกรูปถ่ายเดิมเรียบร้อยแล้ว **กรุณาแนบและส่งรูปถ่ายหน้าตรงรูปใหม่ในช่องนี้ได้เลยครับ**`,
            ephemeral: false
          }).catch(() => {});
        });
        return;
      }

      // อัปเดตหรือลบข้อความ Prompt ในช่องสาธารณะเพื่อให้ห้องสะอาด (กรณีไม่ได้กดจากข้อความ Prompt นั้นโดยตรง)
      if (pending?.promptMsgId && pending?.channelId && (!interaction.message || interaction.message.id !== pending.promptMsgId)) {
        try {
          const ch = await client.channels.fetch(pending.channelId).catch(() => null);
          if (ch) {
            const pMsg = await ch.messages.fetch(pending.promptMsgId).catch(() => null);
            if (pMsg) {
              await pMsg.edit({
                content: `⏳ <@${member.discord_id}> ได้ยืนยันข้อมูลและส่งคำขออนุมัติไปยังคณะผู้บริหารแล้ว`,
                embeds: [{
                  title: '⏳ ส่งคำขออนุมัติเรียบร้อยแล้ว [รอการตรวจสอบ]',
                  description: `คำขอลงทะเบียนของ <@${member.discord_id}> ได้ถูกส่งไปยังคณะผู้บริหารเรียบร้อยแล้ว กรุณารอการพิจารณาอนุมัติครับ`,
                  color: 0xF59E0B,
                  footer: { text: 'ระบบลงทะเบียนสารวัตร • โรงเรียนพระนารายณ์' },
                  timestamp: new Date().toISOString()
                }],
                components: []
              }).catch(() => {});
            }
          }
        } catch (e) {}
      }

      // กดยืนยันใช้รูปนี้ -> บันทึกลง Supabase และส่งขออนุมัติเข้าห้องประชุมหัวหน้าทันที
      await interaction.deferUpdate();
      // หากผู้ใช้ไปครอปรูปบนเว็บมาแล้ว ให้ใช้รูปที่ครอปแล้ว (จากฐานข้อมูล) เป็นอันดับแรก
      const photoUrl = (member.photo_cropped_at && member.profile_image_url)
        ? member.profile_image_url
        : (pending?.photoUrl || member.profile_image_url);
      pendingPhotoConfirmations.delete(memberId);

      // บันทึกตำแหน่งข้อความยืนยันในห้องแชท เพื่อตามไปลบอัตโนมัติเมื่ออนุมัติ/ปฏิเสธ
      const promptChanId = interaction.channelId;
      const promptMsgId = interaction.message?.id || pending?.promptMsgId;
      if (promptChanId && promptMsgId) {
        pendingPromptMessages.set(member.id, { channelId: promptChanId, messageId: promptMsgId, timestamp: Date.now() });
        try {
          await supabase.from('crop_tokens').upsert({
            token: `prompt_msg_${member.id}`,
            member_id: member.id,
            discord_id: interaction.user.id,
            source_image_url: `discord_prompt:${promptChanId}:${promptMsgId}`,
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
          }, { onConflict: 'token' });
        } catch (tokenErr) {
          console.warn('[PROMPT MSG TRACK NOTICE]:', tokenErr.message);
        }
      }

      await supabase.from('members').update({
        profile_image_url: photoUrl,
        status: 'PENDING_APPROVAL',
        updated_at: new Date()
      }).eq('id', member.id);

      // สำรองรูปภาพเข้า Google Drive เบื้องหลัง (หากยังไม่ได้อัปโหลดผ่านหน้าเว็บครอป)
      if (!member.gdrive_file_id && (pending?.filename || photoUrl)) {
        (async () => {
          try {
            const imgFetch = await fetch(photoUrl);
            if (imgFetch.ok) {
              const buf = Buffer.from(await imgFetch.arrayBuffer());
              const gName = pending?.filename || `member_${(member.duty_id || 'SW').replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}.jpg`;
              const gRes = await uploadToGoogleDrive(buf, gName, {
                memberName: `${member.first_name || ''} ${member.last_name || ''}`.trim(),
                dutyId: member.duty_id || '-'
              });
              if (gRes && gRes.success) {
                await supabase.from('members').update({
                  gdrive_file_id: gRes.fileId,
                  gdrive_file_url: gRes.webViewLink
                }).eq('id', member.id);
              }
            }
          } catch (gErr) {
            console.warn('[GDRIVE BACKGROUND BACKUP NOTICE]:', gErr.message);
          }
        })();
      }

      const shiftLabel = getShiftLabel(member.duty_day);
      const isSpecial = member.duty_day && member.duty_day.endsWith('S');
      const weekday = member.duty_day ? (member.duty_day === 'TSS' ? 'Ts' : member.duty_day.replace(/S+$/, '') || member.duty_day) : 'M';
      const weekdayName = DAY_NAMES[weekday] || weekday;

      const doneEmbed = new EmbedBuilder()
        .setTitle('✅ ยืนยันข้อมูลและส่งคำขออนุมัติเรียบร้อยแล้ว')
        .setDescription(
          `ระบบได้บันทึกข้อมูลและส่งคำขอลงทะเบียนของคุณไปยังห้องประชุมของคณะผู้บริหารแล้ว!\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━`
        )
        .addFields(
          { name: '👤 สารวัตร', value: `\`${member.first_name} ${member.last_name}\` (\`${member.nickname}\`)`, inline: true },
          { name: '🏫 ชั้น / เลขที่', value: `ม.\`${member.grade_class}\` เลขที่ \`#${member.student_no}\``, inline: true },
          { name: '📞 เบอร์โทรศัพท์', value: `\`${member.phone_number || '-'}\``, inline: true },
          { name: '📅 วันปฏิบัติหน้าที่', value: `วัน${weekdayName} (\`${weekday}\`)`, inline: true },
          { name: '🏷️ ผลัดเวรสุทธิ', value: `**${shiftLabel}** ${isSpecial ? '⭐' : ''}`, inline: true },
          { name: '⏳ สถานะ', value: '⏳ **รอการอนุมัติ (PENDING APPROVAL)**', inline: true }
        )
        .setImage(photoUrl)
        .setColor('#2ECC71')
        .setFooter({ text: 'ระบบลงทะเบียนสารวัตร • โรงเรียนพระนารายณ์ (ข้อความนี้เห็นเฉพาะคุณ)' })
        .setTimestamp();

      await interaction.editReply({
        content: `✅ <@${interaction.user.id}> ดำเนินการส่งคำขออนุมัติเรียบร้อยแล้ว`,
        embeds: [doneEmbed],
        components: []
      });

      // ส่งการ์ดขออนุมัติเข้าห้องประชุมหัวหน้า พร้อมรูปถ่ายขนาดใหญ่
      let approvalChannel = null;
      const targetApprovalId = APPROVAL_CHANNEL_ID || '1567570916932722778';
      approvalChannel = await client.channels.fetch(targetApprovalId).catch(() => null);

      if (!approvalChannel && interaction.guild) {
        approvalChannel = interaction.guild.channels.cache.find(c =>
          c.isTextBased() && (c.name.includes('อนุมัติ') || c.name.includes('ห้องประชุมหัวหน้า') || c.name.includes('ผู้นำ-all-in-one'))
        ) || null;
      }

      if (approvalChannel) {
        const isTeacher = member.role === 'TEACHER' || member.shift_role === 'TEACHER';
        const isSpecial = member.duty_day && member.duty_day.endsWith('S');
        const weekday = member.duty_day ? (member.duty_day === 'TSS' ? 'Ts' : member.duty_day.replace(/S+$/, '') || member.duty_day) : 'M';
        const weekdayName = DAY_NAMES[weekday] || weekday;

        const metaTag = (promptChanId && promptMsgId) ? ` • [msg:${promptChanId}:${promptMsgId}]` : '';

        const approvalEmbed = isTeacher
          ? new EmbedBuilder()
              .setTitle('👨‍🏫 คำขอลงทะเบียนครูที่ปรึกษา [รอการตรวจสอบ]')
              .setDescription(
                `มีคุณครูทำรายการลงทะเบียนครูที่ปรึกษาฝ่ายสารวัตรเข้ามาใหม่ โปรดตรวจสอบและดำเนินการอนุมัติ\n\n` +
                `👤 **ชื่อ-สกุล:** ${member.first_name} ${member.last_name} (**ครู${member.nickname}**)\n` +
                `🏢 **กลุ่มสาระฯ / ฝ่าย:** ${member.grade_class || 'ครูที่ปรึกษา'}\n` +
                `📞 **เบอร์โทรศัพท์:** \`${member.phone_number || '-'}\`\n` +
                `🎖️ **บทบาท:** 👨‍🏫 ครูที่ปรึกษาฝ่ายสารวัตร (Teacher Advisor)\n` +
                `💬 **บัญชี Discord:** <@${interaction.user.id}> (\`${interaction.user.tag}\`)`
              )
              .setImage(photoUrl)
              .setColor('#F1C40F')
              .setFooter({ text: `ระบบลงทะเบียนครูที่ปรึกษา • โรงเรียนพระนารายณ์${metaTag}` })
              .setTimestamp()
          : new EmbedBuilder()
              .setTitle('📋 คำขอลงทะเบียนสารวัตรใหม่ [รอการตรวจสอบ]')
              .setDescription(
                `มีสารวัตรนักเรียนทำรายการลงทะเบียนและส่งรูปถ่ายเข้ามาใหม่ โปรดตรวจสอบและดำเนินการ\n\n` +
                `👤 **ชื่อ-สกุล:** ${member.first_name} ${member.last_name} (**${member.nickname}**)\n` +
                `🏫 **ชั้นเรียน:** ม.${member.grade_class} (เลขที่ ${member.student_no})\n` +
                `📞 **เบอร์โทรศัพท์:** \`${member.phone_number || '-'}\`\n` +
                `📅 **เวรประจำวัน:** วัน${weekdayName} (\`${weekday}\`)\n` +
                `⭐ **ลักษณะเวร:** ${isSpecial ? `⭐ **เวรพิเศษ (ทุกวัน)** [ผลัด \`${member.duty_day}\`]` : `👤 เวรเฉพาะวัน [ผลัด \`${member.duty_day}\`]`}\n` +
                `🏷️ **ผลัดเวรสุทธิ:** **${shiftLabel}**\n` +
                `💬 **บัญชี Discord:** <@${interaction.user.id}> (\`${interaction.user.tag}\`)`
              )
              .setImage(photoUrl)
              .setColor(isSpecial ? '#9B59B6' : '#F39C12')
              .setFooter({ text: `ระบบลงทะเบียนสารวัตร • โรงเรียนพระนารายณ์${metaTag}` })
              .setTimestamp();

        const actionRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`btn_approve_member_${member.id}`)
            .setLabel('✅ อนุมัติการลงทะเบียน')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`btn_reject_member_${member.id}`)
            .setLabel('❌ ปฏิเสธคำขอ')
            .setStyle(ButtonStyle.Danger)
        );

        await approvalChannel.send({ embeds: [approvalEmbed], components: [actionRow] }).catch(err => {
          console.error('[APPROVAL SEND ERROR]:', err);
        });
      }
      return;
    }

    // 3. จัดการการอนุมัติโดยผู้บริหาร + แจกยศหัวหน้า/รองหัวหน้าเวรเฉพาะวัน
    if (interaction.isButton() && (interaction.customId.startsWith('btn_approve_member_') || interaction.customId.startsWith('btn_reject_member_'))) {
      const isLeader = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
                       (ROLE_IDS.ADMIN && interaction.member.roles.cache.has(ROLE_IDS.ADMIN)) ||
                       (ROLE_IDS.TEACHER && interaction.member.roles.cache.has(ROLE_IDS.TEACHER)) ||
                       interaction.member.roles.cache.has(ROLE_IDS.PRESIDENT) ||
                       interaction.member.roles.cache.has(ROLE_IDS.VICE_PRESIDENT);

      if (!isLeader) {
        await interaction.reply({ content: '⛔ คุณไม่มีสิทธิ์ในการอนุมัติสมาชิก (สงวนสิทธิ์เฉพาะคณะผู้บริหารและหัวหน้างาน)', ephemeral: true });
        return;
      }

      await interaction.deferUpdate();

      if (interaction.customId.startsWith('btn_approve_member_')) {
        const memberId = interaction.customId.replace('btn_approve_member_', '');
        const { data: member } = await supabase.from('members').select('*').eq('id', memberId).single();

        if (!member) {
          await interaction.editReply({ content: '❌ ไม่พบข้อมูลสมาชิกในระบบ', components: [] });
          return;
        }

        // 🧹 ลบข้อความการ์ดยืนยันในห้องลงทะเบียนทันทีเมื่อได้รับอนุมัติ
        await deleteRegistrationPromptMessage(memberId, interaction, member);

        // กู้คืนรอบเวรและ discord_id จากการ์ด embed อัตโนมัติ (ป้องกันกรณีหลุดเป็น null)
        let dutyDay = member.duty_day;
        if (!dutyDay && interaction.message?.embeds?.[0]?.description) {
          const desc = interaction.message.embeds[0].description;
          const match = desc.match(/(?:เวร|ผลัดเวรสุทธิ):\s*(.+)/);
          if (match) {
            const shiftText = match[1];
            if (shiftText.includes('(MS)') || (shiftText.includes('จันทร์') && shiftText.includes('พิเศษ'))) dutyDay = 'MS';
            else if (shiftText.includes('(TS)') || (shiftText.includes('อังคาร') && shiftText.includes('พิเศษ'))) dutyDay = 'TS';
            else if (shiftText.includes('(WS)') || (shiftText.includes('พุธ') && shiftText.includes('พิเศษ'))) dutyDay = 'WS';
            else if (shiftText.includes('(TSS)') || shiftText.includes('(TsS)') || (shiftText.includes('พฤหัส') && shiftText.includes('พิเศษ'))) dutyDay = 'TSS';
            else if (shiftText.includes('(FS)') || (shiftText.includes('ศุกร์') && shiftText.includes('พิเศษ'))) dutyDay = 'FS';
            else if (shiftText.includes('(M)') || shiftText.includes('จันทร์')) dutyDay = 'M';
            else if (shiftText.includes('(T)') || shiftText.includes('อังคาร')) dutyDay = 'T';
            else if (shiftText.includes('(W)') || shiftText.includes('พุธ')) dutyDay = 'W';
            else if (shiftText.includes('(Ts)') || shiftText.includes('พฤหัส')) dutyDay = 'Ts';
            else if (shiftText.includes('(F)') || shiftText.includes('ศุกร์')) dutyDay = 'F';
            else if (shiftText.includes('(S)') || shiftText.includes('พิเศษ')) dutyDay = 'S';
          }
        }

        let discordId = member.discord_id;
        if (!discordId && interaction.message?.embeds?.[0]?.description) {
          const desc = interaction.message.embeds[0].description;
          const dMatch = desc.match(/<@(\d+)>/);
          if (dMatch) {
            discordId = dMatch[1];
            await supabase.from('members').update({ discord_id: null }).eq('discord_id', discordId).neq('id', memberId);
          }
        }

        const isTeacher = member.role === 'TEACHER';
        const effectiveDutyDay = isTeacher ? 'ALL' : (dutyDay || 'M');
        const dutyId = isTeacher ? null : await getNextAvailableDutyId(supabase, effectiveDutyDay);

        await supabase
          .from('members')
          .update({
            status: 'ACTIVE',
            duty_day: effectiveDutyDay,
            duty_id: dutyId,
            discord_id: discordId || member.discord_id,
            approved_by: interaction.user.id,
            approved_at: new Date(),
            updated_at: new Date()
          })
          .eq('id', memberId);

        member.duty_day = effectiveDutyDay;
        member.duty_id = dutyId;
        member.discord_id = discordId || member.discord_id;

        let roleErrorNote = '';
        if (member.discord_id) {
          try {
            const guildMember = await interaction.guild.members.fetch(member.discord_id).catch(() => null);
            if (guildMember && typeof guildMember.roles?.add === 'function') {
              if (typeof guildMember.setNickname === 'function') {
                const newNickname = isTeacher
                  ? `[ครูที่ปรึกษา] ${member.nickname} (${member.first_name})`
                  : `[${dutyId}] ${member.nickname} (${member.first_name})`;
                await guildMember.setNickname(newNickname.slice(0, 32)).catch((err) => {
                  console.warn('Cannot set nickname (likely Server Owner):', err.message);
                });
              }

              const rolesToAdd = isTeacher
                ? [ROLE_IDS.VERIFIED, ROLE_IDS.TEACHER].filter(Boolean)
                : [ROLE_IDS.VERIFIED, ...getDutyRoles(member.duty_day)];
              if (member.role === 'ADMIN' && ROLE_IDS.ADMIN) rolesToAdd.push(ROLE_IDS.ADMIN);
              if (member.role === 'TEACHER' && ROLE_IDS.TEACHER) rolesToAdd.push(ROLE_IDS.TEACHER);
              if (member.role === 'PRESIDENT' && ROLE_IDS.PRESIDENT) rolesToAdd.push(ROLE_IDS.PRESIDENT);
              if (member.role === 'VICE_PRESIDENT' && ROLE_IDS.VICE_PRESIDENT) rolesToAdd.push(ROLE_IDS.VICE_PRESIDENT);
              
              // แจกยศหัวหน้าเวร / รองหัวหน้าเวรประจำวันนั้นๆ
              const baseDay = member.duty_day === 'S' ? 'S' : (member.duty_day === 'TSS' ? 'Ts' : (member.duty_day.replace(/S+$/, '') || member.duty_day));
              if (member.shift_role === 'SHIFT_HEAD') {
                if (ROLE_IDS.HEADS[baseDay]) rolesToAdd.push(ROLE_IDS.HEADS[baseDay]);
                if (member.duty_day.endsWith('S') && ROLE_IDS.HEAD_S) rolesToAdd.push(ROLE_IDS.HEAD_S);
              }
              if (member.shift_role === 'SHIFT_DEPUTY') {
                if (ROLE_IDS.DEPUTIES[baseDay]) rolesToAdd.push(ROLE_IDS.DEPUTIES[baseDay]);
                if (member.duty_day.endsWith('S') && ROLE_IDS.DEPUTY_S) rolesToAdd.push(ROLE_IDS.DEPUTY_S);
              }

              const validApprovedRoles = rolesToAdd.filter(rid => rid && interaction.guild.roles.cache.has(rid));
              if (validApprovedRoles.length > 0) {
                await guildMember.roles.add(validApprovedRoles).catch((err) => {
                  console.error('[ROLE ADD ERROR]:', err);
                  if (err.message && err.message.includes('Missing Permissions')) {
                    roleErrorNote = '\n⚠️ **เตือน:** บอทไม่มีสิทธิ์แจกยศเนื่องจาก **ลำดับยศ SARAWAT-BOT ต่ำกว่ายศอื่น** (กรุณาลากยศบอทขึ้นบนสุดใน Server Settings > Roles แล้วพิมพ์ `!sync-roles`)';
                  } else {
                    roleErrorNote = `\n⚠️ **เตือนเรื่องยศ:** ${err.message}`;
                  }
                });
              }

              // ถอดถอนยศเวรเก่าที่ตกค้างออก
              const allDayRoles = Object.values(ROLE_IDS.DAYS || {}).filter(rid => rid && interaction.guild.roles.cache.has(rid));
              const obsoleteDayRoles = allDayRoles.filter(rid => !validApprovedRoles.includes(rid) && guildMember.roles.cache.has(rid));
              if (obsoleteDayRoles.length > 0) {
                await guildMember.roles.remove(obsoleteDayRoles).catch((err) => {
                  console.error('[ROLE REMOVE OBSOLETE ERROR]:', err);
                });
              }

              if (ROLE_IDS.UNVERIFIED && guildMember.roles.cache.has(ROLE_IDS.UNVERIFIED)) {
                await guildMember.roles.remove(ROLE_IDS.UNVERIFIED).catch(() => {});
              }

              const shiftLabel = getShiftLabel(member.duty_day);
              const cardUrl = `${getBaseUrl()}/card?id=${member.id}`;
              const dmRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setLabel('🪪 เปิดดูบัตรประจำตัวสารวัตร')
                  .setStyle(ButtonStyle.Link)
                  .setURL(cardUrl)
              );

              const dmEmbed = new EmbedBuilder()
                .setTitle('🎉 ยินดีด้วย! คำขอลงทะเบียนได้รับการอนุมัติแล้ว')
                .setColor('#2ECC71')
                .setDescription(
                  `คุณได้รับการอนุมัติเป็นสารวัตรนักเรียนโรงเรียนพระนารายณ์เรียบร้อยแล้ว\n\n` +
                  `🆔 **รหัสประจำตัว:** \`[${dutyId}]\`\n` +
                  `👤 **ชื่อเล่น:** คุณ**${member.nickname}** (${member.first_name})\n` +
                  `📅 **รอบการปฏิบัติหน้าที่:** **${shiftLabel}**\n\n` +
                  `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                  `🪪 **บัตรประจำตัวดิจิทัล 3D:** พร้อมใช้งานแล้ว สามารถกดเปิดดูบัตรได้ที่ปุ่มด้านล่าง\n` +
                  `*(หากต้องการอัปเดตรูปถ่ายใหม่ สามารถส่งรูปเข้ามาในห้องลงทะเบียนได้ตลอดเวลา)*`
                )
                .setFooter({ text: 'คณะกรรมการสารวัตรนักเรียน โรงเรียนพระนารายณ์' });

              if (member.profile_image_url) {
                dmEmbed.setThumbnail(member.profile_image_url);
              }

              await guildMember.send({ embeds: [dmEmbed], components: [dmRow] }).catch(() => {});
            }
          } catch (e) {
            console.warn('Error applying approved member roles/DM:', e.message);
          }
        }

        const shiftLabel = getShiftLabel(member.duty_day);
        const approvedEmbed = new EmbedBuilder()
          .setTitle('✅ อนุมัติสารวัตรนักเรียนเรียบร้อยแล้ว')
          .setColor('#2ECC71')
          .setDescription(
            `สารวัตรนักเรียนได้รับการตรวจสอบและอนุมัติเข้าสู่ระบบอย่างเป็นทางการ\n\n` +
            `🆔 **รหัสประจำตัว:** \`[${dutyId}]\`\n` +
            `👤 **ชื่อ-สกุล:** ${member.first_name} ${member.last_name} (**${member.nickname}**)\n` +
            `📅 **ผลัดเวร:** **${shiftLabel}**\n` +
            `💬 **ผู้ใช้งาน:** <@${member.discord_id}>\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `👮 **ผู้อนุมัติ:** <@${interaction.user.id}>\n` +
            `⏰ **เวลาอนุมัติ:** <t:${Math.floor(Date.now() / 1000)}:F>${roleErrorNote}`
          )
          .setFooter({ text: 'บันทึกการอนุมัติเสร็จสมบูรณ์ • โรงเรียนพระนารายณ์' })
          .setTimestamp();

        await interaction.editReply({
          embeds: [approvedEmbed],
          content: null,
          components: []
        });
      }

      if (interaction.customId.startsWith('btn_reject_member_')) {
        const memberId = interaction.customId.replace('btn_reject_member_', '');
        const { data: member } = await supabase.from('members').select('*').eq('id', memberId).maybeSingle();

        // 🧹 ลบข้อความการ์ดยืนยันในห้องลงทะเบียนทันทีเมื่อถูกปฏิเสธคำขอ
        await deleteRegistrationPromptMessage(memberId, interaction, member);

        await supabase.from('members').update({ status: 'REJECTED' }).eq('id', memberId);

        if (member && member.discord_id) {
          try {
            const guildMember = await interaction.guild.members.fetch(member.discord_id).catch(() => null);
            if (guildMember && typeof guildMember.send === 'function') {
              const dmRejectEmbed = new EmbedBuilder()
                .setTitle('⚠️ ผลการพิจารณาการลงทะเบียนสารวัตร')
                .setColor('#E74C3C')
                .setDescription(
                  `สวัสดีครับคุณ **${member.nickname || member.first_name}**\n\n` +
                  `คำขอลงทะเบียนสารวัตรนักเรียนของคุณ **ไม่ผ่านการอนุมัติ** ในครั้งนี้\n` +
                  `หากต้องการสอบถามเพิ่มเติมหรือลงทะเบียนใหม่ โปรดติดต่อคณะผู้บริหาร หรือลงทะเบียนใหม่อีกครั้งที่ห้อง <#${VERIFY_CHANNEL_ID || '1567570864835264542'}>`
                )
                .setFooter({ text: 'คณะกรรมการสารวัตรนักเรียน โรงเรียนพระนารายณ์' });
              await guildMember.send({ embeds: [dmRejectEmbed] }).catch(() => {});
            }
          } catch (e) {}
        }

        const rejectedEmbed = new EmbedBuilder()
          .setTitle('❌ ปฏิเสธคำขอลงทะเบียนสารวัตร')
          .setColor('#95A5A6')
          .setDescription(
            `คำขอลงทะเบียนนี้ถูกปฏิเสธโดยผู้บริหาร\n\n` +
            `👤 **ผู้ขอลงทะเบียน:** ${member.first_name} ${member.last_name} (**${member.nickname}**)\n` +
            `💬 **ผู้ใช้งาน:** <@${member.discord_id || 'ไม่ระบุ'}>\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `👮 **ผู้ปฏิเสธ:** <@${interaction.user.id}>\n` +
            `⏰ **เวลาที่ทำรายการ:** <t:${Math.floor(Date.now() / 1000)}:F>`
          )
          .setFooter({ text: 'คำขอถูกระงับ/ยกเลิก • โรงเรียนพระนารายณ์' })
          .setTimestamp();

        await interaction.editReply({
          embeds: [rejectedEmbed],
          content: null,
          components: []
        });
      }
    }

    // ----------------------------------------------------------
    // 📑 กระบวนการเช็คชื่อด้วยภาพถ่าย AI (Discord Bot Flow)
    // ----------------------------------------------------------
    if (interaction.isButton() && interaction.customId === 'btn_start_attendance_scan') {
      const shiftMenu = new StringSelectMenuBuilder()
        .setCustomId('select_attendance_scan_shift')
        .setPlaceholder('📅 1. เลือกผลัดเวรประจำวันที่ต้องการเช็คชื่อ...')
        .addOptions([
          { label: 'วันจันทร์ (Shift M)', value: 'M', description: 'เช็คชื่อสารวัตรเวรวันจันทร์', emoji: '🔵' },
          { label: 'วันอังคาร (Shift T)', value: 'T', description: 'เช็คชื่อสารวัตรเวรวันอังคาร', emoji: '🟣' },
          { label: 'วันพุธ (Shift W)', value: 'W', description: 'เช็คชื่อสารวัตรเวรวันพุธ', emoji: '🟢' },
          { label: 'วันพฤหัสบดี (Shift Ts)', value: 'Ts', description: 'เช็คชื่อสารวัตรเวรวันพฤหัสบดี', emoji: '🟠' },
          { label: 'วันศุกร์ (Shift F)', value: 'F', description: 'เช็คชื่อสารวัตรเวรวันศุกร์', emoji: '🔴' },
          { label: 'เวรพิเศษทุกวัน (Shift S)', value: 'S', description: 'เช็คชื่อสารวัตรเวรพิเศษ (ปฏิบัติหน้าที่ทุกวัน)', emoji: '⭐' }
        ]);

      const row = new ActionRowBuilder().addComponents(shiftMenu);
      await interaction.reply({
        content: '🤖 **ขั้นตอนที่ 1/2:** กรุณาเลือกผลัดเวรที่ต้องการเช็คชื่อ:',
        components: [row],
        ephemeral: true
      });
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_attendance_scan_shift') {
      const shift = interaction.values[0];
      const shiftNames = { M: 'วันจันทร์', T: 'วันอังคาร', W: 'วันพุธ', Ts: 'วันพฤหัสบดี', F: 'วันศุกร์', S: 'เวรพิเศษทุกวัน' };
      const shiftName = shiftNames[shift] || shift;

      // วันที่ปัจจุบัน (เช่น 11/14)
      const now = new Date();
      const mmdd = `${now.getMonth() + 1}/${now.getDate()}`;
      const dateOptions = [
        { label: `วันนี้ (${mmdd})`, value: `${shift}|${mmdd}`, description: `ระบุวันที่ประจำวันนี้ (${mmdd})`, emoji: '📅' }
      ];

      for (let w = 1; w <= 12; w++) {
        dateOptions.push({
          label: `สัปดาห์ที่ ${w}`,
          value: `${shift}|สัปดาห์ที่ ${w}`,
          description: `ตารางช่องสัปดาห์ที่ ${w} (12 สัปดาห์)`,
          emoji: '🗓️'
        });
      }

      const dateMenu = new StringSelectMenuBuilder()
        .setCustomId('select_attendance_scan_date')
        .setPlaceholder('🗓️ 2. เลือกวันที่ / สัปดาห์ที่ต้องการเช็คชื่อ...')
        .addOptions(dateOptions.slice(0, 13));

      const row = new ActionRowBuilder().addComponents(dateMenu);
      await interaction.update({
        content: `🤖 **ขั้นตอนที่ 2/2:** เลือกเวร **${shiftName}** แล้ว 👉 กรุณาเลือก **วันที่หรือสัปดาห์**:`,
        components: [row]
      });
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_attendance_scan_date') {
      const [shift, dateStr] = interaction.values[0].split('|');
      const shiftNames = { M: 'วันจันทร์', T: 'วันอังคาร', W: 'วันพุธ', Ts: 'วันพฤหัสบดี', F: 'วันศุกร์', S: 'เวรพิเศษทุกวัน' };
      const shiftName = shiftNames[shift] || shift;

      pendingAttendanceUploads.set(interaction.user.id, {
        shift,
        dateStr,
        channelId: interaction.channelId,
        timestamp: Date.now()
      });

      const promptEmbed = new EmbedBuilder()
        .setTitle('📸 กรุณาส่งรูปภาพตารางเช็คชื่อ (Attendance Sheet)')
        .setDescription(
          `• **ผลัดเวร:** ${shiftName} [Shift ${shift}]\n` +
          `• **ประจำวันที่:** ${dateStr}\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `👉 **สิ่งที่คุณต้องทำตอนนี้:**\n` +
          `1. ถ่ายภาพหรือเลือกรูปภาพตารางเช็คชื่อ A4 ที่ลงเวลาแล้ว\n` +
          `2. **ส่งรูปภาพเข้ามาในห้องนี้ได้เลย**\n\n` +
          `⚡ เมื่อส่งรูปภาพแล้ว ระบบจะตรวจจับขอบตาราง 4 มุม และสร้างปุ่มเปิดหน้าเว็บสำหรับตรวจสอบ/ปรับพิกัดและยืนยันข้อมูลทันที!`
        )
        .setColor('#1ABC9C')
        .setFooter({ text: 'ระบบรอรับรูปภาพภายใน 10 นาที • SARAWAT PRANARAI OS' });

      await interaction.update({
        content: null,
        embeds: [promptEmbed],
        components: []
      });
      return;
    }

    // 4. ระบบสร้างใบตารางเช็คชื่อ 12 สัปดาห์ (ระบุหัวหน้าและรองหัวหน้าบนหัวกระดาษ)
    if (interaction.isButton() && (interaction.customId === 'btn_request_attendance' || interaction.customId === 'btn_request_attendance_all')) {
      if (interaction.customId === 'btn_request_attendance_all') {
        await interaction.deferReply({ ephemeral: true });

        const { data: members, error } = await supabase
          .from('members')
          .select('*')
          .eq('status', 'ACTIVE')
          .order('duty_day', { ascending: true })
          .order('duty_id', { ascending: true });

        if (error) throw error;

        if (!members || members.length === 0) {
          await interaction.editReply({
            content: '⚠️ ไม่พบข้อมูลสมาชิกในระบบ'
          });
          return;
        }

        const htmlContent = generateCombinedAttendanceSheetHTML(members);
        const tempId = storeTempAttendanceSheet(htmlContent, 'ขอรวมทุกรอบเวร');
        const onlineUrl = `${getBaseUrl()}/sheet/${tempId}`;

        const buffer = Buffer.from(htmlContent, 'utf-8');
        const attachment = new AttachmentBuilder(buffer, { name: 'ตารางเช็คชื่อ_รวมทุกเวร_12สัปดาห์.html' });

        const embed = new EmbedBuilder()
          .setTitle('📄 ตารางเช็คชื่อ: รวมทุกรอบเวร (M, T, W, Ts, F)')
          .setDescription(
            `เวร: รวมทุกรอบเวร (5 รอบเวร วันจันทร์ - ศุกร์)\n` +
            `สมาชิกทั้งหมด: ${members.length} นาย\n` +
            `ลิงก์ออนไลน์: ${onlineUrl}\n` +
            `อายุลิงก์: 30 นาที (ลบอัตโนมัติ)\n` +
            `พิมพ์: เปิดลิงก์หรือไฟล์ HTML กด Ctrl+P`
          )
          .setColor('#1ABC9C');

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel('🌐 เปิดดู / สั่งพิมพ์ออนไลน์')
            .setStyle(ButtonStyle.Link)
            .setURL(onlineUrl),
          new ButtonBuilder()
            .setLabel('⚡ สแกนเช็คชื่อด้วย AI')
            .setStyle(ButtonStyle.Link)
            .setURL(`${getWebDashboardUrl()}/attendance-scan`)
        );

        await interaction.editReply({
          content: null,
          embeds: [embed],
          files: [attachment],
          components: [row]
        });
        return;
      }

      // If btn_request_attendance: show Select Menu with 'ALL' option
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_attendance_sheet_day')
        .setPlaceholder('📅 เลือกเวรที่ต้องการพิมพ์ใบตารางเช็คชื่อ')
        .addOptions([
          { label: '📑 ขอรวม (ทุกรอบเวร M, T, W, Ts, F)', value: 'ALL', description: 'รวมสมาชิกทุกรอบเวรในเอกสารเดียว (5 กะ วันจันทร์ - ศุกร์)', emoji: '📑' },
          { label: 'วันจันทร์ (M)', value: 'M', description: 'ใบเช็คชื่อสารวัตรเวรวันจันทร์', emoji: '🔵' },
          { label: 'วันอังคาร (T)', value: 'T', description: 'ใบเช็คชื่อสารวัตรเวรวันอังคาร', emoji: '🟣' },
          { label: 'วันพุธ (W)', value: 'W', description: 'ใบเช็คชื่อสารวัตรเวรวันพุธ', emoji: '🟢' },
          { label: 'วันพฤหัสบดี (Ts)', value: 'Ts', description: 'ใบเช็คชื่อสารวัตรเวรวันพฤหัสบดี', emoji: '🟠' },
          { label: 'วันศุกร์ (F)', value: 'F', description: 'ใบเช็คชื่อสารวัตรเวรวันศุกร์', emoji: '🔴' }
        ]);

      const row = new ActionRowBuilder().addComponents(selectMenu);
      await interaction.reply({
        content: 'เลือกเวรที่ต้องการสร้างใบตารางเช็คชื่อ A4 (12 สัปดาห์):',
        components: [row],
        ephemeral: true
      });
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_attendance_sheet_day') {
      await interaction.deferUpdate();
      const selectedDay = interaction.values[0];

      if (selectedDay === 'ALL') {
        const { data: members, error } = await supabase
          .from('members')
          .select('*')
          .eq('status', 'ACTIVE')
          .order('duty_day', { ascending: true })
          .order('duty_id', { ascending: true });

        if (error) throw error;

        if (!members || members.length === 0) {
          await interaction.followUp({
            content: '⚠️ ไม่พบข้อมูลสมาชิกในระบบ',
            ephemeral: true
          });
          return;
        }

        const htmlContent = generateCombinedAttendanceSheetHTML(members);
        const tempId = storeTempAttendanceSheet(htmlContent, 'รวมทุกรอบเวร');
        const onlineUrl = `${getBaseUrl()}/sheet/${tempId}`;

        const buffer = Buffer.from(htmlContent, 'utf-8');
        const attachment = new AttachmentBuilder(buffer, { name: 'ตารางเช็คชื่อ_รวมทุกเวร_12สัปดาห์.html' });

        const embed = new EmbedBuilder()
          .setTitle('📄 ตารางเช็คชื่อ: รวมทุกรอบเวร (M, T, W, Ts, F)')
          .setDescription(
            `เวร: รวมทุกรอบเวร (5 รอบเวร วันจันทร์ - ศุกร์)\n` +
            `สมาชิกทั้งหมด: ${members.length} นาย\n` +
            `ลิงก์ออนไลน์: ${onlineUrl}\n` +
            `อายุลิงก์: 30 นาที (ลบอัตโนมัติ)\n` +
            `พิมพ์: เปิดลิงก์หรือไฟล์ HTML กด Ctrl+P`
          )
          .setColor('#1ABC9C');

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel('🌐 เปิดดู / สั่งพิมพ์ออนไลน์')
            .setStyle(ButtonStyle.Link)
            .setURL(onlineUrl),
          new ButtonBuilder()
            .setLabel('⚡ สแกนเช็คชื่อด้วย AI')
            .setStyle(ButtonStyle.Link)
            .setURL(`${getWebDashboardUrl()}/attendance-scan`)
        );

        await interaction.editReply({
          content: null,
          embeds: [embed],
          files: [attachment],
          components: [row]
        });
        return;
      }

      // Single Day
      // Single Day: ดึงทั้งเวรปกติ และสารวัตรเวรพิเศษที่สังกัดวันนี้ (เช่น M และ MS)
      const targetDays = selectedDay === 'S'
        ? ['S', 'MS', 'TS', 'WS', 'TSS', 'FS']
        : [selectedDay, selectedDay === 'Ts' ? 'TSS' : `${selectedDay}S`];

      const { data: members, error } = await supabase
        .from('members')
        .select('*')
        .in('duty_day', targetDays)
        .eq('status', 'ACTIVE')
        .order('duty_id', { ascending: true });

      if (error) throw error;

      const dayText = getDayName(selectedDay);

      if (!members || members.length === 0) {
        await interaction.followUp({
          content: `⚠️ ไม่พบสมาชิกใน ${dayText}`,
          ephemeral: true
        });
        return;
      }

      const htmlContent = generateAttendanceSheetHTML(selectedDay, dayText, members);
      const tempId = storeTempAttendanceSheet(htmlContent, dayText);
      const onlineUrl = `${getBaseUrl()}/sheet/${tempId}`;

      const buffer = Buffer.from(htmlContent, 'utf-8');
      const attachment = new AttachmentBuilder(buffer, { name: `ตารางเช็คชื่อ_เวร_${selectedDay}.html` });

      const head = members.find(m => m.shift_role === 'SHIFT_HEAD');
      const deputy = members.find(m => m.shift_role === 'SHIFT_DEPUTY');

      const headText = head ? `[${head.duty_id}] ${head.nickname} (${head.first_name} ${head.last_name})` : 'ยังไม่ได้แต่งตั้ง';
      const deputyText = deputy ? `[${deputy.duty_id}] ${deputy.nickname} (${deputy.first_name} ${deputy.last_name})` : 'ยังไม่ได้แต่งตั้ง';

      const embed = new EmbedBuilder()
        .setTitle(`📄 ตารางเช็คชื่อ: ${dayText} (${selectedDay})`)
        .setDescription(
          `เวร: ${dayText} (${selectedDay})\n` +
          `สมาชิก: ${members.length} นาย\n` +
          `หัวหน้าเวร: ${headText}\n` +
          `รองหัวหน้าเวร: ${deputyText}\n` +
          `ลิงก์ออนไลน์: ${onlineUrl}\n` +
          `อายุลิงก์: 30 นาที (ลบอัตโนมัติ)\n` +
          `พิมพ์: เปิดลิงก์หรือไฟล์ HTML กด Ctrl+P`
        )
        .setColor('#1ABC9C');

      const linkRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('🌐 เปิดดู / สั่งพิมพ์ออนไลน์')
          .setStyle(ButtonStyle.Link)
          .setURL(onlineUrl),
        new ButtonBuilder()
          .setLabel('⚡ สแกนเช็คชื่อด้วย AI')
          .setStyle(ButtonStyle.Link)
          .setURL(`${getWebDashboardUrl()}/attendance-scan?shift=${selectedDay}`)
      );

      await interaction.editReply({
        content: null,
        embeds: [embed],
        files: [attachment],
        components: [linkRow]
      });
    }

    // 5. ขอลาเวร (ด่วน รวดเร็ว เลือกประเภทได้ทันที)
    if (interaction.isButton() && (interaction.customId === 'btn_request_leave' || interaction.customId.startsWith('btn_dm_quick_leave_'))) {
      let member = null;
      if (interaction.customId.startsWith('btn_dm_quick_leave_')) {
        const memId = interaction.customId.replace('btn_dm_quick_leave_', '');
        const { data } = await supabase.from('members').select('*').eq('id', memId).maybeSingle();
        member = data;
      } else {
        const { data } = await supabase.from('members').select('*').eq('discord_id', interaction.user.id).eq('status', 'ACTIVE').maybeSingle();
        member = data;
      }

      if (!member) {
        await interaction.reply({
          content: '⚠️ ไม่พบข้อมูลสารวัตรในระบบ กรุณายืนยันตัวตนในห้อง `#ยืนยันตัวตน` ก่อนครับ',
          ephemeral: true
        });
        return;
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`btn_pick_leave_${member.id}_sick`)
          .setLabel('🤒 ลาป่วย')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`btn_pick_leave_${member.id}_personal`)
          .setLabel('📝 ลากิจ')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`btn_pick_leave_${member.id}_exam`)
          .setLabel('📚 ติดสอบ/เรียน')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`btn_pick_leave_${member.id}_other`)
          .setLabel('🔄 ภารกิจอื่น')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.reply({
        content: `### 📝 **แบบฟอร์มขอลาเวรด่วน [${member.duty_id || 'สารวัตร'}]**\n` +
                 `คุณ **${member.nickname}** (${member.first_name})\n` +
                 `โปรดกดเลือกประเภทการลาด้านล่าง เพื่อระบุหมายเหตุ/เหตุผล:`,
        components: [row],
        ephemeral: true
      });
      return;
    }

    // เมื่อเลือกประเภทการลา -> เปิด Modal กรอกหมายเหตุสั้นๆ
    if (interaction.isButton() && interaction.customId.startsWith('btn_pick_leave_')) {
      const parts = interaction.customId.replace('btn_pick_leave_', '').split('_');
      const memberId = parts[0];
      const typeKey = parts[1] || 'personal';

      const typeMap = {
        sick: 'ลาป่วย',
        personal: 'ลากิจ',
        exam: 'ติดสอบ/ภารกิจการเรียน',
        other: 'ภารกิจอื่น/สลับเวร'
      };
      const typeName = typeMap[typeKey] || 'ลากิจ';

      const modal = new ModalBuilder()
        .setCustomId(`modal_quick_leave_${memberId}_${typeKey}`)
        .setTitle(`ขอลาเวร: ${typeName}`.slice(0, 45));

      const reasonInput = new TextInputBuilder()
        .setCustomId('input_leave_reason')
        .setLabel('หมายเหตุ / เหตุผลการลา')
        .setPlaceholder('ระบุเหตุผลความจำเป็น เช่น มีไข้สูง ไปพบแพทย์ / ติดธุระครอบครัว')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      const substituteInput = new TextInputBuilder()
        .setCustomId('input_substitute')
        .setLabel('สารวัตรที่เข้าเวรแทน (ถ้ามีระบุ)')
        .setPlaceholder('เช่น [TS2] กาย หรือระบุว่า ไม่มี')
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(reasonInput),
        new ActionRowBuilder().addComponents(substituteInput)
      );

      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit() && (interaction.customId.startsWith('modal_quick_leave_') || interaction.customId.startsWith('modal_submit_leave_') || interaction.customId.startsWith('modal_dm_quick_leave_'))) {
      await interaction.deferReply({ ephemeral: true });

      let memberId = '';
      let typeKey = 'personal';

      if (interaction.customId.startsWith('modal_quick_leave_')) {
        const parts = interaction.customId.replace('modal_quick_leave_', '').split('_');
        memberId = parts[0];
        typeKey = parts[1] || 'personal';
      } else if (interaction.customId.startsWith('modal_submit_leave_')) {
        memberId = interaction.customId.replace('modal_submit_leave_', '');
      } else if (interaction.customId.startsWith('modal_dm_quick_leave_')) {
        memberId = interaction.customId.replace('modal_dm_quick_leave_', '');
      }

      const typeMap = {
        sick: 'ลาป่วย',
        personal: 'ลากิจ',
        exam: 'ติดสอบ/ภารกิจการเรียน',
        other: 'ภารกิจอื่น'
      };

      const reason = interaction.fields.getTextInputValue('input_leave_reason').trim();
      const substitute = interaction.fields.fields.has('input_substitute') ? (interaction.fields.getTextInputValue('input_substitute').trim() || '-') : '-';
      const todayStr = `วันนี้ (${new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })})`;
      const leaveDate = interaction.fields.fields.has('input_leave_date') ? interaction.fields.getTextInputValue('input_leave_date').trim() : todayStr;
      const shiftPeriod = interaction.fields.fields.has('input_shift_period') ? interaction.fields.getTextInputValue('input_shift_period').trim() : 'ทั้งวัน';
      const leaveType = interaction.fields.fields.has('input_leave_type') ? interaction.fields.getTextInputValue('input_leave_type').trim() : (typeMap[typeKey] || 'ลากิจ');

      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).single();

      await supabase.from('leave_requests').insert({
        member_id: member.id,
        duty_day: member.duty_day,
        leave_date: leaveDate,
        shift_period: shiftPeriod,
        leave_type: leaveType,
        reason: reason,
        substitute_name: substitute,
        status: 'NOTIFIED'
      });

      // 🚀 ส่งและอัปเดตการ์ดสรุปยอดลาเวรประจำผลัดแบบ Realtime รวมเป็น Card เดียวให้หัวหน้าเวรและห้องเวร
      const targetGuild = interaction.guild || client.guilds.cache.get(process.env.GUILD_ID) || client.guilds.cache.first();
      await broadcastConsolidatedShiftLeaveCard(targetGuild, member.duty_day, {
        member_id: member.id,
        nickname: member.nickname,
        first_name: member.first_name,
        last_name: member.last_name,
        duty_id: member.duty_id,
        grade_class: member.grade_class,
        leave_type: leaveType,
        shift_period: shiftPeriod,
        reason: reason,
        substitute: substitute
      }, `👮 [${member.duty_id || 'สารวัตร'}] คุณ${member.nickname}`);

      const baseDay = member.duty_day === 'S' ? 'S' : (member.duty_day === 'TSS' ? 'Ts' : (member.duty_day.replace(/S+$/, '') || member.duty_day));
      await interaction.editReply({
        content: `# ✅ ส่งคำขอลาเวรเรียบร้อยแล้ว\n` +
                 `- **ผู้ขอลา:** [${member.duty_id || 'สารวัตร'}] คุณ${member.nickname} (${member.first_name})\n` +
                 `- **ผลัดเวร:** เวร${DAY_NAMES[baseDay] || member.duty_day} (${shiftPeriod})\n` +
                 `- **ประเภท:** ${leaveType} (เหตุผล: ${reason})\n` +
                 `━━━━━━━━━━━━━━━━━━━━\n` +
                 `📋 **การ์ดสรุปยอดเวร:** ระบบได้รวบรวมข้อมูลให้อยู่ในการ์ดเดียว และอัปเดตแบบ Realtime ไปยังห้องเวรและหัวหน้าเวรเรียบร้อยแล้ว!`
      });
      return;
    }

    // -------------------------------------------------------------
    // 5.0.1 ศูนย์บริการสารวัตร: ปุ่ม +ขออนุญาตออกตรวจ (Step-by-Step Flow)
    // -------------------------------------------------------------
    if (interaction.isButton() && (interaction.customId === 'btn_service_request_inspection' || interaction.customId === 'btn_service_request_leave')) {
      const { data: member } = await supabase
        .from('members')
        .select('*')
        .eq('discord_id', interaction.user.id)
        .eq('status', 'ACTIVE')
        .maybeSingle();

      if (!member) {
        await interaction.reply({
          content: '⚠️ **ไม่พบข้อมูลสารวัตรในระบบ** กรุณายืนยันตัวตนในห้อง `#🛡️│ยืนยันตัวตน` ก่อนทำรายการครับ',
          ephemeral: true
        });
        return;
      }

      const draft = getInspectionDraft(interaction.user.id);
      draft.target = null;
      draft.partnerIds = [];
      draft.partnersText = 'ปฏิบัติหน้าที่คนเดียว';
      draft.period = getDutyPeriodNow();
      draft.updatedAt = Date.now();

      const panel = buildStep1Panel(member, interaction.user);
      await interaction.reply(panel);
      return;
    }

    // สเตป 1: เลือกสถานที่
    if (interaction.isButton() && interaction.customId.startsWith('btn_insp_loc_')) {
      if (interaction.customId === 'btn_insp_loc_custom') {
        const modal = new ModalBuilder()
          .setCustomId('modal_service_request_inspection')
          .setTitle('📋 ระบุจุดตรวจที่ต้องการออกตรวจ'.slice(0, 45));

        const targetInput = new TextInputBuilder()
          .setCustomId('input_insp_target')
          .setLabel('สถานที่ / จุดตรวจที่ต้องการออกตรวจ')
          .setPlaceholder('เช่น หลังอาคาร 4, ลานกิจกรรม, ห้องโสต')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(targetInput));
        await interaction.showModal(modal);
        return;
      }

      const locMap = {
        btn_insp_loc_canteen: 'โรงอาหาร',
        btn_insp_loc_bldg3: 'หลังอาคาร 3',
        btn_insp_loc_coop: 'สหกรณ์',
        btn_insp_loc_toilet: 'บริเวณห้องน้ำ'
      };
      const chosenLoc = locMap[interaction.customId] || 'พื้นที่โรงเรียน';

      const draft = getInspectionDraft(interaction.user.id);
      draft.target = chosenLoc;
      draft.updatedAt = Date.now();

      const { data: member } = await supabase
        .from('members')
        .select('*')
        .eq('discord_id', interaction.user.id)
        .maybeSingle();

      const panel = buildStep2Panel(member, draft, interaction.user);
      await interaction.update({ embeds: panel.embeds, components: panel.components });
      return;
    }

    // สเตป 1 ย้อนกลับมาจากสเตป 2
    if (interaction.isButton() && interaction.customId === 'btn_insp_back_step1') {
      const { data: member } = await supabase
        .from('members')
        .select('*')
        .eq('discord_id', interaction.user.id)
        .maybeSingle();

      const panel = buildStep1Panel(member, interaction.user);
      await interaction.update({ embeds: panel.embeds, components: panel.components });
      return;
    }

    // สเตป 2 ย้อนกลับมาจากเลือกเพื่อน
    if (interaction.isButton() && interaction.customId === 'btn_insp_back_step2') {
      const { data: member } = await supabase
        .from('members')
        .select('*')
        .eq('discord_id', interaction.user.id)
        .maybeSingle();

      const draft = getInspectionDraft(interaction.user.id);
      const panel = buildStep2Panel(member, draft, interaction.user);
      await interaction.update({ embeds: panel.embeds, components: panel.components });
      return;
    }

    // สเตป 2: เลือก "ออกตรวจคนเดียว" -> สร้างห้องตรวจทันที!
    if (interaction.isButton() && interaction.customId === 'btn_insp_partner_solo') {
      await interaction.deferUpdate();

      const { data: member } = await supabase
        .from('members')
        .select('*')
        .eq('discord_id', interaction.user.id)
        .maybeSingle();

      const draft = getInspectionDraft(interaction.user.id);
      await createInspectionTicket(interaction, {
        target: draft.target || 'พื้นที่โรงเรียน',
        period: draft.period || getDutyPeriodNow(),
        officers: 'ปฏิบัติหน้าที่คนเดียว',
        partnerIds: [],
        member
      });

      inspectionDrafts.delete(interaction.user.id);
      return;
    }

    // สเตป 2: เลือก "มีเพื่อนร่วมตรวจ" -> แสดง UserSelectMenu
    if (interaction.isButton() && interaction.customId === 'btn_insp_partner_pick') {
      const { data: member } = await supabase
        .from('members')
        .select('*')
        .eq('discord_id', interaction.user.id)
        .maybeSingle();

      const draft = getInspectionDraft(interaction.user.id);
      const panel = buildStep2WithFriendPanel(member, draft, interaction.user);
      await interaction.update({ embeds: panel.embeds, components: panel.components });
      return;
    }

    // สเตป 2: เมื่อเลือกเพื่อนจาก UserSelectMenu -> สร้างห้องตรวจทันทีพร้อมดึงเพื่อนเข้าเธรด!
    if (interaction.isUserSelectMenu() && interaction.customId === 'select_insp_friends') {
      await interaction.deferUpdate();

      const { data: member } = await supabase
        .from('members')
        .select('*')
        .eq('discord_id', interaction.user.id)
        .maybeSingle();

      const draft = getInspectionDraft(interaction.user.id);
      const partnerIds = interaction.values || [];
      const officersText = partnerIds.length > 0
        ? partnerIds.map(id => `<@${id}>`).join(', ')
        : 'ปฏิบัติหน้าที่คนเดียว';

      await createInspectionTicket(interaction, {
        target: draft.target || 'พื้นที่โรงเรียน',
        period: draft.period || getDutyPeriodNow(),
        officers: officersText,
        partnerIds,
        member
      });

      inspectionDrafts.delete(interaction.user.id);
      return;
    }

    // รับข้อมูลจาก Modal พิมพ์จุดตรวจเอง -> ข้ามไปสเตป 2 (เลือกเพื่อน)
    if (interaction.isModalSubmit() && interaction.customId === 'modal_service_request_inspection') {
      const target = interaction.fields.getTextInputValue('input_insp_target').trim();
      const draft = getInspectionDraft(interaction.user.id);
      draft.target = target;
      draft.updatedAt = Date.now();

      const { data: member } = await supabase
        .from('members')
        .select('*')
        .eq('discord_id', interaction.user.id)
        .maybeSingle();

      const panel = buildStep2Panel(member, draft, interaction.user);
      await interaction.reply({ ...panel, ephemeral: true });
      return;
    }

    // -------------------------------------------------------------
    // 5.0.1.0 ปุ่มอนุมัติการออกตรวจ (เฉพาะผู้นำ/หัวหน้า)
    // -------------------------------------------------------------
    if (interaction.isButton() && interaction.customId.startsWith('btn_approve_insp_')) {
      const caseId = interaction.customId.replace('btn_approve_insp_', '');

      // ตรวจสอบสิทธิ์ผู้นำ (ประธาน / รองประธาน / หัวหน้าเวร / รองหัวหน้าเวร / Admin)
      const isLeader = interaction.member?.permissions.has(PermissionsBitField.Flags.Administrator) ||
                       interaction.guild?.ownerId === interaction.user.id ||
                       interaction.member?.roles.cache.some(r => r.name.includes('ประธาน') || r.name.includes('หัวหน้า'));

      if (!isLeader) {
        await interaction.reply({
          content: '⛔ **ขออภัย:** เฉพาะประธาน, รองประธาน, หัวหน้าเวร หรือรองหัวหน้าเวรเท่านั้นที่มีสิทธิ์กดอนุมัติเคสนี้',
          ephemeral: true
        });
        return;
      }

      await interaction.deferUpdate();

      const { data: c } = await supabase.from('cases').select('*').eq('case_id', caseId).maybeSingle();

      if (!c) {
        await interaction.followUp({ content: '⚠️ ไม่พบข้อมูลเคสในระบบ', ephemeral: true });
        return;
      }

      if (c.status === 'IN_PROGRESS' || c.status === 'RESOLVED') {
        await interaction.followUp({ content: 'ℹ️ เคสนี้ได้รับการอนุมัติไปแล้วก่อนหน้านี้', ephemeral: true });
        return;
      }

      // ดึงข้อมูลสารวัตรผู้ขอ
      let requestingMember = null;
      if (c.assigned_officer_id) {
        const { data: m } = await supabase.from('members').select('*').eq('id', c.assigned_officer_id).maybeSingle();
        requestingMember = m;
      }
      if (!requestingMember && c.reporter_discord_id) {
        const { data: m } = await supabase.from('members').select('*').eq('discord_id', c.reporter_discord_id).order('updated_at', { ascending: false }).limit(1).maybeSingle();
        requestingMember = m;
      }
      const officerDisplay = requestingMember
        ? `[${requestingMember.duty_id || 'สารวัตร'}] คุณ${requestingMember.nickname} (${requestingMember.first_name} ${requestingMember.last_name || ''})`
        : (c.reporter_name || 'สารวัตรเวร');
      // 🌟 ใช้รูปโปรไฟล์ที่สารวัตรส่งในช่องส่งรูปเป็นหลัก
      const officerPhoto = requestingMember?.profile_image_url || requestingMember?.photo_url || requestingMember?.profile_photo_url || null;

      // 🌟 ดึงข้อมูลและรูปโปรไฟล์ที่หัวหน้าผู้อนุมัติเคยส่งในช่องส่งรูป
      let approverMember = null;
      try {
        const { data: am } = await supabase.from('members').select('*').eq('discord_id', interaction.user.id).order('updated_at', { ascending: false }).limit(1).maybeSingle();
        approverMember = am;
      } catch (e) {}

      const approverName = approverMember
        ? `[${approverMember.duty_id || 'หัวหน้า'}] คุณ${approverMember.nickname} (${approverMember.first_name} ${approverMember.last_name || ''})`
        : (interaction.member?.displayName || interaction.user.username);
      const approverPhoto = approverMember?.profile_image_url || approverMember?.photo_url || approverMember?.profile_photo_url || interaction.user.displayAvatarURL({ dynamic: true, size: 512 });

      // อัปเดตสถานะใน Supabase
      await supabase.from('cases').update({
        status: 'IN_PROGRESS',
        resolution_notes: (c.resolution_notes ? c.resolution_notes + '\n' : '') + `[อนุมัติโดย ${approverName} (<@${interaction.user.id}>) เมื่อ ${new Date().toLocaleString('th-TH')}]`
      }).eq('case_id', caseId);

      // สร้าง Approved Embed
      const approvedEmbed = new EmbedBuilder()
        .setTitle('✅ [อนุมัติการออกตรวจเรียบร้อยแล้ว]')
        .setAuthor({ name: `ผู้อนุมัติ: ${approverName}`, iconURL: approverPhoto })
        .setThumbnail(approverPhoto)
        .setDescription(
          `# 🟢 อนุญาตให้สารวัตรออกตรวจพื้นที่ได้ทันที!\n\n` +
          `👮 **สารวัตรผู้ปฏิบัติหน้าที่:** ${officerDisplay}\n` +
          `👑 **ผู้อนุมัติ:** **${approverName}** (<@${interaction.user.id}>)\n` +
          `⏰ **เวลาอนุมัติ:** <t:${Math.floor(Date.now() / 1000)}:T>\n` +
          `📍 **จุดตรวจ:** **${c.location}**\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `เมื่อทำการตรวจพื้นที่เสร็จสิ้น ให้กดปุ่ม **"🏁 ทำการตรวจเสร็จสิ้น"** ด้านล่างนี้เพื่อบันทึกสรุปผลและส่งคลิป Bodycam`
        )
        .setColor('#2ECC71')
        .setFooter({ text: `SARAWAT PATROL APPROVED • ${caseId} • อนุมัติโดย ${approverName}`, iconURL: officerPhoto || approverPhoto })
        .setTimestamp();

      const finishRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`btn_finish_inspection_${caseId}`)
          .setLabel('🏁 ทำการตรวจเสร็จสิ้น')
          .setStyle(ButtonStyle.Success)
          .setEmoji('🏁')
      );

      // ค้นหาเธรดของเคสนี้
      const guild = interaction.guild;
      const targetThread = interaction.channel.isThread()
        ? interaction.channel
        : guild.channels.cache.find(ch => ch.isThread && ch.isThread() && ch.name.includes(caseId));

      if (targetThread && targetThread.isTextBased()) {
        await targetThread.send({ embeds: [approvedEmbed], components: [finishRow] });
      }

      // ลบข้อความแจ้งเตือนที่ค้างอยู่ในห้องประชุมหัวหน้าและห้องอื่นๆ ทันที
      await cleanUpPendingNotificationMessages(guild, caseId, interaction);
      return;
    }

    // -------------------------------------------------------------
    // 5.0.1.0.1 ปุ่มไม่อนุมัติการออกตรวจ -> เปิด Modal ระบุเหตุผล
    // -------------------------------------------------------------
    if (interaction.isButton() && interaction.customId.startsWith('btn_reject_insp_')) {
      const caseId = interaction.customId.replace('btn_reject_insp_', '');

      const isLeader = interaction.member?.permissions.has(PermissionsBitField.Flags.Administrator) ||
                       interaction.guild?.ownerId === interaction.user.id ||
                       interaction.member?.roles.cache.some(r => r.name.includes('ประธาน') || r.name.includes('หัวหน้า'));

      if (!isLeader) {
        await interaction.reply({
          content: '⛔ **ขออภัย:** เฉพาะประธาน, รองประธาน, หัวหน้าเวร หรือรองหัวหน้าเวรเท่านั้นที่มีสิทธิ์กดปฏิเสธเคสนี้',
          ephemeral: true
        });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId(`modal_reject_insp_${caseId}`)
        .setTitle(`ไม่อนุมัติการออกตรวจ ${caseId}`.slice(0, 45));

      const reasonInput = new TextInputBuilder()
        .setCustomId('input_reject_reason')
        .setLabel('เหตุผลที่ไม่อนุมัติ')
        .setPlaceholder('ระบุเหตุผล เช่น จุดตรวจนี้มีเวรอื่นรับผิดชอบแล้ว / ให้รอเวลาพัก')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_reject_insp_')) {
      await interaction.deferUpdate();
      const caseId = interaction.customId.replace('modal_reject_insp_', '');
      const reason = interaction.fields.getTextInputValue('input_reject_reason').trim();
      const approverName = interaction.member?.displayName || interaction.user.username;

      await supabase.from('cases').update({
        status: 'REJECTED',
        resolution_notes: `[ไม่อนุมัติโดย ${approverName}]: ${reason}`
      }).eq('case_id', caseId);

      const rejectEmbed = new EmbedBuilder()
        .setTitle(`❌ [ไม่อนุมัติการออกตรวจ]`)
        .setDescription(
          `# ⛔ คำขอออกตรวจพื้นที่ไม่ได้รับการอนุมัติ\n\n` +
          `👑 **ผู้พิจารณา:** **${approverName}** (<@${interaction.user.id}>)\n` +
          `📝 **เหตุผลที่ไม่อนุมัติ:**\n> ${reason}\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `*(เคสนี้ถูกปิดการดำเนินการแล้ว สารวัตรสามารถเปิดเคสใหม่ได้หากต้องการ)*`
        )
        .setColor('#E74C3C')
        .setFooter({ text: `PATROL REJECTED • ${caseId}` });

      const guild = interaction.guild;
      const targetThread = interaction.channel.isThread()
        ? interaction.channel
        : guild.channels.cache.find(ch => ch.isThread && ch.isThread() && ch.name.includes(caseId));

      if (targetThread && targetThread.isTextBased()) {
        await targetThread.send({ embeds: [rejectEmbed] });
        await targetThread.setLocked(true).catch(() => {});
        await targetThread.setArchived(true).catch(() => {});
      }

      // ลบข้อความแจ้งเตือนที่ค้างอยู่ในห้องประชุมหัวหน้าและห้องอื่นๆ ทันที
      await cleanUpPendingNotificationMessages(guild, caseId, interaction);
      return;
    }

    // -------------------------------------------------------------
    // 5.0.1.1 ปุ่มทำการตรวจเสร็จสิ้น -> เปิด Modal กรอกสรุปผล
    // -------------------------------------------------------------
    if (interaction.isButton() && interaction.customId.startsWith('btn_finish_inspection_')) {
      const caseId = interaction.customId.replace('btn_finish_inspection_', '');

      const modal = new ModalBuilder()
        .setCustomId(`modal_finish_insp_${caseId}`)
        .setTitle(`🏁 บันทึกสรุปผลการออกตรวจ ${caseId}`.slice(0, 45));

      const summaryInput = new TextInputBuilder()
        .setCustomId('input_insp_summary')
        .setLabel('ผลการตรวจ / สถานการณ์ที่พบ')
        .setPlaceholder('ระบุพฤติการณ์ เช่น สถานการณ์ปกติ เรียบร้อยดี หรือตรวจพบสิ่งผิดระเบียบ...')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      const notesInput = new TextInputBuilder()
        .setCustomId('input_insp_notes')
        .setLabel('หมายเหตุเพิ่มเติม (ถ้ามี)')
        .setPlaceholder('เช่น ตักเตือนแล้ว, ยึดของกลางส่งฝ่ายปกครอง, หรือระบุว่า ไม่มี')
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(summaryInput),
        new ActionRowBuilder().addComponents(notesInput)
      );

      await interaction.showModal(modal);
      return;
    }

    // -------------------------------------------------------------
    // 5.0.1.2 เมื่อส่ง Modal สรุปผล -> ขึ้น Review Card พร้อมปุ่มส่ง Bodycam และ 3 ปุ่มควบคุม
    // -------------------------------------------------------------
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_finish_insp_')) {
      await interaction.deferReply();
      const caseId = interaction.customId.replace('modal_finish_insp_', '');
      const summary = interaction.fields.getTextInputValue('input_insp_summary').trim();
      const notes = interaction.fields.fields.has('input_insp_notes')
        ? (interaction.fields.getTextInputValue('input_insp_notes').trim() || '-')
        : '-';

      const { data: c } = await supabase.from('cases').select('*').eq('case_id', caseId).maybeSingle();
      const photoCount = c?.evidence_urls?.length || 0;

      // 🌟 ดึงข้อมูลและรูปโปรไฟล์ที่ส่งในช่องส่งรูปของสารวัตรผู้รายงาน
      let officerMember = null;
      if (c?.assigned_officer_id) {
        const { data: m } = await supabase.from('members').select('*').eq('id', c.assigned_officer_id).maybeSingle();
        officerMember = m;
      }
      if (!officerMember) {
        const { data: m } = await supabase.from('members').select('*').eq('discord_id', interaction.user.id).order('updated_at', { ascending: false }).limit(1).maybeSingle();
        officerMember = m;
      }
      const officerPhoto = officerMember?.profile_image_url || officerMember?.photo_url || officerMember?.profile_photo_url || interaction.user.displayAvatarURL({ dynamic: true, size: 512 });
      const officerDisplay = officerMember
        ? `[${officerMember.duty_id || 'สารวัตร'}] คุณ${officerMember.nickname} (${officerMember.first_name} ${officerMember.last_name || ''})`
        : interaction.user.username;

      // อัปเดตบันทึกร่างผลการตรวจ
      await supabase.from('cases').update({
        resolution_notes: `[สรุปผลการตรวจ]: ${summary}\n[หมายเหตุ]: ${notes}`
      }).eq('case_id', caseId);

      const webUrl = getWebDashboardUrl();
      const bodycamUrl = `${webUrl}/bodycam-upload?caseId=${caseId}`;

      const reviewEmbed = new EmbedBuilder()
        .setTitle(`📋 สรุปผลการออกตรวจ: ${caseId}`)
        .setAuthor({ name: `สารวัตรผู้รายงาน: ${officerDisplay}`, iconURL: officerPhoto })
        .setThumbnail(officerPhoto)
        .setDescription(
          `# 🔍 รายงานผลการปฏิบัติหน้าที่\n\n` +
          `📍 **จุดตรวจ:** **${c?.location || '-'}**\n` +
          `📝 **ผลการตรวจ:**\n${summary}\n\n` +
          `📌 **หมายเหตุเพิ่มเติม:**\n${notes}\n\n` +
          `📸 **รูปภาพหลักฐานทั้งหมดในเคส:** ${photoCount} ภาพ\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `📹 **การส่งคลิป Bodycam ผ่าน Google Drive:**\n` +
          `สารวัตรสามารถกดปุ่มสีฟ้าด้านล่างนี้ เพื่อส่งคลิปวิดีโอจากกล้อง Bodycam เข้าสู่คลัง Google Drive ของโรงเรียนได้ทันที!\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `กรุณาตรวจสอบความถูกต้องด้านล่างนี้:\n` +
          `• หากต้องการแนบรูปเพิ่ม กด **"📸 เพิ่มรูปหลักฐาน"**\n` +
          `• หากต้องการแก้ไขข้อความ กด **"✏️ แก้ไขข้อมูล"**\n` +
          `• หากข้อมูลถูกต้องครบถ้วนแล้ว กด **"✅ ยืนยันปิดเคส"**`
        )
        .setColor('#3498DB')
        .setFooter({ text: `PATROL REVIEW • ${caseId}` });

      const reviewRow1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('📹 ส่งคลิป Bodycam (ผ่าน Google Drive)')
          .setStyle(ButtonStyle.Link)
          .setURL(bodycamUrl)
      );

      const reviewRow2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`btn_confirm_close_insp_${caseId}`)
          .setLabel('✅ ยืนยันปิดเคส')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`btn_add_evidence_insp_${caseId}`)
          .setLabel('📸 เพิ่มรูปหลักฐาน')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`btn_edit_summary_insp_${caseId}`)
          .setLabel('✏️ แก้ไขข้อมูล')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({ embeds: [reviewEmbed], components: [reviewRow1, reviewRow2] });
      return;
    }

    // -------------------------------------------------------------
    // 5.0.1.3 การจัดการ 3 ปุ่ม: เพิ่มรูป / แก้ไข / ยืนยันปิดเคส
    // -------------------------------------------------------------
    if (interaction.isButton() && interaction.customId.startsWith('btn_add_evidence_insp_')) {
      const caseId = interaction.customId.replace('btn_add_evidence_insp_', '');
      await interaction.reply({
        content: `📸 **สารวัตรสามารถส่งไฟล์ภาพถ่ายหรือคลิปวิดีโอลงในเธรดนี้ได้เลยครับ!**\nระบบจะตรวจจับไฟล์แนบและบันทึกเข้าเคส \`${caseId}\` ให้อัตโนมัติทันที`,
        ephemeral: true
      });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('btn_edit_summary_insp_')) {
      const caseId = interaction.customId.replace('btn_edit_summary_insp_', '');

      const modal = new ModalBuilder()
        .setCustomId(`modal_finish_insp_${caseId}`)
        .setTitle(`✏️ แก้ไขข้อมูลสรุปผล ${caseId}`.slice(0, 45));

      const summaryInput = new TextInputBuilder()
        .setCustomId('input_insp_summary')
        .setLabel('ผลการตรวจ / สถานการณ์ที่พบ')
        .setPlaceholder('ระบุพฤติการณ์ เช่น สถานการณ์ปกติ เรียบร้อยดี หรือตรวจพบสิ่งผิดระเบียบ...')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      const notesInput = new TextInputBuilder()
        .setCustomId('input_insp_notes')
        .setLabel('หมายเหตุเพิ่มเติม (ถ้ามี)')
        .setPlaceholder('เช่น ตักเตือนแล้ว, ยึดของกลางส่งฝ่ายปกครอง, หรือระบุว่า ไม่มี')
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(summaryInput),
        new ActionRowBuilder().addComponents(notesInput)
      );

      await interaction.showModal(modal);
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('btn_confirm_close_insp_')) {
      await interaction.deferUpdate();
      const caseId = interaction.customId.replace('btn_confirm_close_insp_', '');

      const { data: c } = await supabase.from('cases').select('*').eq('case_id', caseId).maybeSingle();

      await supabase.from('cases').update({
        status: 'RESOLVED',
        resolution_notes: (c?.resolution_notes || '') + `\n[ปิดเคสโดย <@${interaction.user.id}> เมื่อ ${new Date().toLocaleString('th-TH')}]`
      }).eq('case_id', caseId);

      // แก้ไขข้อความในห้องแม่ (Parent Channel)
      if (interaction.channel.isThread && interaction.channel.isThread() && interaction.channel.parent) {
        try {
          const starterMsg = await interaction.channel.fetchStarterMessage().catch(() => null);
          if (starterMsg && starterMsg.embeds.length > 0) {
            const oldEmbed = starterMsg.embeds[0];
            const updatedEmbed = EmbedBuilder.from(oldEmbed)
              .setColor('#2ECC71')
              .setDescription(
                (oldEmbed.description || '').replace(
                  /📊 \*\*สถานะ:\*\* .*/g,
                  `📊 **สถานะ:** ✅ ภารกิจเสร็จสิ้นเรียบร้อยแล้ว`
                ) + `\n\n🏁 **ผลการตรวจ:** ${c?.resolution_notes || 'เสร็จสมบูรณ์'}`
              );
            await starterMsg.edit({ embeds: [updatedEmbed] }).catch(() => {});
          }
        } catch (e) {}
      }

      // ส่งข้อความปิดเคสในเธรด
      await interaction.message.edit({
        content:
          `# 🏁 ปฏิบัติการออกตรวจเคส [${caseId}] เสร็จสิ้นสมบูรณ์!\n` +
          `✅ บันทึกรายงานผลและภาพถ่ายหลักฐานเข้าสู่ฐานข้อมูลเรียบร้อยแล้ว\n` +
          `ขอบคุณสารวัตรทุกนายสำหรับการปฏิบัติหน้าที่อย่างเข้มแข็ง\n` +
          `*(ระบบจะทำการล็อกและจัดเก็บเธรดนี้โดยอัตโนมัติ)*`,
        embeds: [],
        components: []
      }).catch(() => {});

      if (interaction.channel.isThread && interaction.channel.isThread()) {
        await interaction.channel.setLocked(true).catch(() => {});
        await interaction.channel.setArchived(true).catch(() => {});
      }
      await cleanUpPendingNotificationMessages(interaction.guild, caseId, interaction);
      return;
    }

    // -------------------------------------------------------------
    // 5.0.2 ศูนย์บริการสารวัตร: ปุ่ม +ส่งหลักฐานคดี
    // -------------------------------------------------------------
    if (interaction.isButton() && interaction.customId === 'btn_service_submit_evidence') {
      const modal = new ModalBuilder()
        .setCustomId('modal_service_evidence')
        .setTitle('ส่งหลักฐานคดี / บันทึกเหตุการณ์'.slice(0, 45));

      const caseIdInput = new TextInputBuilder()
        .setCustomId('input_case_id')
        .setLabel('รหัสคดี (ระบุ เช่น CASE-1234 หรือเว้นว่าง)')
        .setPlaceholder('ปล่อยว่างไว้หากต้องการให้ระบบสร้างรหัสคดีให้อัตโนมัติ')
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

      const titleInput = new TextInputBuilder()
        .setCustomId('input_case_title')
        .setLabel('หัวข้อเหตุการณ์ / ประเภทคดี')
        .setPlaceholder('เช่น สูบบุหรี่, หนีเรียน, พกสิ่งผิดระเบียบ, ก่อเหตุวิวาท')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const locationInput = new TextInputBuilder()
        .setCustomId('input_case_location')
        .setLabel('สถานที่เกิดเหตุ')
        .setPlaceholder('เช่น หลังอาคาร 3, บริเวณห้องน้ำ, สหกรณ์, โรงอาหาร')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const detailsInput = new TextInputBuilder()
        .setCustomId('input_case_details')
        .setLabel('รายละเอียดพฤติการณ์ / ข้อมูลหลักฐาน')
        .setPlaceholder('บันทึกรายละเอียดเหตุการณ์ จำนวนผู้กระทำผิด หรือสิ่งที่ตรวจพบ...')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(caseIdInput),
        new ActionRowBuilder().addComponents(titleInput),
        new ActionRowBuilder().addComponents(locationInput),
        new ActionRowBuilder().addComponents(detailsInput)
      );

      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_service_evidence') {
      await interaction.deferReply({ ephemeral: true });

      let rawCaseId = interaction.fields.getTextInputValue('input_case_id')?.trim().toUpperCase();
      if (!rawCaseId || !rawCaseId.startsWith('CASE-')) {
        rawCaseId = 'CASE-' + Math.floor(1000 + Math.random() * 9000);
      }
      const caseId = rawCaseId;
      const title = interaction.fields.getTextInputValue('input_case_title').trim();
      const location = interaction.fields.getTextInputValue('input_case_location').trim();
      const details = interaction.fields.getTextInputValue('input_case_details').trim();

      const { data: member } = await supabase
        .from('members')
        .select('*')
        .eq('discord_id', interaction.user.id)
        .maybeSingle();

      const officerName = member
        ? `[${member.duty_id || 'สารวัตร'}] ${member.first_name} (${member.nickname})`
        : (interaction.member?.displayName || interaction.user.username);

      const { data: existingCase } = await supabase.from('cases').select('*').eq('case_id', caseId).maybeSingle();
      if (existingCase) {
        const updatedDesc = existingCase.description + `\n\n[บันทึกเพิ่มเติมโดย ${officerName}]:\n${details}`;
        await supabase.from('cases').update({
          description: updatedDesc,
          resolution_notes: (existingCase.resolution_notes ? existingCase.resolution_notes + '\n' : '') + `[อัปเดตหลักฐานโดย ${officerName}]`
        }).eq('case_id', caseId);
      } else {
        await supabase.from('cases').insert({
          case_id: caseId,
          reporter_email: member?.email || `${interaction.user.id}@discord.local`,
          reporter_name: officerName,
          incident_date_time: new Date().toISOString(),
          location: location,
          category: title,
          description: `[บันทึกหลักฐานคดีโดยสารวัตร]\nผู้รายงาน: ${officerName} (<@${interaction.user.id}>)\nหัวข้อ: ${title}\nสถานที่: ${location}\nรายละเอียด: ${details}`,
          status: 'PENDING',
          assigned_duty_day: member?.duty_day || null,
          assigned_officer_id: member?.id || null
        });
      }

      const guild = interaction.guild;
      const chIncident = findChannel(guild, '📁│ติดตามและปิดคดี') ||
                         findChannel(guild, '🚨│แจ้งเหตุใหม่-google-form') ||
                         findChannel(guild, 'แจ้งเหตุใหม่') ||
                         findChannel(guild, '👑│ผู้นำ-all-in-one') ||
                         interaction.channel;

      const incidentEmbed = new EmbedBuilder()
        .setTitle(`🚨 [บันทึกหลักฐานคดี] รหัส: ${caseId}`)
        .setDescription(
          `**หัวข้อเหตุการณ์:** ${title}\n` +
          `**สถานที่เกิดเหตุ:** ${location}\n` +
          `**ผู้บันทึก/สารวัตร:** ${officerName} (<@${interaction.user.id}>)\n` +
          `**วันเวลา:** <t:${Math.floor(Date.now() / 1000)}:F>\n\n` +
          `**รายละเอียดพฤติการณ์:**\n${details}\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `📸 **การส่งไฟล์หลักฐาน (รูปภาพ/คลิป):**\n` +
          `สารวัตรสามารถส่งไฟล์ภาพหรือคลิป Bodycam ลงในเธรดด้านล่างนี้ได้โดยตรง ระบบจะบันทึกเข้าคดีอัตโนมัติ!`
        )
        .setColor('#E74C3C')
        .setFooter({ text: `SARAWAT CASE MANAGEMENT • ${caseId}` });

      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`btn_close_case_${caseId}`)
          .setLabel('📁 ปิดคดี')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setLabel('🌐 อัปโหลดผ่านเว็บ (Bodycam)')
          .setStyle(ButtonStyle.Link)
          .setURL(`${getWebDashboardUrl()}/bodycam-upload?caseId=${caseId}`)
      );

      if (chIncident && chIncident.isTextBased()) {
        const msg = await chIncident.send({ embeds: [incidentEmbed], components: [actionRow] }).catch(() => null);
        if (msg) {
          const thread = await msg.startThread({
            name: `หลักฐาน [${caseId}] ${title.slice(0, 20)}`,
            autoArchiveDuration: 1440
          }).catch(() => null);

          if (thread) {
            await thread.send({
              content: `👮 **<@${interaction.user.id}> กรุณาส่งรูปภาพหลักฐาน, วิดีโอคลิป หรือเอกสารลงในเธรดนี้ได้เลยครับ**\n*(ระบบจะตรวจจับไฟล์และบันทึกเข้าคดี \`${caseId}\` ให้อัตโนมัติ)*`
            }).catch(() => {});
          }
        }
      }

      await interaction.editReply({
        content: `# 📁 บันทึกข้อมูลคดี [${caseId}] เรียบร้อยแล้ว!\n` +
                 `- **หัวข้อเหตุการณ์:** ${title}\n` +
                 `- **สถานที่:** ${location}\n` +
                 `- **ผู้บันทึก:** ${officerName}\n` +
                 `━━━━━━━━━━━━━━━━━━━━\n` +
                 `📸 **ขั้นตอนส่งไฟล์ภาพ/คลิปหลักฐาน:**\n` +
                 `• ส่งไฟล์ลงในเธรดห้องคดี <#${chIncident?.id || interaction.channelId}> ได้ทันที (บอทจะแนบเข้าคดีอัตโนมัติ)\n` +
                 `• หรืออัปโหลดไฟล์ขนาดใหญ่ผ่านหน้าเว็บ: [ระบบอัปโหลดบอดี้แคม](${getWebDashboardUrl()}/bodycam-upload?caseId=${caseId})`
      });
      return;
    }

    // ==========================================================
    // ✏️ ศูนย์บริการสารวัตร: ปุ่มแก้ไขข้อมูลตัวเอง (Self-Service Profile Edit)
    // ==========================================================
    if (interaction.isButton() && interaction.customId === 'btn_service_edit_profile') {
      const { data: member } = await supabase
        .from('members')
        .select('*')
        .eq('discord_id', interaction.user.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!member) {
        await interaction.reply({
          content: '⚠️ **ไม่พบข้อมูลสารวัตรในระบบ:** บัญชี Discord ของคุณยังไม่ได้ลงทะเบียนสารวัตร กรุณาไปที่ห้องลงทะเบียนก่อนครับ',
          ephemeral: true
        });
        return;
      }

      const shiftLabel = getShiftLabel(member.duty_day);
      const isSpecial = member.duty_day && member.duty_day.endsWith('S');
      const weekday = member.duty_day ? (member.duty_day === 'TSS' ? 'Ts' : member.duty_day.replace(/S+$/, '') || member.duty_day) : 'M';
      const weekdayName = DAY_NAMES[weekday] || weekday;

      const profileEmbed = new EmbedBuilder()
        .setTitle('✏️ ศูนย์แก้ไขข้อมูลสารวัตรนักเรียน')
        .setDescription(
          `สวัสดีครับคุณ **${member.first_name} ${member.last_name} (${member.nickname})**\n` +
          `กรุณาเลือกประเภทข้อมูลที่ต้องการแก้ไขด้านล่างนี้:\n\n` +
          `• 📸 **เปลี่ยนรูปถ่ายหน้าตรง:** ตัดรูปขนาด 1 นิ้ว (3:4) บนเว็บ **อัปเดตบัตรทันทีโดยไม่ต้องรออนุมัติ**\n` +
          `• 📝 **แก้ไขข้อมูลตัวอักษร:** แก้ไขชื่อ-สกุล, ชื่อเล่น, ชั้น/เลขที่, หรือเบอร์โทร **(ต้องส่งคำขอให้ผู้บริหารอนุมัติ)**`
        )
        .addFields(
          { name: '👤 ชื่อ-นามสกุล', value: `\`${member.first_name} ${member.last_name}\``, inline: true },
          { name: '🏷️ ชื่อเล่น', value: `\`${member.nickname || '-'}\``, inline: true },
          { name: '🏫 ชั้น / เลขที่', value: `ม.\`${member.grade_class || '-'}\` เลขที่ \`#${member.student_no || '-'}\``, inline: true },
          { name: '📞 เบอร์โทรศัพท์', value: `\`${member.phone_number || '-'}\``, inline: true },
          { name: '📅 วันปฏิบัติหน้าที่', value: `วัน${weekdayName} (\`${weekday}\`)`, inline: true },
          { name: '🏷️ ผลัดเวรสุทธิ', value: `**${shiftLabel}** ${isSpecial ? '⭐' : ''}`, inline: true }
        )
        .setColor('#3498DB')
        .setFooter({ text: 'ศูนย์บริการสารวัตร • โรงเรียนพระนารายณ์ (ข้อความนี้เห็นเฉพาะคุณ)' });

      if (member.profile_image_url) {
        profileEmbed.setThumbnail(member.profile_image_url);
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`btn_edit_choice_photo_${member.id}`)
          .setLabel('📸 เปลี่ยนรูปถ่าย (อัปเดตทันที)')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`btn_edit_choice_text_${member.id}`)
          .setLabel('📝 แก้ไขข้อมูลตัวอักษร (ส่งผู้บริหารอนุมัติ)')
          .setStyle(ButtonStyle.Primary)
      );

      await interaction.reply({
        embeds: [profileEmbed],
        components: [row],
        ephemeral: true
      });
      return;
    }

    // 📸 เส้นทางที่ 1: เปลี่ยนเฉพาะรูปถ่ายหน้าตรง (อัปเดตบัตรทันที)
    if (interaction.isButton() && interaction.customId.startsWith('btn_edit_choice_photo_')) {
      const memberId = interaction.customId.replace('btn_edit_choice_photo_', '');
      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).maybeSingle();
      if (!member || member.discord_id !== interaction.user.id) {
        await interaction.reply({ content: '⛔ เมนูนี้เฉพาะเจ้าของข้อมูลเท่านั้นครับ', ephemeral: true });
        return;
      }

      // เปิด Session รับรูปถ่ายในห้องศูนย์บริการสารวัตรเป็นเวลา 5 นาที
      activeServicePhotoSessions.set(interaction.user.id, {
        member,
        timestamp: Date.now()
      });

      // สร้าง token สำหรับเปิดหน้าเว็บครอปรูป 1 นิ้ว (3:4)
      const cropToken = crypto.randomBytes(32).toString('hex');
      try {
        await supabase.from('crop_tokens').insert({
          token: cropToken,
          member_id: member.id,
          discord_id: interaction.user.id,
          source_image_url: member.profile_image_url || 'https://placehold.co/600x800/png?text=Profile',
          expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString()
        });
      } catch (e) {}

      const cropUrl = `${getWebDashboardUrl()}/crop?token=${cropToken}`;

      const photoEmbed = new EmbedBuilder()
        .setTitle('📸 ปรับเปลี่ยนรูปถ่ายหน้าตรง 1 นิ้ว (เปิดรับรูปในช่องนี้แล้ว)')
        .setDescription(
          `สวัสดีครับคุณ **${member.first_name} ${member.last_name} (${member.nickname})**\n` +
          `บอทได้เปิดรับรูปถ่ายของคุณในห้องนี้เรียบร้อยแล้ว (Session มีอายุ 5 นาที)\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `👉 **ขั้นตอนดำเนินการ:**\n` +
          `1. **แนบส่งรูปถ่ายหน้าตรงใหม่** ของคุณเข้ามาในช่องนี้ได้ทันที\n` +
          `2. เมื่อส่งแล้ว บอทจะส่งการ์ดพร้อมปุ่ม **[🔲 ปรับแต่ง/ครอบรูป (ขนาด 1 นิ้ว)]** ให้จัดสัดส่วนใบหน้า 3:4 บนเว็บ\n` +
          `3. เมื่อตัดแต่งและกดยืนยันบนเว็บ บัตรประจำตัว 3D ของคุณจะอัปเดตทันที!\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `💡 *หรือกดปุ่ม "🔲 เปิดเว็บครอปรูปขนาด 1 นิ้ว" ด้านล่างเพื่อจัดตำแหน่งรูปเดิมได้ทันที*`
        )
        .setColor('#2ECC71')
        .setFooter({ text: 'ศูนย์บริการสารวัตร • โรงเรียนพระนารายณ์ (ข้อความนี้เห็นเฉพาะคุณ)' });

      if (member.profile_image_url) {
        photoEmbed.setThumbnail(member.profile_image_url);
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('🔲 เปิดเว็บครอปรูปขนาด 1 นิ้ว')
          .setStyle(ButtonStyle.Link)
          .setURL(cropUrl),
        new ButtonBuilder()
          .setLabel('🪪 เปิดดูบัตรประจำตัว 3D')
          .setStyle(ButtonStyle.Link)
          .setURL(`${getBaseUrl()}/card?id=${member.id}`)
      );

      await interaction.reply({
        embeds: [photoEmbed],
        components: [row],
        ephemeral: true
      });
      return;
    }

    // 📝 เส้นทางที่ 2: เปิด Modal ฟอร์มแก้ไขข้อมูลตัวอักษร
    if (interaction.isButton() && interaction.customId.startsWith('btn_edit_choice_text_')) {
      const memberId = interaction.customId.replace('btn_edit_choice_text_', '');
      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).maybeSingle();
      if (!member || member.discord_id !== interaction.user.id) {
        await interaction.reply({ content: '⛔ เมนูนี้เฉพาะเจ้าของข้อมูลเท่านั้นครับ', ephemeral: true });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId(`modal_edit_profile_${member.id}`)
        .setTitle('📝 แบบฟอร์มขอแก้ไขข้อมูลส่วนตัว');

      const inputFullName = new TextInputBuilder()
        .setCustomId('input_edit_full_name')
        .setLabel('ชื่อ-นามสกุลจริง (ระบุคำนำหน้าด้วย)')
        .setStyle(TextInputStyle.Short)
        .setValue(`${member.first_name || ''} ${member.last_name || ''}`.trim())
        .setRequired(true)
        .setMaxLength(60);

      const inputNickname = new TextInputBuilder()
        .setCustomId('input_edit_nickname')
        .setLabel('ชื่อเล่น')
        .setStyle(TextInputStyle.Short)
        .setValue(member.nickname || '')
        .setRequired(true)
        .setMaxLength(30);

      const inputGradeClass = new TextInputBuilder()
        .setCustomId('input_edit_grade_class')
        .setLabel('ชั้นเรียน / ห้อง (เช่น 5/6)')
        .setStyle(TextInputStyle.Short)
        .setValue(member.grade_class || '')
        .setRequired(true)
        .setMaxLength(15);

      const inputStudentNo = new TextInputBuilder()
        .setCustomId('input_edit_student_no')
        .setLabel('เลขที่ (ตัวเลขเท่านั้น เช่น 23)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(member.student_no || ''))
        .setRequired(true)
        .setMaxLength(5);

      const inputPhone = new TextInputBuilder()
        .setCustomId('input_edit_phone')
        .setLabel('เบอร์โทรศัพท์ติดต่อ')
        .setStyle(TextInputStyle.Short)
        .setValue(member.phone_number || '')
        .setRequired(false)
        .setMaxLength(20);

      modal.addComponents(
        new ActionRowBuilder().addComponents(inputFullName),
        new ActionRowBuilder().addComponents(inputNickname),
        new ActionRowBuilder().addComponents(inputGradeClass),
        new ActionRowBuilder().addComponents(inputStudentNo),
        new ActionRowBuilder().addComponents(inputPhone)
      );

      await interaction.showModal(modal);
      return;
    }

    // 📝 จัดการการส่งฟอร์มขอแก้ไขข้อมูลส่วนตัวสารวัตร
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_edit_profile_')) {
      const memberId = interaction.customId.replace('modal_edit_profile_', '');
      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).maybeSingle();
      if (!member || member.discord_id !== interaction.user.id) {
        await interaction.reply({ content: '⛔ คุณไม่มีสิทธิ์ส่งคำขอนี้', ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const rawFullName = interaction.fields.getTextInputValue('input_edit_full_name')?.trim();
      const rawNickname = interaction.fields.getTextInputValue('input_edit_nickname')?.trim();
      const rawGradeClass = interaction.fields.getTextInputValue('input_edit_grade_class')?.trim();
      const rawStudentNo = interaction.fields.getTextInputValue('input_edit_student_no')?.trim();
      const rawPhone = interaction.fields.getTextInputValue('input_edit_phone')?.trim();

      const cleaned = cleanFullName(rawFullName);
      const parts = cleaned.split(' ');
      const firstName = parts[0] || member.first_name;
      const lastName = parts.slice(1).join(' ') || member.last_name;
      const gradeClass = cleanGradeClass(rawGradeClass);
      const studentNo = parseInt(rawStudentNo.replace(/[^0-9]/g, ''), 10) || member.student_no;
      const nickname = rawNickname || member.nickname;
      const phone = rawPhone || member.phone_number || '-';

      const oldData = {
        first_name: member.first_name,
        last_name: member.last_name,
        nickname: member.nickname,
        grade_class: member.grade_class,
        student_no: member.student_no,
        phone_number: member.phone_number
      };

      const newData = {
        first_name: firstName || member.first_name,
        last_name: lastName || member.last_name,
        nickname: nickname,
        grade_class: gradeClass,
        student_no: studentNo,
        phone_number: phone
      };

      // บันทึกคำขอลงตาราง profile_edit_requests (ถ้ามีตาราง)
      let requestId = crypto.randomBytes(8).toString('hex');
      try {
        const { data: reqRecord } = await supabase
          .from('profile_edit_requests')
          .insert({
            member_id: member.id,
            discord_id: interaction.user.id,
            old_data: oldData,
            new_data: newData,
            status: 'PENDING'
          })
          .select()
          .single();
        if (reqRecord?.id) requestId = reqRecord.id;
      } catch (dbErr) {
        console.warn('[EDIT REQUEST DB NOTICE]:', dbErr.message);
      }

      // แจ้งเตือนสารวัตรผู้ส่ง
      const confirmEmbed = new EmbedBuilder()
        .setTitle('⏳ ยื่นคำขอแก้ไขข้อมูลส่วนตัวเรียบร้อยแล้ว')
        .setDescription(
          `คำขอของคุณถูกส่งไปยังห้องพิจารณาของคณะผู้บริหารแล้ว เพื่อความถูกต้องของทะเบียนประวัติ\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `👤 **ชื่อ-สกุลใหม่:** ${newData.first_name} ${newData.last_name} (${newData.nickname})\n` +
          `🏫 **ชั้นเรียน/เลขที่ใหม่:** ม.${newData.grade_class} #${newData.student_no}\n` +
          `📞 **เบอร์โทรศัพท์ใหม่:** \`${newData.phone_number}\`\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `💡 *เมื่อผู้บริหารกดอนุมัติ ระบบจะอัปเดตข้อมูลและส่งข้อความแจ้งเตือนทาง DM ทันที*`
        )
        .setColor('#F39C12')
        .setFooter({ text: 'ระบบบริการสารวัตร • โรงเรียนพระนารายณ์' });

      await interaction.editReply({ embeds: [confirmEmbed] });

      // ส่งการ์ดพิจารณาเข้าห้องผู้บริหาร
      let approvalChannel = null;
      const targetApprovalId = APPROVAL_CHANNEL_ID || '1567570916932722778';
      approvalChannel = await client.channels.fetch(targetApprovalId).catch(() => null);
      if (!approvalChannel && interaction.guild) {
        approvalChannel = interaction.guild.channels.cache.find(c =>
          c.isTextBased() && (c.name.includes('อนุมัติ') || c.name.includes('ห้องประชุมหัวหน้า') || c.name.includes('ผู้นำ-all-in-one'))
        ) || null;
      }

      if (approvalChannel) {
        const reviewEmbed = new EmbedBuilder()
          .setTitle('📋 คำขอแก้ไขข้อมูลส่วนตัวสารวัตร [รอการพิจารณา]')
          .setDescription(
            `มีสารวัตรนักเรียนยื่นขอแก้ไขข้อมูลตัวอักษร โปรดตรวจสอบความถูกต้องและดำเนินการ\n\n` +
            `👤 **ผู้ยื่นคำขอ:** <@${interaction.user.id}> (\`${interaction.user.tag}\`)\n` +
            `🏷️ **รหัสเวร:** \`[${member.duty_id || 'สารวัตร'}]\` • ผลัด: **${getShiftLabel(member.duty_day)}**\n\n` +
            `━━━━━━━━ ข้อมูลเปรียบเทียบ ━━━━━━━━\n` +
            `**ชื่อ-นามสกุล:**\n• เดิม: \`${oldData.first_name} ${oldData.last_name}\`\n👉 **ใหม่:** \`${newData.first_name} ${newData.last_name}\`\n\n` +
            `**ชื่อเล่น:**\n• เดิม: \`${oldData.nickname}\` 👉 **ใหม่:** \`${newData.nickname}\`\n\n` +
            `**ชั้นเรียน / เลขที่:**\n• เดิม: ม.\`${oldData.grade_class}\` #${oldData.student_no}\n👉 **ใหม่:** ม.\`${newData.grade_class}\` #${newData.student_no}\n\n` +
            `**เบอร์โทรศัพท์:**\n• เดิม: \`${oldData.phone_number || '-'}\` 👉 **ใหม่:** \`${newData.phone_number}\`\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
          )
          .setColor('#F39C12')
          .setFooter({ text: `คำขอรหัส: ${requestId} • ระบบบริหารงานสารวัตร` })
          .setTimestamp();

        if (member.profile_image_url) {
          reviewEmbed.setThumbnail(member.profile_image_url);
        }

        const actionRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`btn_approve_edit_${requestId}_${member.id}`)
            .setLabel('✅ อนุมัติการแก้ไข')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`btn_reject_edit_${requestId}_${member.id}`)
            .setLabel('❌ ปฏิเสธคำขอ')
            .setStyle(ButtonStyle.Danger)
        );

        await approvalChannel.send({ embeds: [reviewEmbed], components: [actionRow] }).catch(err => {
          logError('Send Edit Profile Approval Error', err);
        });
      }
      return;
    }

    // 👑 ผู้บริหารกดอนุมัติหรือปฏิเสธคำขอแก้ไขข้อมูลตัวอักษร
    if (interaction.isButton() && (interaction.customId.startsWith('btn_approve_edit_') || interaction.customId.startsWith('btn_reject_edit_'))) {
      const isLeader = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
                       (ROLE_IDS.ADMIN && interaction.member.roles.cache.has(ROLE_IDS.ADMIN)) ||
                       interaction.member.roles.cache.has(ROLE_IDS.PRESIDENT) ||
                       interaction.member.roles.cache.has(ROLE_IDS.VICE_PRESIDENT);

      if (!isLeader) {
        await interaction.reply({
          content: '⛔ คุณไม่มีสิทธิ์ในการอนุมัติคำขอนี้ (สงวนสิทธิ์เฉพาะคณะผู้บริหารและหัวหน้างาน)',
          ephemeral: true
        });
        return;
      }

      await interaction.deferUpdate();
      const isApprove = interaction.customId.startsWith('btn_approve_edit_');
      const parts = interaction.customId.replace(isApprove ? 'btn_approve_edit_' : 'btn_reject_edit_', '').split('_');
      const requestId = parts[0];
      const memberId = parts[1];

      // ดึงข้อมูลคำขอจาก profile_edit_requests (ถ้ามี) หรืออัปเดตจาก embed
      let newFirstName = null;
      let newLastName = null;
      let newNickname = null;
      let newGradeClass = null;
      let newStudentNo = null;
      let newPhone = null;
      let targetDiscordId = null;

      try {
        const { data: reqRecord } = await supabase
          .from('profile_edit_requests')
          .select('*')
          .eq('id', requestId)
          .maybeSingle();

        if (reqRecord) {
          targetDiscordId = reqRecord.discord_id;
          newFirstName = reqRecord.new_data?.first_name;
          newLastName = reqRecord.new_data?.last_name;
          newNickname = reqRecord.new_data?.nickname;
          newGradeClass = reqRecord.new_data?.grade_class;
          newStudentNo = reqRecord.new_data?.student_no;
          newPhone = reqRecord.new_data?.phone_number;

          await supabase.from('profile_edit_requests').update({
            status: isApprove ? 'APPROVED' : 'REJECTED',
            approved_by: interaction.user.id,
            updated_at: new Date()
          }).eq('id', requestId);
        }
      } catch (e) {}

      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).maybeSingle();
      if (!targetDiscordId && member) targetDiscordId = member.discord_id;

      const targetUser = targetDiscordId ? await client.users.fetch(targetDiscordId).catch(() => null) : null;

      if (isApprove) {
        if (member && newFirstName) {
          await supabase.from('members').update({
            first_name: newFirstName,
            last_name: newLastName,
            nickname: newNickname,
            grade_class: newGradeClass,
            student_no: newStudentNo,
            phone_number: newPhone,
            updated_at: new Date()
          }).eq('id', member.id);
        }

        if (targetUser) {
          const dmEmbed = new EmbedBuilder()
            .setTitle('🎉 คำขอแก้ไขข้อมูลส่วนตัวได้รับการอนุมัติแล้ว!')
            .setDescription(
              `คณะผู้บริหารได้ตรวจสอบและอนุมัติการแก้ไขข้อมูลส่วนตัวของคุณเรียบร้อยแล้ว\n\n` +
              `👤 **ชื่อ-นามสกุล:** ${newFirstName || member?.first_name} ${newLastName || member?.last_name} (${newNickname || member?.nickname})\n` +
              `🏫 **ชั้นเรียน/เลขที่:** ม.${newGradeClass || member?.grade_class} #${newStudentNo || member?.student_no}\n` +
              `📞 **เบอร์โทร:** \`${newPhone || member?.phone_number}\`\n\n` +
              `✅ บัตรดิจิทัล 3D และทำเนียบสารวัตรได้รับการอัปเดตข้อมูลใหม่แล้ว`
            )
            .setColor('#2ECC71')
            .setFooter({ text: 'ฝ่ายบริหารงานสารวัตร • โรงเรียนพระนารายณ์' });

          const cardRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setLabel('🪪 เปิดดูบัตรประจำตัว 3D')
              .setStyle(ButtonStyle.Link)
              .setURL(`${getBaseUrl()}/card?id=${memberId}`)
          );

          await targetUser.send({ embeds: [dmEmbed], components: [cardRow] }).catch(() => {});
        }

        const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
          .setColor('#2ECC71')
          .setTitle('✅ [อนุมัติแล้ว] คำขอแก้ไขข้อมูลส่วนตัวสารวัตร')
          .addFields({
            name: '👑 ผลการพิจารณา',
            value: `✅ **อนุมัติเรียบร้อย** โดย <@${interaction.user.id}> เมื่อ <t:${Math.floor(Date.now() / 1000)}:R>`,
            inline: false
          });

        await interaction.editReply({
          embeds: [updatedEmbed],
          components: []
        });
      } else {
        if (targetUser) {
          const dmEmbed = new EmbedBuilder()
            .setTitle('❌ คำขอแก้ไขข้อมูลส่วนตัวไม่ผ่านการอนุมัติ')
            .setDescription(
              `คำขอแก้ไขข้อมูลส่วนตัวของคุณไม่ผ่านการอนุมัติจากคณะผู้บริหาร\n` +
              `หากมีข้อสงสัย โปรดติดต่อหัวหน้าฝ่ายบริหารงานสารวัตรนักเรียนครับ`
            )
            .setColor('#E74C3C')
            .setFooter({ text: 'ฝ่ายบริหารงานสารวัตร • โรงเรียนพระนารายณ์' });

          await targetUser.send({ embeds: [dmEmbed] }).catch(() => {});
        }

        const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
          .setColor('#E74C3C')
          .setTitle('❌ [ปฏิเสธแล้ว] คำขอแก้ไขข้อมูลส่วนตัวสารวัตร')
          .addFields({
            name: '👑 ผลการพิจารณา',
            value: `❌ **ปฏิเสธคำขอ** โดย <@${interaction.user.id}> เมื่อ <t:${Math.floor(Date.now() / 1000)}:R>`,
            inline: false
          });

        await interaction.editReply({
          embeds: [updatedEmbed],
          components: []
        });
      }
      return;
    }

    // -------------------------------------------------------------
    // 5.1 ระบบขออนุมัติปฏิบัติหน้าที่ (Operation / Incident Case Flow)
    // -------------------------------------------------------------
    if (interaction.isButton() && (interaction.customId === 'btn_request_inspection' || interaction.customId === 'btn_request_operation')) {
      const { data: member } = await supabase
        .from('members')
        .select('*')
        .eq('discord_id', interaction.user.id)
        .eq('status', 'ACTIVE')
        .maybeSingle();

      if (!member) {
        await interaction.reply({
          content: '⚠️ ไม่พบข้อมูลสารวัตรที่ได้รับการอนุมัติของคุณในระบบ กรุณายืนยันตัวตนในห้อง `#ยืนยันตัวตน` ก่อนครับ',
          ephemeral: true
        });
        return;
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('btn_insp_cat_brawl')
          .setLabel('💥 เกิดเหตุก่อวิวาท')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('btn_insp_cat_suspicious')
          .setLabel('👁️ เหตุน่าสงสัย')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('btn_insp_cat_other')
          .setLabel('📌 เหตุผลอื่นๆ')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.reply({
        content: '🎯 **กรุณาเลือกประเภทการขออนุมัติปฏิบัติหน้าที่:**\nเลือกลักษณะเหตุการณ์เพื่อเปิดแบบฟอร์มขออนุมัติไปยังผู้บังคับบัญชาและสร้างคดีในห้อง `#แจ้งเหตุใหม่`',
        components: [row],
        ephemeral: true
      });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('btn_insp_cat_')) {
      const catKey = interaction.customId.replace('btn_insp_cat_', '');
      const catMap = {
        brawl: { name: 'เกิดเหตุก่อวิวาท', urgency: 'ด่วนมาก', placeholder: 'เช่น กลุ่มนักเรียนเตรียมชกต่อยบริเวณหลังอาคาร 3' },
        suspicious: { name: 'เหตุน่าสงสัย', urgency: 'ด่วน', placeholder: 'เช่น พบกลุ่มบุคคลพฤติกรรมเสี่ยง มั่วสุม พกพาสิ่งผิดระเบียบ' },
        other: { name: 'เหตุผลอื่นๆ', urgency: 'ปกติ', placeholder: 'เช่น ตรวจตราพื้นที่พิเศษ ตรวจตราค้นหาสิ่งผิดระเบียบ' }
      };
      const catInfo = catMap[catKey] || catMap.other;

      const modal = new ModalBuilder()
        .setCustomId(`modal_request_insp_${catKey}`)
        .setTitle(`ขออนุมัติปฏิบัติ: ${catInfo.name}`.slice(0, 45));

      const targetInput = new TextInputBuilder()
        .setCustomId('input_insp_target')
        .setLabel('สถานที่ / จุดเกิดเหตุ')
        .setPlaceholder('เช่น หลังอาคาร 3, ห้องน้ำชาย, โรงอาหาร, สวนหย่อม')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const reasonInput = new TextInputBuilder()
        .setCustomId('input_insp_reason')
        .setLabel('รายละเอียด / พฤติการณ์เหตุการณ์')
        .setPlaceholder(catInfo.placeholder)
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      const officersInput = new TextInputBuilder()
        .setCustomId('input_insp_officers')
        .setLabel('สารวัตรผู้ร่วมปฏิบัติ (รหัสเวร/ชื่อ)')
        .setPlaceholder('เช่น [TS1] ปัน, [TS2] กาย (หรือระบุเดี่ยว)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

      const urgencyInput = new TextInputBuilder()
        .setCustomId('input_insp_urgency')
        .setLabel('ระดับความเร่งด่วน (ปกติ/ด่วน/ด่วนมาก)')
        .setValue(catInfo.urgency)
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(targetInput),
        new ActionRowBuilder().addComponents(reasonInput),
        new ActionRowBuilder().addComponents(officersInput),
        new ActionRowBuilder().addComponents(urgencyInput)
      );

      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit() && (interaction.customId.startsWith('modal_request_insp_') || interaction.customId === 'modal_request_inspection')) {
      await interaction.deferReply({ ephemeral: true });

      const target = interaction.fields.getTextInputValue('input_insp_target').trim();
      const reason = interaction.fields.getTextInputValue('input_insp_reason').trim();
      const officers = interaction.fields.getTextInputValue('input_insp_officers')?.trim() || '-';
      const urgency = interaction.fields.getTextInputValue('input_insp_urgency')?.trim() || 'ปกติ';

      let catName = 'ขออนุมัติปฏิบัติหน้าที่';
      if (interaction.customId.includes('brawl')) catName = 'เกิดเหตุก่อวิวาท';
      else if (interaction.customId.includes('suspicious')) catName = 'เหตุน่าสงสัย';
      else if (interaction.customId.includes('other')) catName = 'เหตุผลอื่นๆ';

      const { data: member } = await supabase
        .from('members')
        .select('*')
        .eq('discord_id', interaction.user.id)
        .maybeSingle();

      const caseId = 'CASE-' + Math.floor(1000 + Math.random() * 9000);
      const officerName = member ? `[${member.duty_id || 'สารวัตร'}] ${member.first_name} (${member.nickname})` : interaction.user.username;

      // 1. บันทึกลง Supabase cases table (เป็นประเภท 'คำขออนุมัติ')
      await supabase.from('cases').insert({
        case_id: caseId,
        reporter_email: member?.email || `${interaction.user.id}@discord.local`,
        reporter_name: officerName,
        incident_date_time: new Date().toISOString(),
        location: target,
        category: `คำขออนุมัติ: ${catName}`,
        description: `[คำขออนุมัติปฏิบัติหน้าที่]\nประเภทคำขอ: ${catName}\nสถานที่: ${target}\nรายละเอียด: ${reason}\nผู้ร่วมปฏิบัติ: ${officers}\nความเร่งด่วน: ${urgency}\nผู้ขอ: <@${interaction.user.id}>`,
        status: 'PENDING_APPROVAL',
        assigned_duty_day: member?.duty_day || null,
        assigned_officer_id: member?.id || null
      });

      // 2. ส่งคดีเข้าห้อง "แจ้งเหตุใหม่"
      const guild = interaction.guild;
      const chIncident = findChannel(guild, '🚨│แจ้งเหตุใหม่-google-form') ||
                         findChannel(guild, 'แจ้งเหตุใหม่') ||
                         findChannel(guild, '🚨│แจ้งเหตุใหม่') ||
                         (process.env.INCIDENT_CHANNEL_ID ? guild.channels.cache.get(process.env.INCIDENT_CHANNEL_ID) : null) ||
                         findChannel(guild, '👑│ผู้นำ-all-in-one') ||
                         interaction.channel;

      const webBaseUrl = process.env.WEB_URL || 'http://localhost:10001';
      const bodycamLink = `${webBaseUrl}/bodycam-upload.html?caseId=${caseId}`;

      let incidentMsg = null;
      let thread = null;

      if (chIncident) {
        const isUrgent = urgency.includes('ด่วน') || catName.includes('วิวาท');
        const embed = new EmbedBuilder()
          .setTitle(`🚨 [คำขออนุมัติปฏิบัติหน้าที่] รหัสคดี: ${caseId}`)
          .setDescription(
            `📌 **ประเภทคำขอ:** คำขออนุมัติ (${catName})\n\n` +
            `👤 **ผู้ยื่นคำขอ:** ${officerName} (<@${interaction.user.id}>)\n` +
            `📍 **สถานที่/จุดเกิดเหตุ:** ${target}\n` +
            `🎯 **รายละเอียด/พฤติการณ์:** ${reason}\n` +
            `👥 **ผู้ร่วมปฏิบัติ:** ${officers}\n` +
            `⚡ **ระดับความเร่งด่วน:** ${urgency}\n` +
            `📊 **สถานะ:** ⏳ รอยื่นหลักฐาน & รอผู้บังคับบัญชาวินิจฉัยคำสั่งการ\n\n` +
            `⚠️ *สารวัตรผู้ขอกรุณาส่งหลักฐาน (ภาพถ่าย/คลิป) เข้ามาในเธรดเพื่อให้ผู้บังคับบัญชาใช้วินิจฉัยก่อนอนุมัติ*`
          )
          .setColor(isUrgent ? '#E74C3C' : '#E67E22')
          .setFooter({ text: `SARAWAT-BOT • ระบบคำขออนุมัติปฏิบัติ • ${new Date().toLocaleTimeString('th-TH')}` });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`btn_approve_insp_${caseId}`)
            .setLabel('✅ อนุมัติปฏิบัติ')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`btn_reject_insp_${caseId}`)
            .setLabel('❌ ไม่อนุมัติ')
            .setStyle(ButtonStyle.Danger)
        );

        const pingContent = (ROLE_IDS.PRESIDENT && ROLE_IDS.VICE_PRESIDENT)
          ? `<@&${ROLE_IDS.PRESIDENT}> <@&${ROLE_IDS.VICE_PRESIDENT}> 📢 มีคำขออนุมัติปฏิบัติใหม่ (${caseId})`
          : `@here 📢 มีคำขออนุมัติปฏิบัติใหม่ (${caseId})`;

        incidentMsg = await chIncident.send({
          content: pingContent,
          embeds: [embed],
          components: [row]
        }).catch(() => null);

        // สร้างเธรดในห้องแจ้งเหตุใหม่สำหรับส่งหลักฐานและวินิจฉัยคดี
        if (incidentMsg && incidentMsg.startThread) {
          thread = await incidentMsg.startThread({
            name: `หลักฐาน-วินิจฉัย [${caseId}]`.slice(0, 100),
            autoArchiveDuration: 1440
          }).catch(() => null);

          if (thread) {
            await thread.send({
              content: `📸 <@${interaction.user.id}> **กรุณาส่งไฟล์ภาพถ่าย คลิปเหตุการณ์ หรือหลักฐานประกอบคำขออนุมัติในเธรดนี้**\n` +
                       `เพื่อให้ผู้บังคับบัญชาใช้วินิจฉัยก่อนอนุมัติการปฏิบัติหน้าที่ครับ (หรืออัปโหลดผ่านเว็บด้านล่าง)`,
              components: [
                new ActionRowBuilder().addComponents(
                  new ButtonBuilder()
                    .setStyle(ButtonStyle.Link)
                    .setURL(bodycamLink)
                    .setLabel('📹 อัปโหลดหลักฐาน/คลิปผ่านเว็บ')
                )
              ]
            }).catch(() => {});
          }
        }
      }

      // 3. แจ้งเตือนสารวัตรผู้ขอ พร้อมระบุให้ส่งหลักฐานเพื่อให้ผู้ให้คำอนุมัติวินิจฉัยก่อน
      const threadUrl = thread ? `https://discord.com/channels/${guild.id}/${thread.id}` : null;
      const chName = chIncident ? chIncident.name : 'แจ้งเหตุใหม่';

      const replyEmbed = new EmbedBuilder()
        .setTitle(`📋 ยื่นคำขออนุมัติปฏิบัติ [${caseId}] สำเร็จ`)
        .setDescription(
          `📌 **ประเภทคำขอ:** ${catName}\n` +
          `📍 **สถานที่:** ${target}\n` +
          `🏢 ระบบได้นำเรื่องสร้างคดีในห้อง **#${chName}** เรียบร้อยแล้ว\n\n` +
          `📸 **ขั้นตอนสำคัญ: กรุณาส่งหลักฐานประกอบการวินิจฉัย**\n` +
          `เพื่อให้ผู้บังคับบัญชาใช้วินิจฉัยก่อนอนุมัติ กรุณาส่งภาพถ่ายหรือคลิปหลักฐานเบื้องต้น:\n` +
          (threadUrl ? `• ส่งรูปภาพหรือพิมพ์ข้อมูลใน [เธรดหลักฐานคดี ${caseId}](${threadUrl})\n` : '') +
          `• หรือกดปุ่มด้านล่างเพื่ออัปโหลดไฟล์หลักฐาน/คลิปเข้าสู่ระบบ`
        )
        .setColor('#3498DB')
        .setFooter({ text: 'SARAWAT-BOT • ระบบคำขออนุมัติปฏิบัติหน้าที่' });

      const replyRow = new ActionRowBuilder();
      if (threadUrl) {
        replyRow.addComponents(
          new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setURL(threadUrl)
            .setLabel('💬 ไปยังเธรดส่งหลักฐาน')
        );
      }
      replyRow.addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setURL(bodycamLink)
          .setLabel('📹 อัปโหลดหลักฐาน/คลิป')
      );

      await interaction.editReply({
        embeds: [replyEmbed],
        components: [replyRow]
      });

      // ส่ง DM เตือนสารวัตรผู้ขอด้วย
      await interaction.user.send({
        content: `📢 <@${interaction.user.id}> คำขออนุมัติปฏิบัติ **${caseId}** ถูกสร้างแล้ว กรุณาส่งหลักฐานเพื่อให้ผู้บังคับบัญชาวินิจฉัยก่อน`,
        embeds: [replyEmbed],
        components: [replyRow]
      }).catch(() => {});

      return;
    }

    // เมื่อคนยศสูงกด "อนุมัติปฏิบัติ"
    if (interaction.isButton() && interaction.customId.startsWith('btn_approve_insp_')) {
      const isLeadership = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
        interaction.guild?.ownerId === interaction.user.id ||
        (ROLE_IDS.ADMIN && interaction.member.roles.cache.has(ROLE_IDS.ADMIN)) ||
        (ROLE_IDS.PRESIDENT && interaction.member.roles.cache.has(ROLE_IDS.PRESIDENT)) ||
        (ROLE_IDS.VICE_PRESIDENT && interaction.member.roles.cache.has(ROLE_IDS.VICE_PRESIDENT)) ||
        interaction.member.roles.cache.some(r => Object.values(ROLE_IDS.HEADS || {}).filter(Boolean).includes(r.id));

      if (!isLeadership) {
        await interaction.reply({
          content: '⛔ สงวนสิทธิ์เฉพาะผู้บังคับบัญชา / คนยศสูง (ประธาน, รองประธาน, หัวหน้าเวร, Admin) เท่านั้น',
          ephemeral: true
        });
        return;
      }

      const caseId = interaction.customId.replace('btn_approve_insp_', '');
      const modal = new ModalBuilder()
        .setCustomId(`modal_approve_insp_${caseId}`)
        .setTitle(`อนุมัติปฏิบัติ ${caseId}`.slice(0, 45));

      const noteInput = new TextInputBuilder()
        .setCustomId('input_insp_approval_note')
        .setLabel('หมายเหตุ / คำสั่งการเพิ่มเติม')
        .setPlaceholder('เช่น อนุญาตให้ปฏิบัติ ระมัดระวังความปลอดภัย ถ่าย Bodycam ให้ชัดเจน')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false);

      modal.addComponents(new ActionRowBuilder().addComponents(noteInput));
      await interaction.showModal(modal);
      return;
    }

    // เมื่อคนยศสูงกด "ไม่อนุมัติ"
    if (interaction.isButton() && interaction.customId.startsWith('btn_reject_insp_')) {
      const isLeadership = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
        interaction.guild?.ownerId === interaction.user.id ||
        (ROLE_IDS.ADMIN && interaction.member.roles.cache.has(ROLE_IDS.ADMIN)) ||
        (ROLE_IDS.PRESIDENT && interaction.member.roles.cache.has(ROLE_IDS.PRESIDENT)) ||
        (ROLE_IDS.VICE_PRESIDENT && interaction.member.roles.cache.has(ROLE_IDS.VICE_PRESIDENT)) ||
        interaction.member.roles.cache.some(r => Object.values(ROLE_IDS.HEADS || {}).filter(Boolean).includes(r.id));

      if (!isLeadership) {
        await interaction.reply({
          content: '⛔ สงวนสิทธิ์เฉพาะผู้บังคับบัญชา / คนยศสูง เท่านั้น',
          ephemeral: true
        });
        return;
      }

      const caseId = interaction.customId.replace('btn_reject_insp_', '');
      const modal = new ModalBuilder()
        .setCustomId(`modal_reject_insp_${caseId}`)
        .setTitle(`ไม่อนุมัติปฏิบัติ ${caseId}`.slice(0, 45));

      const reasonInput = new TextInputBuilder()
        .setCustomId('input_insp_reject_reason')
        .setLabel('เหตุผลที่ไม่อนุมัติ')
        .setPlaceholder('เช่น กำลังพลไม่เพียงพอ, ภารกิจซ้ำซ้อน')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      await interaction.showModal(modal);
      return;
    }

    // บันทึกการอนุมัติจากคนยศสูง
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_approve_insp_')) {
      await interaction.deferReply({ ephemeral: true });
      const caseId = interaction.customId.replace('modal_approve_insp_', '');
      const note = interaction.fields.getTextInputValue('input_insp_approval_note').trim() || 'อนุมัติให้ดำเนินการปฏิบัติหน้าที่ได้';
      const approverName = interaction.member.displayName || interaction.user.username;

      const { data: currentCase } = await supabase.from('cases').select('*').eq('case_id', caseId).maybeSingle();

      await supabase.from('cases').update({
        status: 'APPROVED',
        resolution_notes: `[อนุมัติโดย: ${approverName}]\nหมายเหตุ/คำสั่ง: ${note}`
      }).eq('case_id', caseId);

      // กวาดล้างข้อความแจ้งเตือนที่ค้างอยู่ในห้องประชุมหัวหน้าและห้องอื่นๆ ทันที
      await cleanUpPendingNotificationMessages(interaction.guild, caseId, interaction);

      // อัปเดตข้อความในห้องแจ้งเหตุใหม่ / ผู้นำ
      if (interaction.message && interaction.message.embeds.length > 0) {
        const oldEmbed = interaction.message.embeds[0];
        const newEmbed = EmbedBuilder.from(oldEmbed)
          .setColor('#2ECC71')
          .setDescription(
            (oldEmbed.data.description || '').replace(
              /📊 \*\*สถานะ:\*\* .*/g,
              `📊 **สถานะ:** ✅ ได้รับการอนุมัติแล้ว\n👮 **ผู้อนุมัติ:** ${approverName} (<@${interaction.user.id}>)\n📝 **หมายเหตุ:** ${note}`
            )
          );
        await interaction.message.edit({ embeds: [newEmbed], components: [] }).catch(() => {});
      }

      await interaction.editReply({
        content: `✅ อนุมัติการปฏิบัติคดี **${caseId}** สำเร็จแล้ว! บอทได้ส่งการแจ้งเตือนไปยังสารวัตรผู้ขอเรียบร้อยแล้ว`
      });

      // ดึง Discord ID ของสารวัตรผู้ขอ
      let requesterDiscordId = null;
      if (currentCase?.assigned_officer_id) {
        const { data: reqMember } = await supabase.from('members').select('discord_id').eq('id', currentCase.assigned_officer_id).maybeSingle();
        requesterDiscordId = reqMember?.discord_id;
      }
      if (!requesterDiscordId && currentCase?.description) {
        const match = currentCase.description.match(/<@(\d+)>/);
        if (match) requesterDiscordId = match[1];
      }

      const webBaseUrl = process.env.WEB_URL || 'http://localhost:10001';
      const bodycamLink = `${webBaseUrl}/bodycam-upload.html?caseId=${caseId}`;

      const notifyEmbed = new EmbedBuilder()
        .setTitle(`🟢 [แจ้งเตือน] คำขออนุมัติปฏิบัติ ${caseId} ได้รับการอนุมัติแล้ว!`)
        .setDescription(
          `ผู้บังคับบัญชา (**${approverName}**) ได้อนุมัติคำขอปฏิบัติหน้าที่แล้ว\n` +
          `📝 **หมายเหตุ/คำสั่ง:** ${note}\n\n` +
          `👮 **อนุมัติแล้ว เริ่มปฏิบัติหน้าที่ได้ทันที!**\n\n` +
          `───────────────────────\n` +
          `❓ **ปฏิบัติหน้าที่เสร็จรึยัง?**\n` +
          `เมื่อเสร็จสิ้นภารกิจแล้ว ให้กดปุ่ม **"🏁 ปฏิบัติหน้าที่เสร็จแล้ว"** ด้านล่าง เพื่อจัดบันทึกเข้าสารบบคดี (ใครทำ ทำอะไร ตอนไหน มีไฟล์หลักฐาน และอัปโหลดคลิป Bodycam)`
        )
        .setColor('#2ECC71')
        .setFooter({ text: `SARAWAT-BOT • ระบบปฏิบัติการ • คดี ${caseId}` });

      const notifyRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`btn_finish_insp_${caseId}`)
          .setLabel('🏁 ปฏิบัติหน้าที่เสร็จแล้ว')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setURL(bodycamLink)
          .setLabel('📹 อัปโหลดคลิป Bodycam')
      );

      // ส่งอัปเดตเข้าเธรดของคดี (ถ้ามี)
      if (interaction.message?.thread) {
        await interaction.message.thread.send({
          content: `✅ <@${requesterDiscordId || interaction.user.id}> **คำขออนุมัติปฏิบัตินี้ได้รับการอนุมัติแล้วโดย ${approverName}**\n📝 **หมายเหตุ/คำสั่ง:** ${note}\n👮 **อนุมัติแล้ว เริ่มปฏิบัติหน้าที่ได้ทันที!**\nเมื่อเสร็จสิ้นภารกิจให้กดปุ่มด้านล่างเพื่อบันทึกปิดคดี`,
          components: [notifyRow]
        }).catch(() => {});
      }

      // ส่ง DM แจ้งเตือนสารวัตรผู้ขอ (เฉพาะข้อความส่วนตัว ไม่รบกวนช่องสาธารณะ)
      if (requesterDiscordId) {
        const requesterUser = await client.users.fetch(requesterDiscordId).catch(() => null);
        if (requesterUser) {
          await requesterUser.send({
            content: `🚨 <@${requesterDiscordId}> **คำขออนุมัติปฏิบัติของคุณได้รับการอนุมัติแล้ว!**`,
            embeds: [notifyEmbed],
            components: [notifyRow]
          }).catch(() => {});
        }
      }

      return;
    }

    // บันทึกการปฏิเสธคำขอ
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_reject_insp_')) {
      await interaction.deferReply({ ephemeral: true });
      const caseId = interaction.customId.replace('modal_reject_insp_', '');
      const reason = interaction.fields.getTextInputValue('input_insp_reject_reason').trim();
      const approverName = interaction.member.displayName || interaction.user.username;

      await supabase.from('cases').update({
        status: 'REJECTED',
        resolution_notes: `[ไม่อนุมัติโดย: ${approverName}]\nเหตุผล: ${reason}`
      }).eq('case_id', caseId);

      // กวาดล้างข้อความแจ้งเตือนที่ค้างอยู่ในห้องประชุมหัวหน้าและห้องอื่นๆ ทันที
      await cleanUpPendingNotificationMessages(interaction.guild, caseId, interaction);

      if (interaction.message && interaction.message.embeds.length > 0) {
        const oldEmbed = interaction.message.embeds[0];
        const newEmbed = EmbedBuilder.from(oldEmbed)
          .setColor('#95A5A6')
          .setDescription(
            (oldEmbed.data.description || '').replace(
              /📊 \*\*สถานะ:\*\* .*/g,
              `📊 **สถานะ:** ❌ ไม่อนุมัติ\n👮 **ผู้สั่งการ:** ${approverName}\n📝 **เหตุผล:** ${reason}`
            )
          );
        await interaction.message.edit({ embeds: [newEmbed], components: [] }).catch(() => {});
      }

      if (interaction.message?.thread) {
        await interaction.message.thread.send({
          content: `❌ **คำขออนุมัติปฏิบัตินี้ไม่ได้รับการอนุมัติโดย ${approverName}**\n📝 **เหตุผล:** ${reason}`
        }).catch(() => {});
      }

      await interaction.editReply({ content: `บันทึกการไม่อนุมัติคดี ${caseId} เรียบร้อยแล้ว` });
      return;
    }

    // เมื่อกด "ปฏิบัติหน้าที่เสร็จแล้ว"
    if (interaction.isButton() && interaction.customId.startsWith('btn_finish_insp_')) {
      const caseId = interaction.customId.replace('btn_finish_insp_', '');

      const modal = new ModalBuilder()
        .setCustomId(`modal_finish_insp_${caseId}`)
        .setTitle(`บันทึกปิดคดี ${caseId}`.slice(0, 45));

      const whoInput = new TextInputBuilder()
        .setCustomId('input_finish_who')
        .setLabel('ใครทำ (รายชื่อสารวัตรผู้ปฏิบัติ)')
        .setPlaceholder('เช่น [TS1] ปัน, [TS2] กาย')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const whatInput = new TextInputBuilder()
        .setCustomId('input_finish_what')
        .setLabel('ทำอะไร (ผลการปฏิบัติและสิ่งที่พบ)')
        .setPlaceholder('เช่น ระงับเหตุนักเรียนทะเลาะวิวาท ยึดของกลาง ส่งฝ่ายปกครอง')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      const whenInput = new TextInputBuilder()
        .setCustomId('input_finish_when')
        .setLabel('ตอนไหน (เวลาปฏิบัติ เช่น 12:30 น.)')
        .setPlaceholder('เช่น วันนี้ 12:30 - 13:00 น.')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const evidenceInput = new TextInputBuilder()
        .setCustomId('input_finish_evidence')
        .setLabel('ไฟล์หลักฐาน / ลิงก์ไดรฟ์ (ถ้ามี)')
        .setPlaceholder('แนบลิงก์ Google Drive หรือระบุว่าอัปโหลดคลิป Bodycam')
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(whoInput),
        new ActionRowBuilder().addComponents(whatInput),
        new ActionRowBuilder().addComponents(whenInput),
        new ActionRowBuilder().addComponents(evidenceInput)
      );

      await interaction.showModal(modal);
      return;
    }

    // ส่งแบบฟอร์มปิดคดีและบันทึกข้อมูลผลการตรวจ
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_finish_insp_')) {
      await interaction.deferReply({ ephemeral: false });
      const caseId = interaction.customId.replace('modal_finish_insp_', '');

      const who = interaction.fields.getTextInputValue('input_finish_who').trim();
      const what = interaction.fields.getTextInputValue('input_finish_what').trim();
      const when = interaction.fields.getTextInputValue('input_finish_when').trim();
      const evidence = interaction.fields.getTextInputValue('input_finish_evidence').trim();

      const { data: currentCase } = await supabase.from('cases').select('*').eq('case_id', caseId).maybeSingle();

      const finalNotes = `${currentCase?.resolution_notes ? currentCase.resolution_notes + '\n────────────────\n' : ''}` +
        `[บันทึกผลการตรวจเสร็จสิ้น]\n` +
        `• ใครทำ: ${who}\n` +
        `• ทำอะไร: ${what}\n` +
        `• ตอนไหน: ${when}\n` +
        `• บันทึกหลักฐาน: ${evidence || '-'}`;

      const currentUrls = currentCase?.evidence_urls || [];
      const newUrls = [...currentUrls];
      if (evidence && (evidence.startsWith('http://') || evidence.startsWith('https://'))) {
        newUrls.push(evidence);
      }

      await supabase.from('cases').update({
        status: 'RESOLVED',
        resolution_notes: finalNotes,
        evidence_urls: newUrls
      }).eq('case_id', caseId);

      const webBaseUrl = process.env.WEB_URL || 'http://localhost:10001';
      const bodycamLink = `${webBaseUrl}/bodycam-upload.html?caseId=${caseId}`;

      const resultEmbed = new EmbedBuilder()
        .setTitle(`📁 [บันทึกเข้าคดีเสร็จสิ้น] รหัสคดี: ${caseId}`)
        .setDescription(
          `การปฏิบัติหน้าที่ตรวจได้รับการบันทึกและปิดคดีเรียบร้อยแล้ว\n\n` +
          `👤 **ใครทำ:** ${who}\n` +
          `📝 **ทำอะไร:** ${what}\n` +
          `⏰ **ตอนไหน:** ${when}\n` +
          `📂 **ไฟล์หลักฐาน:** ${evidence || 'ไม่มีระบุเพิ่มเติม'}\n` +
          `📊 **สถานะ:** ✅ เสร็จสิ้น (RESOLVED)\n\n` +
          `📹 **อัปโหลดคลิป Bodycam:**\n` +
          `สามารถกดปุ่ม **"📹 เข้าไป Upload ไฟล์คลิป Bodycam"** ด้านล่าง หรือแนบไฟล์เข้ามาทาง Discord พร้อมระบุรหัส ${caseId} ได้ทันที`
        )
        .setColor('#3498DB')
        .setFooter({ text: `SARAWAT-BOT • ระบบบันทึกผลคดี • โรงเรียนพระนารายณ์` })
        .setTimestamp();

      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setURL(bodycamLink)
          .setLabel('📹 เข้าไป Upload ไฟล์คลิป Bodycam'),
        new ButtonBuilder()
          .setCustomId(`btn_discord_upload_${caseId}`)
          .setLabel('📤 แนบไฟล์ผ่าน Discord')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({
        embeds: [resultEmbed],
        components: [actionRow]
      });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('btn_discord_upload_')) {
      const caseId = interaction.customId.replace('btn_discord_upload_', '');
      await interaction.reply({
        content: `📤 คุณสามารถส่งไฟล์คลิปวิดีโอ (MP4, MOV) หรือภาพถ่ายหลักฐานในช่องนี้ได้เลยครับ โดยพิมพ์รหัสคดี **${caseId}** มาพร้อมกับไฟล์ บอทจะบันทึกลิงก์ไฟล์เข้าคดีให้อัตโนมัติ`,
        ephemeral: true
      });
      return;
    }

    // -------------------------------------------------------------
    // 5.2 ระบบขอลาเวรด่วนผ่าน DM (Quick Leave from Duty Reminder DM)
    // -------------------------------------------------------------
    if (interaction.isButton() && interaction.customId.startsWith('btn_dm_quick_leave_')) {
      const memberId = interaction.customId.replace('btn_dm_quick_leave_', '');
      const { data: member } = await supabase
        .from('members')
        .select('*')
        .eq('id', memberId)
        .maybeSingle();

      if (!member) {
        await interaction.reply({
          content: '⚠️ ไม่พบข้อมูลสารวัตรในระบบ กรุณาตรวจสอบการลงทะเบียนอีกครั้ง',
          ephemeral: true
        });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId(`modal_dm_quick_leave_${member.id}`)
        .setTitle(`📝 ขอลาเวรด่วน [${(member.duty_id || member.nickname).slice(0, 20)}]`);

      const todayStr = `วันนี้ (${new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })})`;

      const dateInput = new TextInputBuilder()
        .setCustomId('input_leave_date')
        .setLabel('วันที่ขอลา (เช่น วันนี้)')
        .setValue(todayStr)
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const periodInput = new TextInputBuilder()
        .setCustomId('input_shift_period')
        .setLabel('ช่วงเวลาที่ลา (เช้า/กลางวัน/เย็น/ทั้งวัน)')
        .setPlaceholder('เช่น เช้า, กลางวัน, เย็น หรือ ทั้งวัน')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const typeInput = new TextInputBuilder()
        .setCustomId('input_leave_type')
        .setLabel('ประเภทการลา (ลาป่วย / ลากิจ / ติดสอบ)')
        .setPlaceholder('ลาป่วย หรือ ลากิจ หรือ ติดสอบ')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const reasonInput = new TextInputBuilder()
        .setCustomId('input_leave_reason')
        .setLabel('เหตุผลการลา')
        .setPlaceholder('ระบุเหตุผลความจำเป็นในการลา...')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      const substituteInput = new TextInputBuilder()
        .setCustomId('input_substitute')
        .setLabel('สารวัตรที่เข้าเวรแทน (ถ้ามี)')
        .setPlaceholder('เช่น [TS2] กาย หรือ ไม่มี')
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(dateInput),
        new ActionRowBuilder().addComponents(periodInput),
        new ActionRowBuilder().addComponents(typeInput),
        new ActionRowBuilder().addComponents(reasonInput),
        new ActionRowBuilder().addComponents(substituteInput)
      );

      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_dm_quick_leave_')) {
      await interaction.deferReply({ ephemeral: true });
      const memberId = interaction.customId.replace('modal_dm_quick_leave_', '');

      const leaveDate = interaction.fields.getTextInputValue('input_leave_date').trim();
      const shiftPeriod = interaction.fields.getTextInputValue('input_shift_period').trim();
      const leaveType = interaction.fields.getTextInputValue('input_leave_type').trim();
      const reason = interaction.fields.getTextInputValue('input_leave_reason').trim();
      const substitute = interaction.fields.getTextInputValue('input_substitute').trim() || '-';

      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).single();

      // บันทึกลงตาราง leave_requests
      await supabase.from('leave_requests').insert({
        member_id: member.id,
        duty_day: member.duty_day,
        leave_date: leaveDate,
        shift_period: shiftPeriod,
        leave_type: leaveType,
        reason: reason,
        substitute_name: substitute,
        status: 'NOTIFIED'
      });

      // ค้นหาหัวหน้าเวรและรองหัวหน้าเวรประจำวัน
      const baseDay = member.duty_day === 'S' ? 'S' : (member.duty_day === 'TSS' ? 'Ts' : (member.duty_day.replace(/S+$/, '') || member.duty_day));
      const targetDays = baseDay === 'S'
        ? ['S', 'MS', 'TS', 'WS', 'TSS', 'FS']
        : [member.duty_day, baseDay].filter(Boolean);
      const { data: heads } = await supabase
        .from('members')
        .select('*')
        .in('duty_day', targetDays)
        .in('shift_role', ['SHIFT_HEAD', 'SHIFT_DEPUTY'])
        .not('discord_id', 'is', null)
        .eq('status', 'ACTIVE');

      const dmEmbed = new EmbedBuilder()
        .setTitle('🚨 [แจ้งเตือนการลาเวรด่วน] มีสมาชิกขอลาเวรวันนี้')
        .setColor('#E74C3C')
        .setDescription(`สารวัตร **[${member.duty_id || '-'}] ${member.first_name} ${member.last_name} (${member.nickname})** ได้แจ้งขอลาเวรด่วน`)
        .addFields(
          { name: '📅 วันที่/ช่วงเวลา', value: `${leaveDate} (${shiftPeriod})`, inline: true },
          { name: '🏷️ ประเภทการลา', value: leaveType, inline: true },
          { name: '📝 เหตุผลการลา', value: reason, inline: false },
          { name: '🔄 ผู้เข้าเวรแทน', value: substitute, inline: true },
          { name: '📞 เบอร์โทรสารวัตร', value: member.phone_number || '-', inline: true }
        )
        .setFooter({ text: `เวร${DAY_NAMES[baseDay] || member.duty_day} • กลุ่มงานสารวัตรนักเรียน โรงเรียนพระนารายณ์` })
        .setTimestamp();

      let dmSentCount = 0;
      if (heads && heads.length > 0) {
        for (const head of heads) {
          try {
            const user = await client.users.fetch(head.discord_id);
            if (user) {
              await user.send({ embeds: [dmEmbed] });
              dmSentCount++;
            }
          } catch (e) {}
        }
      }

      await interaction.editReply({
        content: `✅ ส่งคำขอลาเวรสำเร็จแล้ว!\n• บันทึกข้อมูลการลาลงฐานข้อมูลเรียบร้อย\n• วันที่ลา: ${leaveDate} (${shiftPeriod})\n• ส่งข้อความแจ้งเตือนถึงหัวหน้าและรองหัวหน้าเวรแล้ว ${dmSentCount} ท่าน`
      });
      return;
    }

    // -------------------------------------------------------------
    // 5.3 Diagnostic & Test System Buttons
    // -------------------------------------------------------------
    if (interaction.isButton() && interaction.customId === 'btn_run_diagnostics') {
      await interaction.deferReply({ ephemeral: true });
      const report = await runSystemDiagnostics(interaction.guild);
      const embed = new EmbedBuilder()
        .setTitle('🛠️ SARAWAT-BOT SYSTEM DIAGNOSTIC REPORT')
        .setDescription(`ผลการตรวจสอบความพร้อมทุกฟีเจอร์ของระบบสารวัตรนักเรียน\nเซิร์ฟเวอร์: **${report.guild}** • ผลลัพธ์: ${report.overallSuccess ? '🟢 **ผ่านทั้งหมด (ALL SYSTEMS GO)**' : '🟡 **พบข้อควรระวัง/ไม่สมบูรณ์**'}`)
        .setColor(report.overallSuccess ? '#2ECC71' : '#F39C12')
        .setFooter({ text: 'SARAWAT DIAGNOSTIC SUITE • โรงเรียนพระนารายณ์' })
        .setTimestamp();

      report.checks.forEach(c => {
        embed.addFields({
          name: `${c.pass ? '✅' : '❌'} ${c.category}`,
          value: c.detail,
          inline: false
        });
      });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('btn_test_reminder_dryrun')
          .setLabel('🔔 ทดสอบแจ้งเตือนเวร (Dry-run)')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('btn_test_refresh_panels')
          .setLabel('🔄 รีเฟรชทุกช่องระบบ')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({ embeds: [embed], components: [row] });
      return;
    }

    // 🔄 ปุ่มรีเฟรชยอดการลาเวรประจำผลัดแบบ Realtime
    if (interaction.isButton() && interaction.customId.startsWith('btn_refresh_shift_leaves_')) {
      await interaction.deferReply({ ephemeral: true });
      const shiftDay = interaction.customId.replace('btn_refresh_shift_leaves_', '');
      const targetGuild = interaction.guild || client.guilds.cache.get(process.env.GUILD_ID) || client.guilds.cache.first();
      const res = await broadcastConsolidatedShiftLeaveCard(targetGuild, shiftDay, null, `👮 คุณ${interaction.member?.displayName || interaction.user.username} (กดรีเฟรช)`);
      await interaction.editReply({
        content: `✅ รีเฟรชยอดการลาเวรประจำผลัด **${shiftDay}** แบบ Realtime เรียบร้อยแล้ว!\n• กำลังพลทั้งหมด: ${res.total} นาย\n• ขอลา: ${res.leaveCount} นาย\n• พร้อมเข้าเวร: ${res.onDutyCount} นาย (${res.readinessPct}%)`
      });
      return;
    }

    // 📨 ปุ่มทดสอบส่งการ์ดแจ้งเตือนเวรเข้า DM ของฉัน
    if (interaction.isButton() && interaction.customId === 'btn_test_reminder_self') {
      await interaction.deferReply({ ephemeral: true });
      const { data: callerMember } = await supabase
        .from('members')
        .select('*')
        .eq('discord_id', interaction.user.id)
        .maybeSingle();

      const sampleMember = callerMember || {
        id: 'sample-test-id',
        nickname: interaction.user.username,
        first_name: interaction.user.username,
        last_name: '(ทดสอบระบบ)',
        duty_id: 'TEST-01',
        duty_day: 'TS'
      };

      const todayThaiDate = new Date().toLocaleDateString('th-TH', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Asia/Bangkok'
      });
      const baseDay = sampleMember.duty_day === 'TSS' ? 'Ts' : sampleMember.duty_day.replace(/S+$/, '');
      const shiftLabel = getShiftLabel(sampleMember.duty_day);

      const sampleEmbed = new EmbedBuilder()
        .setTitle('🔔 [ทดสอบ] แจ้งเตือนเวรสารวัตรนักเรียนประจำวัน')
        .setDescription(
          `# ☀️ วันนี้เป็นเวรปฏิบัติหน้าที่ของคุณ! (ข้อความทดสอบ)\n\n` +
          `### 👮 [${sampleMember.duty_id}] คุณ${sampleMember.nickname} (${sampleMember.first_name} ${sampleMember.last_name})\n` +
          `📅 **ประจำวัน:** **${todayThaiDate}** (${shiftLabel})\n` +
          `⏰ **ข้อปฏิบัติ:** สวมปลอกแขน/เครื่องแบบสารวัตร และเข้าประจำจุดตรวจตามเวลา\n\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `### ⚠️ หากติดภารกิจและต้องการลาเวร\n` +
          `กดปุ่ม **"📝 ขอลาเวรวันนี้"** ด้านล่างได้ทันทีเพื่อเลือกประเภทการลาและระบุหมายเหตุ`
        )
        .setColor('#F39C12')
        .setFooter({ text: `[โหมดทดสอบ] เวร${DAY_NAMES[baseDay] || sampleMember.duty_day} • กลุ่มงานสารวัตรนักเรียน` })
        .setTimestamp();

      const sampleRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`btn_dm_quick_leave_${sampleMember.id}`)
          .setLabel('📝 ขอลาเวรวันนี้ (ทดสอบกดได้)')
          .setStyle(ButtonStyle.Danger)
      );

      try {
        await interaction.user.send({ embeds: [sampleEmbed], components: [sampleRow] });
        await sendBotActionLog(interaction.guild, {
          title: '🧪 [ทดสอบแจ้งเตือนเวร] ส่งตัวอย่างเข้า DM ผู้สั่งการ',
          description: 'ผู้ดูแลระบบได้ทำการทดสอบส่งการ์ดแจ้งเตือนเวรประจำวันเข้าสู่ DM ส่วนตัวเพื่อตรวจสอบความเรียบร้อย',
          color: '#3498DB',
          actor: `👮 คุณ${interaction.member?.displayName || interaction.user.username}`,
          fields: [
            { name: '👤 ผู้รับการทดสอบ', value: `<@${interaction.user.id}> (${interaction.user.tag})`, inline: true },
            { name: '🏷️ ผลัดเวรตัวอย่าง', value: `${shiftLabel}`, inline: true }
          ]
        });
        await interaction.editReply({
          content: `✅ ส่งตัวอย่างการ์ดแจ้งเตือนเวรเข้าสู่ DM ของคุณ (<@${interaction.user.id}>) เรียบร้อยแล้ว! ตรวจสอบกล่องข้อความส่วนตัวได้เลยครับ`
        });
      } catch (dmErr) {
        await interaction.editReply({
          content: '⚠️ ไม่สามารถส่งข้อความเข้า DM ของคุณได้ กรุณาเปิดการตั้งค่า "Allow direct messages from server members" ใน Discord ครับ'
        });
      }
      return;
    }

    if (interaction.isButton() && interaction.customId === 'btn_test_reminder_dryrun') {
      await interaction.deferReply({ ephemeral: true });
      const res = await sendDailyDutyReminders(interaction.guild, { dryRun: true });
      await interaction.editReply({
        content: `🧪 **ผลการจำลองแจ้งเตือนเวร (Dry-run):**\n• รหัสเวรเป้าหมาย: ${res.codes?.join(', ') || '-'}\n• พบสารวัตรที่มีเวร: ${res.count || 0} นาย\n• ไม่ได้ส่งข้อความจริงไปยังผู้ใช้ (โหมดทดสอบ ปลอดภัย 100%)`
      });
      return;
    }

    if (interaction.isButton() && interaction.customId === 'btn_test_refresh_panels') {
      await interaction.deferReply({ ephemeral: true });
      const res = await refreshAllChannelsAndPanels(interaction.guild, { purge: true });
      await interaction.editReply({
        content: `✅ รีเฟรชและเคลียร์ห้องฟีเจอร์สำเร็จทั้งหมด ${res.count || 0} ห้องเรียบร้อยแล้ว!`
      });
      return;
    }

    // 6. Member Inspector
    if (interaction.isButton() && interaction.customId === 'btn_inspect_roster') {
      await interaction.deferReply({ ephemeral: true });

      const { data: members, error } = await supabase
        .from('members')
        .select('*')
        .eq('status', 'ACTIVE')
        .order('duty_day', { ascending: true })
        .order('duty_id', { ascending: true });

      if (error) throw error;

      const grouped = { 'M': [], 'T': [], 'W': [], 'Ts': [], 'F': [], 'S': [] };
      members.forEach(m => {
        if (grouped[m.duty_day]) {
          grouped[m.duty_day].push(m);
        } else {
          const base = m.duty_day === 'TSS' ? 'Ts' : m.duty_day?.replace(/S+$/, '');
          if (base && grouped[base]) {
            grouped[base].push(m);
          } else if (grouped['S']) {
            grouped['S'].push(m);
          }
        }
      });

      let previewText = '📋 **พรีวิวรายชื่อสารวัตรนักเรียนทั้งหมด (แยกตามเวร):**\n';
      for (const [dayCode, dayMembers] of Object.entries(grouped)) {
        previewText += `\n**${DAY_NAMES[dayCode]} (${dayCode}):**\n`;
        if (dayMembers.length === 0) {
          previewText += '  _(ยังไม่มีสมาชิก)_\n';
        } else {
          previewText += dayMembers
            .map(m => {
              const roleTag = m.shift_role === 'SHIFT_HEAD' ? ' 👑(หัวหน้าเวร)' : (m.shift_role === 'SHIFT_DEPUTY' ? ' 🎖️(รอง)' : '');
              return `  • **[${m.duty_id || 'รอรหัส'}]** ${m.nickname} (${m.first_name} ${m.last_name})${roleTag}`;
            })
            .join('\n') + '\n';
        }
      }

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_inspect_member_detail')
        .setPlaceholder('🔍 เลือกสารวัตรที่ต้องการดูรายละเอียดและบัตรประจำตัว');

      members.slice(0, 25).forEach(m => {
        selectMenu.addOptions({
          label: `[${m.duty_id || '-'}] ${m.nickname} (${m.first_name} ${m.last_name})`,
          description: `${getShiftLabel(m.duty_day)} | ชั้น ${m.grade_class} | โทร: ${m.phone_number}`,
          value: m.id
        });
      });

      const row = new ActionRowBuilder().addComponents(selectMenu);
      await interaction.editReply({ content: previewText, components: [row] });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_inspect_member_detail') {
      await interaction.deferUpdate();
      const memberId = interaction.values[0];

      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).single();
      const { data: leaves } = await supabase.from('leave_requests').select('*').eq('member_id', memberId);

      const leaveCount = leaves ? leaves.length : 0;
      const recentLeaves = (leaves || [])
        .slice(-3)
        .map(l => `• ${l.leave_date} (${l.leave_type}): ${l.reason}`)
        .join('\n') || 'ยังไม่มีประวัติการลา';

      const shiftRoleThai = member.shift_role === 'SHIFT_HEAD' ? '👑 หัวหน้าเวร' : (member.shift_role === 'SHIFT_DEPUTY' ? '🎖️ รองหัวหน้าเวร' : 'สารวัตรประจำเวร');
      const mainRoleThai = member.role === 'PRESIDENT' ? '👑 ประธานสารวัตร' : (member.role === 'VICE_PRESIDENT' ? '🎖️ รองประธานสารวัตร' : 'สมาชิก');

      const profileEmbed = new EmbedBuilder()
        .setTitle(`🛡️ ข้อมูลสารวัตรนักเรียน: [${member.duty_id || '-'}] ${member.nickname}`)
        .setColor('#2ECC71')
        .addFields(
          { name: '👤 ชื่อ-นามสกุล', value: `${member.first_name} ${member.last_name} (${member.nickname})`, inline: true },
          { name: '🆔 รหัสประจำเวร', value: `\`${member.duty_id || '-'}\``, inline: true },
          { name: '📅 เวรประจำวัน', value: getShiftLabel(member.duty_day), inline: true },
          { name: '🏫 ระดับชั้น / เลขที่', value: `ชั้น ${member.grade_class} เลขที่ ${member.student_no}`, inline: true },
          { name: '📞 เบอร์โทรศัพท์', value: `**${member.phone_number || 'ไม่ได้ระบุ'}**`, inline: true },
          { name: '🎖️ บทบาท / หน้าที่', value: `${mainRoleThai} | ${shiftRoleThai}`, inline: true },
          { name: '💬 บัญชี Discord', value: member.discord_id ? `<@${member.discord_id}>` : 'ยังไม่ได้เชื่อมต่อ', inline: true },
          { name: '📊 สถิติการลาเวร', value: `เคยขอลา ${leaveCount} ครั้ง`, inline: true },
          { name: '📝 ประวัติการลาล่าสุด', value: recentLeaves, inline: false }
        )
        .setFooter({ text: 'ศูนย์ข้อมูลสารวัตรนักเรียน โรงเรียนพระนารายณ์' });

      if (member.profile_image_url) {
        profileEmbed.setThumbnail(member.profile_image_url);
      }

      const editRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`btn_edit_profile_${member.id}`)
          .setLabel('✏️ แก้ไขข้อมูล')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`btn_promote_${member.id}`)
          .setLabel('👑 แต่งตั้งตำแหน่ง')
          .setStyle(ButtonStyle.Success)
      );

      await interaction.followUp({
        embeds: [profileEmbed],
        components: [editRow],
        ephemeral: true
      });
    }

    // 7. แก้ไขข้อมูลส่วนบุคคล
    if (interaction.isButton() && interaction.customId.startsWith('btn_edit_profile_')) {
      const memberId = interaction.customId.replace('btn_edit_profile_', '');
      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).single();

      const isOwner = member.discord_id === interaction.user.id;
      const isLeadership = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
                           (ROLE_IDS.ADMIN && interaction.member.roles.cache.has(ROLE_IDS.ADMIN)) ||
                           interaction.member.roles.cache.has(ROLE_IDS.PRESIDENT) ||
                           interaction.member.roles.cache.has(ROLE_IDS.VICE_PRESIDENT);

      if (!isOwner && !isLeadership) {
        await interaction.reply({
          content: '⛔ **ปฏิเสธการเข้าถึง:** คุณไม่มีสิทธิ์แก้ไขข้อมูลของสมาชิกท่านนี้ (อนุญาตเฉพาะเจ้าของข้อมูลหรือคณะผู้บริหารเท่านั้น)',
          ephemeral: true
        });
        return;
      }

      const editModal = new ModalBuilder()
        .setCustomId(`modal_submit_edit_${member.id}`)
        .setTitle(`✏️ แก้ไขข้อมูล [${member.duty_id || member.nickname}]`);

      const nameInput = new TextInputBuilder()
        .setCustomId('edit_full_name')
        .setLabel('ชื่อจริง-นามสกุล (มี นาย/นาง/นางสาว ติดชื่อ)')
        .setPlaceholder('เช่น นายสมชาย ใจดี หรือ นางสาวสมหญิง รักเรียน')
        .setValue(`${member.first_name} ${member.last_name}`)
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const nicknameInput = new TextInputBuilder()
        .setCustomId('edit_nickname')
        .setLabel('ชื่อเล่น')
        .setValue(member.nickname)
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const classInput = new TextInputBuilder()
        .setCustomId('edit_class')
        .setLabel('ระดับชั้น (เช่น 6/7, 4/10 ไม่ต้องใส่ ม.)')
        .setPlaceholder('เช่น 6/7, 4/10, 5/2 (ห้ามใส่ ม.)')
        .setValue(cleanGradeClass(member.grade_class))
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const noInput = new TextInputBuilder()
        .setCustomId('edit_no')
        .setLabel('เลขที่')
        .setValue(String(member.student_no))
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const phoneInput = new TextInputBuilder()
        .setCustomId('edit_phone')
        .setLabel('เบอร์โทรศัพท์')
        .setValue(member.phone_number || '')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      editModal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(nicknameInput),
        new ActionRowBuilder().addComponents(classInput),
        new ActionRowBuilder().addComponents(noInput),
        new ActionRowBuilder().addComponents(phoneInput)
      );

      await interaction.showModal(editModal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_submit_edit_')) {
      await interaction.deferReply({ ephemeral: true });
      const memberId = interaction.customId.replace('modal_submit_edit_', '');

      const rawFullName = interaction.fields.getTextInputValue('edit_full_name').trim();
      const nickname = interaction.fields.getTextInputValue('edit_nickname').trim();
      const rawClass = interaction.fields.getTextInputValue('edit_class').trim();
      const studentNo = parseInt(interaction.fields.getTextInputValue('edit_no').trim(), 10) || 0;
      const phone = interaction.fields.getTextInputValue('edit_phone').trim();

      // 1. ตรวจสอบและจัดระเบียบคำนำหน้าชื่อจริง (ต้องมี นาย / นาง / นางสาว ติดกับชื่อจริงเลย)
      const cleanedFullName = cleanFullName(rawFullName);
      if (!/^(นาย|นางสาว|นาง|ด\.ช\.|ด\.ญ\.)/.test(cleanedFullName)) {
        await interaction.editReply({
          content: '❌ **ข้อมูลชื่อจริงไม่ถูกต้อง:** ต้องขึ้นต้นด้วยคำนำหน้า **นาย**, **นาง** หรือ **นางสาว** ติดกับชื่อจริงเลย\n*(ตัวอย่างที่ถูกต้อง: `นายสมชาย ใจดี` หรือ `นางสาวสมหญิง รักเรียน`)*'
        });
        return;
      }

      // 2. จัดรูปแบบระดับชั้น (ตัด "ม." ออก เอาเฉพาะ เลข/เลข เช่น 6/7, 4/10)
      const cleanedGradeClass = cleanGradeClass(rawClass);
      if (!cleanedGradeClass || !/^[1-6]\/[0-9]+$/.test(cleanedGradeClass)) {
        await interaction.editReply({
          content: '❌ **ข้อมูลระดับชั้นไม่ถูกต้อง:** กรุณาระบุเฉพาะเลขชั้น/ห้อง เช่น `6/7`, `4/10`, `5/2` *(ไม่ต้องใส่ "ม.")*'
        });
        return;
      }

      const nameParts = cleanedFullName.split(' ');
      const firstName = nameParts[0] || cleanedFullName;
      const lastName = nameParts.slice(1).join(' ') || '-';

      await supabase
        .from('members')
        .update({
          first_name: firstName,
          last_name: lastName,
          nickname: nickname,
          grade_class: cleanedGradeClass,
          student_no: studentNo,
          phone_number: phone,
          updated_at: new Date()
        })
        .eq('id', memberId);

      const { data: updatedMember } = await supabase.from('members').select('*').eq('id', memberId).single();

      if (updatedMember.discord_id) {
        try {
          const guildMember = await interaction.guild.members.fetch(updatedMember.discord_id).catch(() => null);
          if (guildMember && typeof guildMember.setNickname === 'function') {
            const newNickname = `[${updatedMember.duty_id || '-'}] ${updatedMember.nickname} (${updatedMember.first_name})`;
            await guildMember.setNickname(newNickname.slice(0, 32)).catch(() => {});
          }
        } catch (e) {}
      }

      await interaction.editReply({
        content: `อัปเดตข้อมูลแล้ว\nชื่อ: [${updatedMember.duty_id || '-'}] ${updatedMember.nickname} (${updatedMember.first_name} ${updatedMember.last_name})\nชั้น: ม.${updatedMember.grade_class} #${updatedMember.student_no}\nเบอร์: ${updatedMember.phone_number}`
      });
    }

    // 8. ระบบมอบหมายและแต่งตั้งตำแหน่ง (Leadership Appointment)
    if (interaction.isButton() && interaction.customId === 'btn_open_appoint_menu') {
      const isLeadership = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
                           (ROLE_IDS.ADMIN && interaction.member.roles.cache.has(ROLE_IDS.ADMIN)) ||
                           interaction.member.roles.cache.has(ROLE_IDS.PRESIDENT) ||
                           interaction.member.roles.cache.has(ROLE_IDS.VICE_PRESIDENT);

      if (!isLeadership) {
        await interaction.reply({
          content: '⛔ สงวนสิทธิ์เฉพาะประธานและผู้บริหารในการแต่งตั้งตำแหน่ง',
          ephemeral: true
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const { data: activeMembers } = await supabase
        .from('members')
        .select('*')
        .eq('status', 'ACTIVE')
        .order('duty_day')
        .order('duty_id');

      if (!activeMembers || activeMembers.length === 0) {
        await interaction.editReply({
          content: '⚠️ ยังไม่มีสมาชิกที่ได้รับการอนุมัติในระบบ'
        });
        return;
      }

      const memberSelect = new StringSelectMenuBuilder()
        .setCustomId('select_appoint_target_member')
        .setPlaceholder('🔍 เลือกสารวัตรที่ต้องการแต่งตั้งตำแหน่ง');

      activeMembers.slice(0, 25).forEach(m => {
        const dayText = getDayName(m.duty_day);
        const curRole = m.shift_role === 'SHIFT_HEAD' ? '👑 หัวหน้าเวร' : (m.shift_role === 'SHIFT_DEPUTY' ? '🎖️ รอง' : (m.role === 'PRESIDENT' ? '👑 ประธาน' : 'สมาชิก'));
        memberSelect.addOptions({
          label: `[${m.duty_id || '-'}] ${m.nickname} (${m.first_name} ${m.last_name})`,
          description: `${dayText} | ปัจจุบัน: ${curRole}`,
          value: m.id
        });
      });

      const row = new ActionRowBuilder().addComponents(memberSelect);
      await interaction.editReply({
        content: '👑 **เลือกสารวัตรที่ต้องการมอบหมายตำแหน่ง:**',
        components: [row]
      });
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_appoint_target_member') {
      const memberId = interaction.values[0];
      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).single();

      const roleMenu = new StringSelectMenuBuilder()
        .setCustomId(`select_role_promotion_${member.id}`)
        .setPlaceholder('👑 เลือกตำแหน่งที่ต้องการมอบหมาย')
        .addOptions([
          { label: '⚡ ผู้ดูแลระบบ (System Admin)', description: 'สิทธิ์ดูแลระบบสูงสุดและปรับเปลี่ยนในเว็บ', value: 'APPOINT_ADMIN', emoji: '⚡' },
          { label: '👨‍🏫 ครูที่ปรึกษา (Teacher Advisor)', description: 'ครูที่ปรึกษาฝ่ายสารวัตร สิทธิ์ดูข้อมูล/อนุมัติ', value: 'APPOINT_TEACHER', emoji: '👨‍🏫' },
          { label: '👑 ประธานสารวัตรนักเรียน', description: 'ผู้นำสูงสุดของฝ่ายสารวัตร', value: 'APPOINT_PRESIDENT', emoji: '👑' },
          { label: '🎖️ รองประธานสารวัตรนักเรียน', description: 'รองผู้นำฝ่ายสารวัตร', value: 'APPOINT_VICE_PRESIDENT', emoji: '🎖️' },
          { label: '⭐ หัวหน้าและรองหัวหน้าเวร (เลือกวัน)', description: 'แต่งตั้งหัวหน้าหรือรองหัวหน้าเวร (M, T, W, TH, F, S)', value: 'FLOW_SHIFT_LEADER', emoji: '⭐' },
          { label: '🛡️ สารวัตรนักเรียนทั่วไป', description: 'ปลดยศผู้นำกลับเป็นสมาชิกปกติ', value: 'DEMOTE_MEMBER', emoji: '🛡️' }
        ]);

      const row = new ActionRowBuilder().addComponents(roleMenu);
      await interaction.update({
        content: `👑 **แต่งตั้งตำแหน่งให้:** **[${member.duty_id || '-'}] ${member.nickname} (${member.first_name} ${member.last_name})**\nโปรดเลือกตำแหน่งด้านล่าง:`,
        components: [row]
      });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('btn_promote_')) {
      const memberId = interaction.customId.replace('btn_promote_', '');
      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).single();

      const isLeadership = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
                           (ROLE_IDS.ADMIN && interaction.member.roles.cache.has(ROLE_IDS.ADMIN)) ||
                           (ROLE_IDS.TEACHER && interaction.member.roles.cache.has(ROLE_IDS.TEACHER)) ||
                           interaction.member.roles.cache.has(ROLE_IDS.PRESIDENT) ||
                           interaction.member.roles.cache.has(ROLE_IDS.VICE_PRESIDENT);

      if (!isLeadership) {
        await interaction.reply({
          content: '⛔ สงวนสิทธิ์เฉพาะประธานและผู้บริหารในการแต่งตั้งตำแหน่ง',
          ephemeral: true
        });
        return;
      }

      const roleMenu = new StringSelectMenuBuilder()
        .setCustomId(`select_role_promotion_${member.id}`)
        .setPlaceholder('👑 เลือกตำแหน่งที่ต้องการมอบหมาย')
        .addOptions([
          { label: '⚡ ผู้ดูแลระบบ (System Admin)', description: 'สิทธิ์ดูแลระบบสูงสุดและปรับเปลี่ยนในเว็บ', value: 'APPOINT_ADMIN', emoji: '⚡' },
          { label: '👨‍🏫 ครูที่ปรึกษา (Teacher Advisor)', description: 'ครูที่ปรึกษาฝ่ายสารวัตร สิทธิ์ดูข้อมูล/อนุมัติ', value: 'APPOINT_TEACHER', emoji: '👨‍🏫' },
          { label: '👑 ประธานสารวัตรนักเรียน', description: 'ผู้นำสูงสุดของฝ่ายสารวัตร', value: 'APPOINT_PRESIDENT', emoji: '👑' },
          { label: '🎖️ รองประธานสารวัตรนักเรียน', description: 'รองผู้นำฝ่ายสารวัตร', value: 'APPOINT_VICE_PRESIDENT', emoji: '🎖️' },
          { label: '⭐ หัวหน้าและรองหัวหน้าเวร (เลือกวัน)', description: 'แต่งตั้งหัวหน้าหรือรองหัวหน้าเวร (M, T, W, TH, F, S)', value: 'FLOW_SHIFT_LEADER', emoji: '⭐' },
          { label: '🛡️ สารวัตรนักเรียนทั่วไป', description: 'ปลดยศผู้นำกลับเป็นสมาชิกปกติ', value: 'DEMOTE_MEMBER', emoji: '🛡️' }
        ]);

      const row = new ActionRowBuilder().addComponents(roleMenu);
      await interaction.reply({
        content: `👑 **แต่งตั้งตำแหน่งให้:** **[${member.duty_id || '-'}] ${member.nickname} (${member.first_name} ${member.last_name})**\nโปรดเลือกตำแหน่งด้านล่าง:`,
        components: [row],
        ephemeral: true
      });
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_role_promotion_')) {
      await interaction.deferUpdate();
      const memberId = interaction.customId.replace('select_role_promotion_', '');
      const action = interaction.values[0];

      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).single();
      if (!member) {
        await interaction.followUp({ content: '❌ ไม่พบข้อมูลสมาชิก', ephemeral: true });
        return;
      }

      // ขั้นที่ 2 ของโฟลว์หัวหน้าและรองหัวหน้า: แสดงเมนูให้เลือกวัน (M, T, W, TH, F, S)
      if (action === 'FLOW_SHIFT_LEADER') {
        const dayMenu = new StringSelectMenuBuilder()
          .setCustomId(`select_shift_day_appoint_${member.id}`)
          .setPlaceholder('📅 เลือกวันปฏิบัติหน้าที่ที่ต้องการแต่งตั้ง')
          .addOptions([
            { label: '🟡 เวรวันจันทร์ (Monday - M)', value: 'M', description: 'แต่งตั้งหัวหน้า/รอง ประจำวันจันทร์', emoji: '🟡' },
            { label: '🌸 เวรวันอังคาร (Tuesday - T)', value: 'T', description: 'แต่งตั้งหัวหน้า/รอง ประจำวันอังคาร', emoji: '🌸' },
            { label: '🟢 เวรวันพุธ (Wednesday - W)', value: 'W', description: 'แต่งตั้งหัวหน้า/รอง ประจำวันพุธ', emoji: '🟢' },
            { label: '🟠 เวรวันพฤหัสบดี (Thursday - TH/Ts)', value: 'Ts', description: 'แต่งตั้งหัวหน้า/รอง ประจำวันพฤหัสบดี', emoji: '🟠' },
            { label: '🔵 เวรวันศุกร์ (Friday - F)', value: 'F', description: 'แต่งตั้งหัวหน้า/รอง ประจำวันศุกร์', emoji: '🔵' },
            { label: '🟣 เวรพิเศษ (Special Duty - S)', value: 'S', description: 'แต่งตั้งหัวหน้า/รอง ประจำเวรพิเศษทุกวัน', emoji: '🟣' }
          ]);

        const rowMenu = new ActionRowBuilder().addComponents(dayMenu);
        const rowBack = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`btn_back_appoint_member_${member.id}`)
            .setLabel('↩️ ย้อนกลับ')
            .setStyle(ButtonStyle.Secondary)
        );

        await interaction.editReply({
          content: `👑 **แต่งตั้งหัวหน้าและรองหัวหน้าเวร:**\n` +
                   `👤 สารวัตร: **[${member.duty_id || '-'}] ${member.nickname} (${member.first_name} ${member.last_name})**\n` +
                   `👉 ขั้นที่ 1: โปรดเลือกวันปฏิบัติหน้าที่ (M, T, W, TH, F, S) ด้านล่าง:`,
          components: [rowMenu, rowBack]
        });
        return;
      }

      let newRole = member.role;
      let newShiftRole = member.shift_role;
      let roleTitle = '';
      let addRoleId = null;
      let removeRoleIds = [];

      const allHeadAndDeputyRoles = [
        ...Object.values(ROLE_IDS.HEADS || {}),
        ...Object.values(ROLE_IDS.DEPUTIES || {})
      ].filter(Boolean);

      if (action === 'APPOINT_ADMIN') {
        newRole = 'ADMIN';
        roleTitle = '⚡ ผู้ดูแลระบบ (System Admin)';
        addRoleId = ROLE_IDS.ADMIN;
        removeRoleIds = [ROLE_IDS.TEACHER, ROLE_IDS.PRESIDENT, ROLE_IDS.VICE_PRESIDENT, ...allHeadAndDeputyRoles].filter(Boolean);
      } else if (action === 'APPOINT_TEACHER') {
        newRole = 'TEACHER';
        newShiftRole = 'TEACHER';
        roleTitle = '👨‍🏫 ครูที่ปรึกษา (Teacher Advisor)';
        addRoleId = ROLE_IDS.TEACHER;
        removeRoleIds = [ROLE_IDS.ADMIN, ROLE_IDS.PRESIDENT, ROLE_IDS.VICE_PRESIDENT, ...allHeadAndDeputyRoles].filter(Boolean);
      } else if (action === 'APPOINT_PRESIDENT') {
        newRole = 'PRESIDENT';
        roleTitle = '👑 ประธานสารวัตรนักเรียน';
        addRoleId = ROLE_IDS.PRESIDENT;
        removeRoleIds = [ROLE_IDS.ADMIN, ROLE_IDS.TEACHER, ROLE_IDS.VICE_PRESIDENT, ...allHeadAndDeputyRoles].filter(Boolean);
      } else if (action === 'APPOINT_VICE_PRESIDENT') {
        newRole = 'VICE_PRESIDENT';
        roleTitle = '🎖️ รองประธานสารวัตรนักเรียน';
        addRoleId = ROLE_IDS.VICE_PRESIDENT;
        removeRoleIds = [ROLE_IDS.ADMIN, ROLE_IDS.TEACHER, ROLE_IDS.PRESIDENT, ...allHeadAndDeputyRoles].filter(Boolean);
      } else if (action === 'DEMOTE_MEMBER') {
        newRole = 'MEMBER';
        newShiftRole = 'MEMBER';
        roleTitle = '🛡️ สารวัตรนักเรียนทั่วไป';
        removeRoleIds = [
          ROLE_IDS.ADMIN,
          ROLE_IDS.TEACHER,
          ROLE_IDS.PRESIDENT,
          ROLE_IDS.VICE_PRESIDENT,
          ...allHeadAndDeputyRoles
        ].filter(Boolean);
      }

      await supabase
        .from('members')
        .update({
          role: newRole,
          shift_role: newShiftRole,
          updated_at: new Date()
        })
        .eq('id', memberId);

      if (member.discord_id) {
        try {
          const guildMember = await interaction.guild.members.fetch(member.discord_id).catch(() => null);
          if (guildMember) {
            if (action === 'APPOINT_TEACHER') {
              const teacherNick = `[ครูที่ปรึกษา] ${member.nickname} (${member.first_name})`.substring(0, 32);
              await guildMember.setNickname(teacherNick).catch(() => {});
            }
            if (addRoleId) await guildMember.roles.add(addRoleId).catch(() => {});
            for (const rid of removeRoleIds.filter(Boolean)) {
              await guildMember.roles.remove(rid).catch(() => {});
            }
          }
        } catch (e) {
          console.warn('Role update error:', e.message);
        }
      }

      await interaction.editReply({
        content: `✅ **แต่งตั้งแล้ว**\n👤 **ชื่อ:** [${member.duty_id || '-'}] ${member.nickname} (${member.first_name} ${member.last_name})\n🎖️ **ตำแหน่ง:** ${roleTitle}\n🛡️ **โดย:** <@${interaction.user.id}>`,
        components: []
      });

      const leaderChannel = interaction.guild.channels.cache.find(c => c.name.includes('ห้องประชุมหัวหน้า'));
      if (leaderChannel) {
        const logEmbed = new EmbedBuilder()
          .setTitle('👑 แต่งตั้งตำแหน่ง')
          .setDescription(
            `👤 **ชื่อ:** [${member.duty_id || '-'}] ${member.nickname} (${member.first_name} ${member.last_name}) <@${member.discord_id}>\n` +
            `🎖️ **ตำแหน่ง:** ${roleTitle}\n` +
            `🛡️ **ผู้แต่งตั้ง:** <@${interaction.user.id}>`
          )
          .setColor('#F1C40F')
          .setTimestamp();

        await leaderChannel.send({ embeds: [logEmbed] }).catch(() => {});
      }
      return;
    }

    // ขั้นที่ 3 ของโฟลว์หัวหน้าและรองหัวหน้า: เมื่อเลือกวันแล้ว ให้เลือกว่าจะเป็นหัวหน้า หรือ รองหัวหน้า
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_shift_day_appoint_')) {
      await interaction.deferUpdate();
      const memberId = interaction.customId.replace('select_shift_day_appoint_', '');
      const selectedDay = interaction.values[0];

      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).single();
      if (!member) {
        await interaction.followUp({ content: '❌ ไม่พบข้อมูลสมาชิก', ephemeral: true });
        return;
      }

      const dayName = getDayName(selectedDay);

      const chooseRoleRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`btn_confirm_appoint_${member.id}_${selectedDay}_SHIFT_HEAD`)
          .setLabel(`👑 หัวหน้าเวร (${dayName})`)
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`btn_confirm_appoint_${member.id}_${selectedDay}_SHIFT_DEPUTY`)
          .setLabel(`🎖️ รองหัวหน้าเวร (${dayName})`)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`btn_back_to_day_${member.id}`)
          .setLabel('↩️ เปลี่ยนวัน')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({
        content: `👑 **เลือกบทบาทผู้นำประจำ${dayName} (${selectedDay}):**\n` +
                 `👤 สำหรับ: **[${member.duty_id || '-'}] ${member.nickname} (${member.first_name} ${member.last_name})**\n` +
                 `👉 ขั้นที่ 2: โปรดเลือกว่าจะเป็น **หัวหน้าเวร** หรือ **รองหัวหน้าเวร**:`,
        components: [chooseRoleRow]
      });
      return;
    }

    // ปุ่มเปลี่ยนวันกลับไปขั้นที่ 1 ของการเลือกวัน
    if (interaction.isButton() && interaction.customId.startsWith('btn_back_to_day_')) {
      await interaction.deferUpdate();
      const memberId = interaction.customId.replace('btn_back_to_day_', '');
      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).single();

      const dayMenu = new StringSelectMenuBuilder()
        .setCustomId(`select_shift_day_appoint_${member.id}`)
        .setPlaceholder('📅 เลือกวันปฏิบัติหน้าที่ที่ต้องการแต่งตั้ง')
        .addOptions([
          { label: '🟡 เวรวันจันทร์ (Monday - M)', value: 'M', description: 'แต่งตั้งหัวหน้า/รอง ประจำวันจันทร์', emoji: '🟡' },
          { label: '🌸 เวรวันอังคาร (Tuesday - T)', value: 'T', description: 'แต่งตั้งหัวหน้า/รอง ประจำวันอังคาร', emoji: '🌸' },
          { label: '🟢 เวรวันพุธ (Wednesday - W)', value: 'W', description: 'แต่งตั้งหัวหน้า/รอง ประจำวันพุธ', emoji: '🟢' },
          { label: '🟠 เวรวันพฤหัสบดี (Thursday - TH/Ts)', value: 'Ts', description: 'แต่งตั้งหัวหน้า/รอง ประจำวันพฤหัสบดี', emoji: '🟠' },
          { label: '🔵 เวรวันศุกร์ (Friday - F)', value: 'F', description: 'แต่งตั้งหัวหน้า/รอง ประจำวันศุกร์', emoji: '🔵' },
          { label: '🟣 เวรพิเศษ (Special Duty - S)', value: 'S', description: 'แต่งตั้งหัวหน้า/รอง ประจำเวรพิเศษทุกวัน', emoji: '🟣' }
        ]);

      const rowMenu = new ActionRowBuilder().addComponents(dayMenu);
      const rowBack = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`btn_back_appoint_member_${member.id}`)
          .setLabel('↩️ ย้อนกลับ')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({
        content: `👑 **แต่งตั้งหัวหน้าและรองหัวหน้าเวร:**\n` +
                 `👤 สารวัตร: **[${member.duty_id || '-'}] ${member.nickname} (${member.first_name} ${member.last_name})**\n` +
                 `👉 ขั้นที่ 1: โปรดเลือกวันปฏิบัติหน้าที่ (M, T, W, TH, F, S) ด้านล่าง:`,
        components: [rowMenu, rowBack]
      });
      return;
    }

    // ปุ่มย้อนกลับไปเมนูเลือกตำแหน่งหลัก
    if (interaction.isButton() && interaction.customId.startsWith('btn_back_appoint_member_')) {
      await interaction.deferUpdate();
      const memberId = interaction.customId.replace('btn_back_appoint_member_', '');
      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).single();

      const roleMenu = new StringSelectMenuBuilder()
        .setCustomId(`select_role_promotion_${member.id}`)
        .setPlaceholder('👑 เลือกตำแหน่งที่ต้องการมอบหมาย')
        .addOptions([
          { label: '⚡ ผู้ดูแลระบบ (System Admin)', description: 'สิทธิ์ดูแลระบบสูงสุดและปรับเปลี่ยนในเว็บ', value: 'APPOINT_ADMIN', emoji: '⚡' },
          { label: '👨‍🏫 ครูที่ปรึกษา (Teacher Advisor)', description: 'ครูที่ปรึกษาฝ่ายสารวัตร สิทธิ์ดูข้อมูล/อนุมัติ', value: 'APPOINT_TEACHER', emoji: '👨‍🏫' },
          { label: '👑 ประธานสารวัตรนักเรียน', description: 'ผู้นำสูงสุดของฝ่ายสารวัตร', value: 'APPOINT_PRESIDENT', emoji: '👑' },
          { label: '🎖️ รองประธานสารวัตรนักเรียน', description: 'รองผู้นำฝ่ายสารวัตร', value: 'APPOINT_VICE_PRESIDENT', emoji: '🎖️' },
          { label: '⭐ หัวหน้าและรองหัวหน้าเวร (เลือกวัน)', description: 'แต่งตั้งหัวหน้าหรือรองหัวหน้าเวร (M, T, W, TH, F, S)', value: 'FLOW_SHIFT_LEADER', emoji: '⭐' },
          { label: '🛡️ สารวัตรนักเรียนทั่วไป', description: 'ปลดยศผู้นำกลับเป็นสมาชิกปกติ', value: 'DEMOTE_MEMBER', emoji: '🛡️' }
        ]);

      const row = new ActionRowBuilder().addComponents(roleMenu);
      await interaction.editReply({
        content: `👑 **แต่งตั้งตำแหน่งให้:** **[${member.duty_id || '-'}] ${member.nickname} (${member.first_name} ${member.last_name})**\nโปรดเลือกตำแหน่งด้านล่าง:`,
        components: [row]
      });
      return;
    }

    // ขั้นที่ 4: ยืนยันการแต่งตั้งหัวหน้าเวร หรือ รองหัวหน้าเวร
    if (interaction.isButton() && interaction.customId.startsWith('btn_confirm_appoint_')) {
      await interaction.deferUpdate();
      const raw = interaction.customId.replace('btn_confirm_appoint_', '');
      const parts = raw.split('_');
      const roleType = parts.slice(-2).join('_'); // 'SHIFT_HEAD' or 'SHIFT_DEPUTY'
      const selectedDay = parts[parts.length - 3];
      const memberId = parts.slice(0, parts.length - 3).join('_');

      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).single();
      if (!member) {
        await interaction.followUp({ content: '❌ ไม่พบข้อมูลสมาชิกในระบบ', ephemeral: true });
        return;
      }

      const isHead = roleType === 'SHIFT_HEAD';
      const dayName = getDayName(selectedDay);
      const roleTitle = isHead ? `👑 หัวหน้าเวร (${dayName})` : `🎖️ รองหัวหน้าเวร (${dayName})`;
      const addRoleId = isHead ? ROLE_IDS.HEADS[selectedDay] : ROLE_IDS.DEPUTIES[selectedDay];

      const newDutyDay = resolveDutyDayForAppoint(member.duty_day, selectedDay);
      const validDayRoles = getDutyRoles(newDutyDay);
      const allDayRoles = Object.values(ROLE_IDS.DAYS || {}).filter(Boolean);
      const obsoleteDayRoles = allDayRoles.filter(rid => !validDayRoles.includes(rid));

      const allHeadAndDeputyRoles = [
        ...Object.values(ROLE_IDS.HEADS || {}),
        ...Object.values(ROLE_IDS.DEPUTIES || {})
      ].filter(Boolean);
      const obsoleteLeadershipRoles = allHeadAndDeputyRoles.filter(rid => rid !== addRoleId);

      const rolesToAdd = [addRoleId, ...validDayRoles].filter(Boolean);
      const removeRoleIds = [...obsoleteLeadershipRoles, ...obsoleteDayRoles].filter(Boolean);

      await supabase
        .from('members')
        .update({
          shift_role: roleType,
          duty_day: newDutyDay,
          updated_at: new Date()
        })
        .eq('id', memberId);

      if (member.discord_id) {
        try {
          const guildMember = await interaction.guild.members.fetch(member.discord_id).catch(() => null);
          if (guildMember) {
            for (const rid of rolesToAdd) {
              await guildMember.roles.add(rid).catch(() => {});
            }
            for (const rid of removeRoleIds) {
              await guildMember.roles.remove(rid).catch(() => {});
            }
          }
        } catch (e) {
          console.warn('Role update error:', e.message);
        }
      }

      await interaction.editReply({
        content: `✅ **แต่งตั้งตำแหน่งเรียบร้อยแล้ว**\n` +
                 `👤 **ชื่อ:** [${member.duty_id || '-'}] ${member.nickname} (${member.first_name} ${member.last_name})\n` +
                 `🎖️ **ตำแหน่ง:** ${roleTitle}\n` +
                 `📅 **เวรปฏิบัติหน้าที่:** ${getDayName(newDutyDay)} (${newDutyDay})\n` +
                 `🛡️ **ผู้แต่งตั้ง:** <@${interaction.user.id}>`,
        components: []
      });

      const leaderChannel = interaction.guild.channels.cache.find(c => c.name.includes('ห้องประชุมหัวหน้า'));
      if (leaderChannel) {
        const logEmbed = new EmbedBuilder()
          .setTitle('👑 แต่งตั้งตำแหน่งผู้นำเวร')
          .setDescription(
            `👤 **ชื่อ:** [${member.duty_id || '-'}] ${member.nickname} (${member.first_name} ${member.last_name}) <@${member.discord_id}>\n` +
            `🎖️ **ตำแหน่ง:** ${roleTitle}\n` +
            `📅 **เวรปฏิบัติหน้าที่:** ${getDayName(newDutyDay)} (${newDutyDay})\n` +
            `🛡️ **ผู้แต่งตั้ง:** <@${interaction.user.id}>`
          )
          .setColor(isHead ? '#F1C40F' : '#3498DB')
          .setTimestamp();

        await leaderChannel.send({ embeds: [logEmbed] }).catch(() => {});
      }
      return;
    }

    // 9. ระบบปลดหน้าที่ / ถอดยศ / ปลดพ้นสภาพสารวัตร (Demote & Dismiss System)
    if (interaction.isButton() && (interaction.customId === 'btn_open_demote_menu' || interaction.customId === 'btn_open_remove_member_menu')) {
      const isLeadership = interaction.member?.permissions.has(PermissionsBitField.Flags.Administrator) ||
                           (ROLE_IDS.ADMIN && interaction.member?.roles.cache.has(ROLE_IDS.ADMIN)) ||
                           interaction.member?.roles.cache.has(ROLE_IDS.PRESIDENT) ||
                           interaction.member?.roles.cache.has(ROLE_IDS.VICE_PRESIDENT) ||
                           interaction.guild?.ownerId === interaction.user.id;

      if (!isLeadership) {
        await interaction.reply({
          content: '⛔ สงวนสิทธิ์เฉพาะผู้บริหาร, ประธาน และรองประธานสารวัตรเท่านั้นในการสั่งการปลดหน้าที่',
          ephemeral: true
        });
        return;
      }

      await handleOpenDemoteMenu(interaction);
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_demote_target_member') {
      const memberId = interaction.values[0];
      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).single();
      if (!member) {
        await interaction.update({ content: '❌ ไม่พบข้อมูลสมาชิก', embeds: [], components: [] });
        return;
      }
      return await renderDemoteLevelSelection(interaction, member);
    }

    // เลือกระดับ 1: ปลดตำแหน่งผู้นำ
    if (interaction.isButton() && interaction.customId.startsWith('btn_demote_level_1_')) {
      const memberId = interaction.customId.replace('btn_demote_level_1_', '');
      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).single();
      if (!member) {
        await interaction.update({ content: '❌ ไม่พบข้อมูลสมาชิก', embeds: [], components: [] });
        return;
      }

      const curRoleText = member.role === 'ADMIN' ? '⚡ ผู้ดูแลระบบ (System Admin)' :
                          member.role === 'PRESIDENT' ? '👑 ประธานสารวัตร' :
                          member.role === 'VICE_PRESIDENT' ? '🎖️ รองประธานสารวัตร' :
                          member.shift_role === 'SHIFT_HEAD' ? '👑 หัวหน้าเวร' :
                          member.shift_role === 'SHIFT_DEPUTY' ? '🎖️ รองหัวหน้าเวร' : 'ผู้นำ';

      const confirmEmbed = new EmbedBuilder()
        .setTitle('⚠️ ยืนยันการปลดตำแหน่งผู้นำ (ระดับ 1)')
        .setDescription(
          `คุณกำลังจะปลดตำแหน่งผู้นำของ **[${member.duty_id || '-'}] ${member.nickname} (${member.first_name} ${member.last_name})**:\n\n` +
          `• 🎖️ **ตำแหน่งเดิม:** ${curRoleText}\n` +
          `• 🔻 **ผลการปลด:** ปรับยศกลับเป็น **"สารวัตรนักเรียนทั่วไป (MEMBER)"**\n` +
          `• 🛡️ **ยศ Discord:** ถอดยศประธาน / รองประธาน / หัวหน้าเวร / รองหัวหน้าเวร ออก\n` +
          `• ✅ **สิ่งที่คงเดิม:** ยังคงเป็นสารวัตรนักเรียน, คงรหัสเวร \`[${member.duty_id || '-'}]\`, และเข้าเวรผลัดเดิมตามปกติ\n` +
          `• 📋 **การบันทึก:** บันทึกประวัติลงห้อง #log อัตโนมัติ (ไม่มีการส่ง DM แจ้งเตือน)\n\n` +
          `**หากต้องการดำเนินการต่อ โปรดยืนยันด้านล่าง**`
        )
        .setColor('#E67E22')
        .setFooter({ text: 'SARAWAT Demote System • ระดับ 1 ปลดตำแหน่งผู้นำ' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`btn_confirm_demote_LEADER_${member.id}`)
          .setLabel('⚠️ ยืนยันปลดตำแหน่งผู้นำ')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('btn_cancel_demote')
          .setLabel('❌ ยกเลิก')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.update({
        embeds: [confirmEmbed],
        components: [row]
      });
      return;
    }

    // เลือกระดับ 2: ปลดพ้นสภาพสารวัตร (ถอดถอน/คืนรหัส)
    if (interaction.isButton() && interaction.customId.startsWith('btn_demote_level_2_')) {
      const memberId = interaction.customId.replace('btn_demote_level_2_', '');
      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).single();
      if (!member) {
        await interaction.update({ content: '❌ ไม่พบข้อมูลสมาชิก', embeds: [], components: [] });
        return;
      }

      const confirmEmbed = new EmbedBuilder()
        .setTitle('🚨 ยืนยันการปลดพ้นสภาพสารวัตร (ระดับ 2 - DESTRUCTIVE)')
        .setDescription(
          `⚠️ **คำเตือนความปลอดภัย (ปลดถาวร/คืนรหัสเวร)**\n\n` +
          `คุณกำลังจะปลดพ้นสภาพสารวัตรของ **[${member.duty_id || '-'}] ${member.nickname} (${member.first_name} ${member.last_name})**:\n\n` +
          `• 🚫 **ผลการปลด:** พ้นสภาพจากการเป็นสารวัตรนักเรียน (\`status: INACTIVE\`)\n` +
          `• 🔄 **รหัสเวร:** ปลดและคืนรหัสเวร \`[${member.duty_id || '-'}]\` กลับสู่ระบบเป็นสล็อตว่าง\n` +
          `• 🛡️ **ยศ Discord:** ถอดยศสารวัตรทั้งหมด (ยศยืนยัน, ยศผลัดเวร, ยศผู้นำ) และรีเซ็ตชื่อเล่น\n` +
          `• 📋 **การบันทึก:** บันทึกประวัติลงห้อง #log อัตโนมัติ (ไม่มีการส่ง DM แจ้งเตือน)\n\n` +
          `**หากแน่ใจ ให้กดปุ่มยืนยันด้านล่างเพื่อดำเนินการทันที**`
        )
        .setColor('#C0392B')
        .setFooter({ text: 'SARAWAT Demote System • ระดับ 2 ปลดพ้นสภาพ' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`btn_confirm_demote_DISMISS_${member.id}`)
          .setLabel('🚨 ยืนยันปลดพ้นสภาพสารวัตร')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('btn_cancel_demote')
          .setLabel('❌ ยกเลิก')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.update({
        embeds: [confirmEmbed],
        components: [row]
      });
      return;
    }

    // ยืนยันปลดระดับ 1: ผู้นำ -> สมาชิกทั่วไป
    if (interaction.isButton() && interaction.customId.startsWith('btn_confirm_demote_LEADER_')) {
      await interaction.deferUpdate();
      const memberId = interaction.customId.replace('btn_confirm_demote_LEADER_', '');

      try {
        const { member } = await executeDemoteLeader(memberId, interaction.user.id, interaction.guild);

        const successEmbed = new EmbedBuilder()
          .setTitle('✅ ปลดตำแหน่งผู้นำสำเร็จ')
          .setDescription(
            `ดำเนินการปลดตำแหน่งผู้นำเรียบร้อยแล้ว:\n\n` +
            `• 👤 **สารวัตร:** [${member.duty_id || '-'}] ${member.nickname} (${member.first_name} ${member.last_name})\n` +
            `• 🛡️ **ตำแหน่งใหม่:** สารวัตรนักเรียนทั่วไป (MEMBER)\n` +
            `• 📅 **ผลัดเวร:** ${getDayName(member.duty_day)} (ยังคงปฏิบัติหน้าที่ตามปกติ)\n` +
            `• 👮 **ผู้ดำเนินการ:** <@${interaction.user.id}>\n\n` +
            `*(บันทึกข้อมูลลงระบบและแจ้งเตือนในห้อง #log เรียบร้อยแล้ว)*`
          )
          .setColor('#2ECC71')
          .setTimestamp();

        await interaction.editReply({
          embeds: [successEmbed],
          components: []
        });
      } catch (err) {
        await interaction.editReply({
          content: `❌ เกิดข้อผิดพลาดในการปลดตำแหน่ง: ${err.message}`,
          embeds: [],
          components: []
        });
      }
      return;
    }

    // ยืนยันปลดระดับ 2: พ้นสภาพสารวัตร คืนรหัสเวร
    if (interaction.isButton() && (interaction.customId.startsWith('btn_confirm_demote_DISMISS_') || interaction.customId.startsWith('btn_confirm_remove_'))) {
      await interaction.deferUpdate();
      const memberId = interaction.customId.startsWith('btn_confirm_demote_DISMISS_')
        ? interaction.customId.replace('btn_confirm_demote_DISMISS_', '')
        : interaction.customId.replace('btn_confirm_remove_', '');

      try {
        const { member, freedDutyId } = await executeDismissMember(memberId, interaction.user.id, interaction.guild);

        const successEmbed = new EmbedBuilder()
          .setTitle('✅ ปลดพ้นสภาพสารวัตรสำเร็จ')
          .setDescription(
            `ดำเนินการปลดพ้นสภาพสารวัตรนักเรียนเรียบร้อยแล้ว:\n\n` +
            `• 👤 **ชื่อ-สกุล:** ${member.first_name} ${member.last_name} (${member.nickname})\n` +
            `• 🚫 **สถานะ:** พ้นสภาพสารวัตร (\`INACTIVE\`)\n` +
            `• 🔄 **คืนรหัสเวร:** \`[${freedDutyId || '-'}]\` สู่ระบบ (พร้อมจัดสรรใหม่)\n` +
            `• 🛡️ **ยศ Discord:** ถอดยศสารวัตรและรีเซ็ตชื่อเล่นแล้ว\n` +
            `• 👮 **ผู้ดำเนินการ:** <@${interaction.user.id}>\n\n` +
            `*(บันทึกข้อมูลลงระบบและแจ้งเตือนในห้อง #log เรียบร้อยแล้ว)*`
          )
          .setColor('#2ECC71')
          .setTimestamp();

        await interaction.editReply({
          embeds: [successEmbed],
          components: []
        });
      } catch (err) {
        await interaction.editReply({
          content: `❌ เกิดข้อผิดพลาดในการปลดพ้นสภาพ: ${err.message}`,
          embeds: [],
          components: []
        });
      }
      return;
    }

    // ยกเลิกการปลดหน้าที่
    if (interaction.isButton() && (interaction.customId === 'btn_cancel_demote' || interaction.customId === 'btn_cancel_remove')) {
      await interaction.update({
        content: '❌ **ยกเลิกการปลดหน้าที่เรียบร้อยแล้ว** ไม่มีการเปลี่ยนแปลงข้อมูลหรือยศใดๆ',
        embeds: [],
        components: []
      });
      return;
    }

    // 10. จัดการคดีแจ้งเหตุ (มอบหมายเวร / ปิดคดี)
    if (interaction.isButton() && interaction.customId.startsWith('btn_assign_case_')) {
      const caseId = interaction.customId.replace('btn_assign_case_', '');
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`select_assign_case_${caseId}`)
        .setPlaceholder('เลือกเวรที่ต้องการมอบหมาย')
        .addOptions([
          { label: 'วันจันทร์ (M)', value: 'M', emoji: '🔵' },
          { label: 'วันอังคาร (T)', value: 'T', emoji: '🟣' },
          { label: 'วันพุธ (W)', value: 'W', emoji: '🟢' },
          { label: 'วันพฤหัสบดี (Ts)', value: 'Ts', emoji: '🟠' },
          { label: 'วันศุกร์ (F)', value: 'F', emoji: '🔴' },
          { label: 'เวรพิเศษทุกวัน (S)', value: 'S', emoji: '⭐' }
        ]);

      const row = new ActionRowBuilder().addComponents(selectMenu);
      await interaction.reply({
        content: `มอบหมายคดี **${caseId}** ให้เวรรับผิดชอบ:`,
        components: [row],
        ephemeral: true
      });
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_assign_case_')) {
      const caseId = interaction.customId.replace('select_assign_case_', '');
      const selectedDay = interaction.values[0];
      const dayText = getDayName(selectedDay);

      await supabase.from('cases').update({
        assigned_duty_day: selectedDay,
        status: 'INVESTIGATING'
      }).eq('case_id', caseId);

      await interaction.update({
        content: `มอบหมายคดี ${caseId} ให้ **${dayText}** แล้ว`,
        components: []
      });

      if (interaction.message && interaction.message.embeds.length > 0) {
        const oldEmbed = interaction.message.embeds[0];
        const newEmbed = EmbedBuilder.from(oldEmbed).setColor('#F39C12');
        let desc = newEmbed.data.description || '';
        desc = desc.replace(/สถานะ: .*/g, `สถานะ: 🔍 กำลังตรวจสอบ (${dayText})`);
        newEmbed.setDescription(desc);
        await interaction.message.edit({ embeds: [newEmbed] }).catch(() => {});
      }
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('btn_close_case_')) {
      const caseId = interaction.customId.replace('btn_close_case_', '');

      const modal = new ModalBuilder()
        .setCustomId(`modal_close_case_${caseId}`)
        .setTitle(`ปิดคดี ${caseId}`)
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('resolution_notes')
              .setLabel('บันทึกผลการตรวจสอบ / การดำเนินการ')
              .setStyle(TextInputStyle.Paragraph)
              .setPlaceholder('ระบุผลการลงพื้นที่ หรือบทลงโทษ...')
              .setRequired(true)
          )
        );

      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_close_case_')) {
      const caseId = interaction.customId.replace('modal_close_case_', '');
      const notes = interaction.fields.getTextInputValue('resolution_notes');

      await supabase.from('cases').update({
        status: 'RESOLVED',
        resolution_notes: notes
      }).eq('case_id', caseId);

      await interaction.reply({
        content: `ปิดคดี **${caseId}** แล้ว\nบันทึก: ${notes}`,
        ephemeral: true
      });

      if (interaction.message && interaction.message.embeds.length > 0) {
        const oldEmbed = interaction.message.embeds[0];
        const newEmbed = EmbedBuilder.from(oldEmbed).setColor('#2ECC71');
        let desc = newEmbed.data.description || '';
        desc = desc.replace(/สถานะ: .*/g, `สถานะ: ✅ ปิดคดีแล้ว\nบันทึก: ${notes}`);
        newEmbed.setDescription(desc);
        await interaction.message.edit({ embeds: [newEmbed], components: [] }).catch(() => {});
      }
      return;
    }

  } catch (error) {
    if (error.code === 10062 || error.code === 40060) {
      console.warn(`[Interaction Ignored] Discord interaction expired or acknowledged: code=${error.code} (${error.message})`);
      return;
    }
    console.error('Interaction error:', error);
    try {
      const errMsg = error?.message || 'ดำเนินการไม่สำเร็จ';
      if (interaction.deferred) {
        await interaction.editReply({ content: `⚠️ ข้อผิดพลาด: ${errMsg}` }).catch(() => {});
      } else if (!interaction.replied) {
        await interaction.reply({ content: `⚠️ ข้อผิดพลาด: ${errMsg}`, ephemeral: true }).catch(() => {});
      }
    } catch (e) {
      // ป้องกัน secondary error crash
    }
  }
});

async function showDutySelection(interaction, memberId, nickname, fullName) {
  const daySelectMenu = new StringSelectMenuBuilder()
    .setCustomId(`select_duty_day_${memberId}`)
    .setPlaceholder('📅 เลือกวันเวรหลักของคุณ (จันทร์ - ศุกร์)')
    .addOptions([
      { label: 'วันจันทร์ (Monday - M)', value: 'M', description: 'ปฏิบัติหน้าที่เวรประจำวันจันทร์', emoji: '🔵' },
      { label: 'วันอังคาร (Tuesday - T)', value: 'T', description: 'ปฏิบัติหน้าที่เวรประจำวันอังคาร', emoji: '🟣' },
      { label: 'วันพุธ (Wednesday - W)', value: 'W', description: 'ปฏิบัติหน้าที่เวรประจำวันพุธ', emoji: '🟢' },
      { label: 'วันพฤหัสบดี (Thursday - Ts)', value: 'Ts', description: 'ปฏิบัติหน้าที่เวรประจำวันพฤหัสบดี', emoji: '🟠' },
      { label: 'วันศุกร์ (Friday - F)', value: 'F', description: 'ปฏิบัติหน้าที่เวรประจำวันศุกร์', emoji: '🔴' }
    ]);

  const row = new ActionRowBuilder().addComponents(daySelectMenu);
  const cancelRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_start_verify')
      .setLabel('↩️ ย้อนกลับไปกรอกข้อมูลใหม่')
      .setStyle(ButtonStyle.Secondary)
  );

  const embed = new EmbedBuilder()
    .setTitle('📅 [ขั้นตอนที่ 2/3] เลือกรอบเวรปฏิบัติหน้าที่')
    .setColor('#F39C12')
    .setDescription(
      `👤 **สารวัตร:** ${fullName} (**${nickname}**)\n\n` +
      `โปรดเลือกวันเวรหลักประจำสัปดาห์ของคุณจากเมนูด้านล่าง:\n` +
      `*(สามารถเลือกเป็นเวรพิเศษปฏิบัติหน้าที่ทุกวันได้ในขั้นตอนถัดไป)*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🔹 **สถานะขั้นตอน:** 🟩🟩⬜ (ขั้นตอนที่ 2 จาก 3)`
    );

  const payload = { embeds: [embed], components: [row, cancelRow], content: null };

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
  } else if (interaction.isModalSubmit()) {
    await interaction.reply({ ...payload, ephemeral: true });
  } else {
    await interaction.update(payload);
  }
}

async function getNextAvailableDutyId(supabase, dutyDayPrefix) {
  const prefix = dutyDayPrefix || 'M';
  const { data } = await supabase
    .from('members')
    .select('duty_id')
    .eq('duty_day', prefix)
    .eq('status', 'ACTIVE');

  const occupiedNumbers = new Set(
    (data || [])
      .map(row => parseInt(row.duty_id?.replace(prefix, ''), 10))
      .filter(num => !isNaN(num))
  );

  let candidate = 1;
  while (occupiedNumbers.has(candidate)) {
    candidate++;
  }
  return `${prefix}${candidate}`;
}

// ==========================================================
// 📄 ATTENDANCE SHEET HELPER FUNCTIONS
// ==========================================================
let cachedSarawatLogoBase64 = null;
function getSarawatLogoBase64() {
  if (cachedSarawatLogoBase64) return cachedSarawatLogoBase64;
  const candidates = [
    path.join(__dirname, 'assets', 'logo_sm.jpg'),
    path.join(__dirname, 'web', 'public', 'assets', 'logo_sm.jpg'),
    path.join(__dirname, '..', 'assets', 'logo_sm.jpg'),
    path.join(__dirname, '..', 'web', 'public', 'assets', 'logo_sm.jpg'),
    path.join(__dirname, 'assets', 'logo.jpg'),
    path.join(__dirname, 'web', 'public', 'assets', 'logo.jpg'),
    path.join(__dirname, '..', 'web', 'public', 'assets', 'logo.jpg'),
    path.join(__dirname, '..', 'assets', 'logo.jpg')
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        cachedSarawatLogoBase64 = `data:image/jpeg;base64,${fs.readFileSync(p).toString('base64')}`;
        return cachedSarawatLogoBase64;
      } catch (e) {}
    }
  }
  return '';
}

/**
 * ⚡ สร้าง QR Code เวกเตอร์ SVG ขนาด 20mm ฝังในไฟล์ HTML โดยตรง (ทำงานออฟไลน์ 100% ไม่ต้องใช้อินเทอร์เน็ต)
 */
function generateQRCodeSVG(text, sizeMm = 20) {
  try {
    const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
    const size = qr.modules.size;
    let path = '';
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (qr.modules.get(r, c)) {
          path += `M${c},${r}h1v1h-1z `;
        }
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${sizeMm}mm" height="${sizeMm}mm" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#ffffff"/><path fill="#000000" d="${path}"/></svg>`;
  } catch (err) {
    console.error('[QR-SVG-ERR]', err);
    return `<div style="width:${sizeMm}mm;height:${sizeMm}mm;border:1px solid #000;display:flex;align-items:center;justify-content:center;font-size:7pt;">QR ERR</div>`;
  }
}

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

function getAttendanceDates(dayCode, count = 12, qNumber = null, acadYear = null) {
  const period = getAcademicPeriod();
  const q = qNumber || period.quarter || 1;
  const y = acadYear || period.academicYear || 2569;
  const ceYear = y - 543;

  const dayIndexMap = { 'M': 0, 'T': 1, 'W': 2, 'Ts': 3, 'F': 4, 'S': 0 };
  const baseDay = dayCode === 'TSS' ? 'Ts' : (dayCode.replace(/S+$/, '') || 'M');
  const offsetDays = dayIndexMap[baseDay] ?? 0;

  let baseMonday;
  if (q === 1) {
    baseMonday = new Date(ceYear, 10, 9); // เช่น 11/9 สำหรับ 2026
  } else if (q === 2) {
    baseMonday = new Date(new Date(ceYear, 10, 9).getTime() + 12 * 7 * 86400000);
  } else if (q === 3) {
    baseMonday = new Date(ceYear, 4, 18);
  } else {
    baseMonday = new Date(new Date(ceYear, 4, 18).getTime() + 12 * 7 * 86400000);
  }

  const start = new Date(baseMonday.getTime() + offsetDays * 86400000);
  const dates = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(start.getTime() + (i * 7) * 86400000);
    dates.push(`${d.getMonth() + 1}/${d.getDate()}`);
  }
  return dates;
}

// ฟังก์ชันสร้างหน้าเว็บใบเช็คชื่อ A4 มาตรฐาน พร้อมระบุชื่อหัวหน้า/รองหัวหน้าบนหัวกระดาษ (OMR + Vision Anchor ฉบับปรับปรุง 11 ข้อ)
function generateAttendanceSheetHTML(dayCode, dayName, members) {
  const period = getAcademicPeriod();
  const head = members.find(m => m.shift_role === 'SHIFT_HEAD');
  const deputy = members.find(m => m.shift_role === 'SHIFT_DEPUTY');

  const headText = head ? `[${head.duty_id || '-'}] ${head.nickname || '-'} (${head.first_name || ''} ${head.last_name || ''})` : 'ยังไม่ได้แต่งตั้ง';
  const deputyText = deputy ? `[${deputy.duty_id || '-'}] ${deputy.nickname || '-'} (${deputy.first_name || ''} ${deputy.last_name || ''})` : 'ยังไม่ได้แต่งตั้ง';
  const logoBase64 = getSarawatLogoBase64();
  const englishDay = getEnglishDayName(dayCode);
  const isSpecial = dayCode === 'S';
  const dates = getAttendanceDates(dayCode, 12, period.quarter, period.academicYear);

  const tableColspanHeader = isSpecial 
    ? 'บันทึกการมาปฏิบัติหน้าที่ (สัปดาห์ที่ 1 ถึง 12)' 
    : 'บันทึกการมาปฏิบัติหน้าที่ (เดือน/วัน)';
  const dateHeaders = dates.map((d, idx) => 
    `<th class="date-header" style="width: 12.5mm; font-size: 7.5pt; font-weight: 700;" title="สัปดาห์ที่ ${idx + 1}: ${d}">${d}</th>`
  ).join('');

  let rows = '';
  if (members.length > 0) {
    rows = members.map(m => {
      const roleTag = m.shift_role === 'SHIFT_HEAD' 
        ? ' <span style="color: #b91c1c; font-weight: bold; font-size: 7.5pt;">(หัวหน้า)</span>' 
        : (m.shift_role === 'SHIFT_DEPUTY' ? ' <span style="color: #0284c7; font-weight: bold; font-size: 7.5pt;">(รอง)</span>' : '');

      const dateCells = dates.map((dStr, wIdx) => `
        <td style="width: 12.5mm; height: 8mm; padding: 0; text-align: center; vertical-align: middle;">
          <div class="omr-circle" data-duty="${m.duty_id || ''}" data-col="${wIdx}" onclick="this.classList.toggle('marked-present')" title="${m.duty_id || ''} วันที่ ${dStr}: ฝนดำเมื่อมาปฏิบัติหน้าที่ (ม)">
            ม
          </div>
        </td>
      `).join('');

      return `
        <tr style="height: 8mm;">
          <td style="font-size: 8pt; font-weight: 600; text-align: center;">${m.grade_class || '-'} (${m.student_no || '-'})` + '</td>' + `
          <td style="font-weight: 700; color: #1a5276; white-space: nowrap; text-align: center;">${m.nickname || '-'}${roleTag}</td>
          <td style="text-align: left; padding-left: 3mm; white-space: nowrap;">${m.first_name || ''} ${m.last_name || ''}</td>
          <td style="font-weight: 700; color: #d97706; font-size: 8.5pt; text-align: center;">${m.duty_id || '-'}</td>
          ${dateCells}
          <td style="font-size: 7.5pt; color: #64748b; text-align: center;">${m.post || '-'}</td>
        </tr>
      `;
    }).join('');
  } else {
    const emptyCells = dates.map(() => `
      <td style="width: 12.5mm; height: 8mm; padding: 0; text-align: center; color: #cbd5e1; font-size: 8pt; vertical-align: middle;">-</td>
    `).join('');
    rows = Array.from({ length: 3 }).map(() => `
      <tr style="height: 8mm;">
        <td style="text-align: center; color: #94a3b8;">-</td>
        <td style="text-align: center; color: #94a3b8;">-</td>
        <td style="text-align: center; color: #94a3b8;">(ว่าง)</td>
        <td style="text-align: center; color: #94a3b8;">-</td>
        ${emptyCells}
        <td style="text-align: center; color: #94a3b8;">-</td>
      </tr>
    `).join('');
  }

  const qrPayload = `${getWebDashboardUrl()}/attendance-sheet?shift=${dayCode}&q=${period.quarter}&year=${period.academicYear}`;
  const qrSvg = generateQRCodeSVG(qrPayload, 20);

  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <title>ใบเช็คชื่อ - ${dayName} (${dayCode})</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Sarabun:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400&display=swap" rel="stylesheet">
  <style>
    @page {
      size: A4 landscape;
      margin: 6mm 8mm;
    }
    * {
      box-sizing: border-box !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      font-family: 'Sarabun', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      margin: 0;
      padding: 10px;
      color: #0f172a;
      font-size: 13px;
      background: #f1f5f9;
    }
    .sheet-page {
      width: 281mm;
      height: 196mm;
      min-height: 196mm;
      max-height: 196mm;
      padding: 4mm 5mm;
      margin: 0 auto;
      background: #ffffff;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
      border-radius: 4px;
      position: relative;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      page-break-after: always;
      break-after: page;
      page-break-inside: avoid;
      break-inside: avoid;
      overflow: hidden;
    }

    /* 4 Corner Fiducial Markers: 8mm Solid Squares with TL orientation white dot */
    .fiducial-marker {
      position: absolute;
      width: 8mm;
      height: 8mm;
      background: #000000;
      pointer-events: none;
      box-sizing: border-box;
      z-index: 20;
    }
    .fiducial-tl { top: 4mm; left: 4mm; }
    .fiducial-tl::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      width: 2.6mm;
      height: 2.6mm;
      background: #ffffff;
      border-radius: 50%;
      transform: translate(-50%, -50%);
    }
    .fiducial-tr { top: 4mm; right: 4mm; }
    .fiducial-bl { bottom: 4mm; left: 4mm; }
    .fiducial-br { bottom: 4mm; right: 4mm; }

    /* ป้ายเวรประจำวัน (เว้นระยะปลอดภัย ไม่ทับหมุดมุมขวาบน 8mm) */
    .sheet-corner-tag {
      position: absolute;
      top: 4.5mm;
      right: 18mm;
      text-align: right;
      border: 1.5px solid #1a5276;
      border-radius: 4px;
      padding: 2px 8px;
      background-color: #f8fafc;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      line-height: 1.1;
      z-index: 10;
    }
    .sheet-corner-tag .tag-english {
      font-size: 13pt;
      font-weight: 700;
      color: #1a5276;
      letter-spacing: 0.5px;
    }
    .sheet-corner-tag .tag-code {
      font-size: 8.5pt;
      font-weight: 700;
      color: #d35400;
    }

    /* โลโก้สารวัตรแบบฝังเดี่ยวใน CSS ครั้งเดียว ไม่ซ้ำซ้อน 5 ชุด */
    .sarawat-logo-mark {
      width: 13mm;
      height: 13mm;
      border-radius: 50%;
      border: 1px solid #1a5276;
      background-image: url('${logoBase64}');
      background-size: contain;
      background-repeat: no-repeat;
      background-position: center;
      display: inline-block;
      vertical-align: middle;
    }

    /* ตารางล็อกขนาดเป็น mm เพื่อให้ตำแหน่งตรงกันทุกเครื่อง */
    .attendance-table-wrapper {
      position: relative;
      margin-top: 2mm;
      display: flex;
      justify-content: center;
    }
    table.attendance-table {
      width: 268mm;
      max-width: 268mm;
      border-collapse: collapse;
      border: 1.5px solid #0f172a;
      table-layout: fixed;
      font-size: 8.5pt;
      background: #ffffff;
    }
    table.attendance-table th, table.attendance-table td {
      border: 1px solid #475569;
      padding: 0;
      text-align: center;
      vertical-align: middle;
      box-sizing: border-box;
    }
    table.attendance-table th {
      background-color: #f1f5f9;
      color: #0f172a;
      font-weight: 700;
    }
    table.attendance-table th.col-room { width: 18mm; }
    table.attendance-table th.col-nick { width: 22mm; }
    table.attendance-table th.col-name { width: 48mm; text-align: left; padding-left: 3mm; }
    table.attendance-table th.col-id { width: 16mm; }
    table.attendance-table th.date-header {
      width: 12.5mm;
      font-size: 7.5pt;
      font-weight: 700;
      background-color: #e2e8f0;
    }
    table.attendance-table th.col-note { width: 14mm; }

    /* วงกลม OMR ขนาด 4.2mm ขอบเข้มชัดเจน */
    .omr-circle {
      width: 4.2mm;
      height: 4.2mm;
      border: 0.5mm solid #1e293b;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 6.5pt;
      font-weight: 600;
      color: #64748b;
      cursor: pointer;
      user-select: none;
      background: #ffffff;
      margin: 0 auto;
      box-sizing: border-box;
      transition: all 0.12s ease;
    }
    .omr-circle:hover {
      border-color: #0f172a;
      box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.3);
    }
    .omr-circle.marked-present {
      background-color: #0f172a !important;
      color: #ffffff !important;
      border-color: #0f172a !important;
    }

    .signatures-row {
      display: flex;
      justify-content: space-around;
      margin-top: 3mm;
      font-size: 8.5pt;
      color: #1e293b;
      text-align: center;
    }

    .nav-bar {
      width: 281mm;
      margin: 0 auto 10px auto;
      background: #1e293b;
      color: white;
      padding: 8px 16px;
      border-radius: 4px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 2px 4px rgba(0,0,0,0.15);
    }
    .btn-print {
      background-color: #27ae60;
      color: white;
      border: none;
      padding: 7px 14px;
      font-size: 13px;
      font-weight: bold;
      border-radius: 4px;
      cursor: pointer;
    }
    .btn-print:hover {
      background-color: #219653;
    }

    @media print {
      body {
        background: transparent !important;
        padding: 0 !important;
        margin: 0 !important;
      }
      .sheet-page {
        box-shadow: none !important;
        margin: 0 !important;
        border-radius: 0 !important;
        width: 100% !important;
        height: 196mm !important;
        min-height: 196mm !important;
        max-height: 196mm !important;
      }
      .no-print {
        display: none !important;
      }
    }
  </style>
</head>
<body>
  <div class="nav-bar no-print">
    <div style="font-weight: bold; font-size: 14px;">
      ใบเช็คชื่อ - ${dayName} (${dayCode})
    </div>
    <div>
      <button class="btn-print" onclick="window.print()">สั่งพิมพ์เอกสารนี้ (Print A4)</button>
    </div>
  </div>

  <section class="sheet-page" id="sheet-single">
    <!-- 4 Corner Fiducial Markers: 8mm Solid Squares with TL orientation white dot -->
    <div class="fiducial-marker fiducial-tl"></div>
    <div class="fiducial-marker fiducial-tr"></div>
    <div class="fiducial-marker fiducial-bl"></div>
    <div class="fiducial-marker fiducial-br"></div>

    <!-- Sheet Corner Tag (Safe Distance from TR Fiducial) -->
    <div class="sheet-corner-tag">
      <div class="tag-english">${englishDay}</div>
      <div class="tag-code">[${dayCode}]</div>
    </div>

    <!-- Content Container -->
    <div>
      <!-- Header Section -->
      <div style="text-align: center; margin-bottom: 2mm; padding-right: 30mm; padding-left: 10mm;">
        <div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
          <div class="sarawat-logo-mark"></div>
          <div>
            <div style="font-size: 16pt; font-weight: 700; color: #0f172a; margin: 0; line-height: 1.1;">
              ใบเช็คชื่อ
            </div>
            <div style="font-size: 9pt; color: #1e3a8a; font-weight: 600; margin-top: 1px;">
              กลุ่มงานกิจการนักเรียน • ฝ่ายสารวัตรนักเรียน
            </div>
            <div style="font-size: 8pt; color: #475569;">
              โรงเรียนพระนารายณ์ • ${period.fullLabel}
            </div>
          </div>
        </div>
      </div>

      <!-- Leadership Bar -->
      <div style="background-color: #f8fafc; border: 1px solid #cbd5e1; padding: 2.5px 12px; border-radius: 4px; margin-bottom: 2mm; display: flex; justify-content: space-around; font-size: 8.5pt;">
        <span><strong>หัวหน้าเวร:</strong> ${headText}</span>
        <span><strong>รองหัวหน้าเวร:</strong> ${deputyText}</span>
      </div>

      <!-- Meta Line & Machine QR Code Anchor -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2mm; font-size: 8.5pt; color: #334155;">
        <div>
          <span><strong>รอบเวร:</strong> ${dayName} (${dayCode})</span>
          <span style="margin-left: 14px;"><strong>จำนวนสมาชิกในเวร:</strong> ${members.length} นาย</span>
          <span style="margin-left: 14px; color: #047857; font-size: 8pt; font-weight: 600;">* ฝนดำในวงกลม [○] (ม) = มาปฏิบัติหน้าที่ | ช่องว่าง = มาสาย (ส) | การลาเวรให้แจ้งผ่านระบบ Discord *</span>
        </div>

        <!-- Machine QR Session Anchor (Offline Embedded SVG 20mm) -->
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="font-size: 7.5pt; text-align: right; line-height: 1.2; color: #475569;">
            <span style="font-weight: 700; color: #0f172a;">FORM: ATT-Q${period.quarter}-${dayCode}</span><br>
            <span>REV: ${period.academicYear} • 12 WEEKS</span>
          </div>
          <div style="border: 1px solid #0f172a; padding: 0.8mm; background: #ffffff; border-radius: 2px; width: 21.6mm; height: 21.6mm; display: flex; align-items: center; justify-content: center; box-sizing: border-box;">
            ${qrSvg}
          </div>
        </div>
      </div>

      <!-- 12-WEEK QUARTER ATTENDANCE TABLE (LOCKED MM DIMENSIONS) -->
      <div class="attendance-table-wrapper">
        <table class="attendance-table">
          <thead>
            <tr style="height: 6mm;">
              <th rowspan="2" class="col-room">ห้อง/เลขที่</th>
              <th rowspan="2" class="col-nick">ชื่อเล่น</th>
              <th rowspan="2" class="col-name">ชื่อ - สกุลจริง</th>
              <th rowspan="2" class="col-id">รหัสประจำตัว</th>
              <th colspan="12" style="background-color: #f1f5f9; font-weight: bold;">${tableColspanHeader}</th>
              <th rowspan="2" class="col-note">หมายเหตุ</th>
            </tr>
            <tr style="height: 5.5mm;">
              ${dateHeaders}
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Signatures Row & Professional Metadata Footer -->
    <div style="margin-top: 3mm;">
      <div class="signatures-row">
        <div>
          <div>ลงชื่อ..................................................................</div>
          <div style="margin-top: 2px;">( ${head ? `${head.first_name} ${head.last_name}` : '......................................................'} )<br>หัวหน้า${dayName}</div>
        </div>
        <div>
          <div>ลงชื่อ..................................................................</div>
          <div style="margin-top: 2px;">( ...................................................... )<br>ประธานสารวัตรนักเรียน</div>
        </div>
        <div>
          <div>ลงชื่อ..................................................................</div>
          <div style="margin-top: 2px;">( ...................................................... )<br>ครูหัวหน้าสารวัตรนักเรียน</div>
        </div>
      </div>

      <!-- Footer Real Machine Stamp -->
      <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #cbd5e1; padding-top: 2.5mm; margin-top: 3mm; font-size: 7pt; color: #64748b;">
        <span>SARAWAT PRANARAI COMMAND OS // 12-WEEK ATTENDANCE SYSTEM</span>
        <span>PAGE 1 OF 1 • A4 LANDSCAPE (297 x 210 mm)</span>
        <span>DOC REF: ATT-Q${period.quarter}-${dayCode}-${period.academicYear}</span>
      </div>
    </div>
  </section>
</body>
</html>`;
}

function generateCombinedAttendanceSheetHTML(allMembers) {
  const period = getAcademicPeriod();
  const logoBase64 = getSarawatLogoBase64();
  const shifts = [
    { code: 'M', name: 'เวรวันจันทร์' },
    { code: 'T', name: 'เวรวันอังคาร' },
    { code: 'W', name: 'เวรวันพุธ' },
    { code: 'Ts', name: 'เวรวันพฤหัสบดี' },
    { code: 'F', name: 'เวรวันศุกร์' }
  ];

  const sectionsHtml = shifts.map(shift => {
    const shiftMembers = allMembers.filter(m => {
      if (shift.code === 'S') return m.duty_day === 'S' || (m.duty_day && m.duty_day.endsWith('S'));
      const combinedCode = shift.code === 'Ts' ? 'TSS' : `${shift.code}S`;
      return m.duty_day === shift.code || m.duty_day === combinedCode;
    });

    const head = shiftMembers.find(m => m.shift_role === 'SHIFT_HEAD');
    const deputy = shiftMembers.find(m => m.shift_role === 'SHIFT_DEPUTY');

    const headText = head ? `[${head.duty_id || '-'}] ${head.nickname || '-'} (${head.first_name || ''} ${head.last_name || ''})` : 'ยังไม่ได้แต่งตั้ง';
    const deputyText = deputy ? `[${deputy.duty_id || '-'}] ${deputy.nickname || '-'} (${deputy.first_name || ''} ${deputy.last_name || ''})` : 'ยังไม่ได้แต่งตั้ง';
    const englishDay = getEnglishDayName(shift.code);
    const isSpecial = shift.code === 'S';
    const dates = getAttendanceDates(shift.code, 12, period.quarter, period.academicYear);

    const tableColspanHeader = isSpecial 
      ? 'บันทึกการมาปฏิบัติหน้าที่ (สัปดาห์ที่ 1 ถึง 12)' 
      : 'บันทึกการมาปฏิบัติหน้าที่ (เดือน/วัน)';
    const dateHeaders = dates.map((d, idx) => 
      `<th class="date-header" style="width: 12.5mm; font-size: 7.5pt; font-weight: 700;" title="สัปดาห์ที่ ${idx + 1}: ${d}">${d}</th>`
    ).join('');

    let rows = '';
    if (shiftMembers.length > 0) {
      rows = shiftMembers.map(m => {
        const roleTag = m.shift_role === 'SHIFT_HEAD' 
          ? ' <span style="color: #b91c1c; font-weight: bold; font-size: 7.5pt;">(หัวหน้า)</span>' 
          : (m.shift_role === 'SHIFT_DEPUTY' ? ' <span style="color: #0284c7; font-weight: bold; font-size: 7.5pt;">(รอง)</span>' : '');

        const dateCells = dates.map((dStr, wIdx) => `
          <td style="width: 12.5mm; height: 8mm; padding: 0; text-align: center; vertical-align: middle;">
            <div class="omr-circle" data-duty="${m.duty_id || ''}" data-col="${wIdx}" onclick="this.classList.toggle('marked-present')" title="${m.duty_id || ''} วันที่ ${dStr}: ฝนดำเมื่อมาปฏิบัติหน้าที่ (ม)">
              ม
            </div>
          </td>
        `).join('');

        return `
          <tr style="height: 8mm;">
            <td style="font-size: 8pt; font-weight: 600; text-align: center;">${m.grade_class || '-'} (${m.student_no || '-'})` + '</td>' + `
            <td style="font-weight: 700; color: #1a5276; white-space: nowrap; text-align: center;">${m.nickname || '-'}${roleTag}</td>
            <td style="text-align: left; padding-left: 3mm; white-space: nowrap;">${m.first_name || ''} ${m.last_name || ''}</td>
            <td style="font-weight: 700; color: #d97706; font-size: 8.5pt; text-align: center;">${m.duty_id || '-'}</td>
            ${dateCells}
            <td style="font-size: 7.5pt; color: #64748b; text-align: center;">${m.post || '-'}</td>
          </tr>
        `;
      }).join('');
    } else {
      const emptyCells = dates.map(() => `
        <td style="width: 12.5mm; height: 8mm; padding: 0; text-align: center; color: #cbd5e1; font-size: 8pt; vertical-align: middle;">-</td>
      `).join('');
      rows = Array.from({ length: 3 }).map(() => `
        <tr style="height: 8mm;">
          <td style="text-align: center; color: #94a3b8;">-</td>
          <td style="text-align: center; color: #94a3b8;">-</td>
          <td style="text-align: center; color: #94a3b8;">(ว่าง)</td>
          <td style="text-align: center; color: #94a3b8;">-</td>
          ${emptyCells}
          <td style="text-align: center; color: #94a3b8;">-</td>
        </tr>
      `).join('');
    }

    const qrPayload = `${getWebDashboardUrl()}/attendance-sheet?shift=${shift.code}&q=${period.quarter}&year=${period.academicYear}`;
    const qrSvg = generateQRCodeSVG(qrPayload, 20);

    return `
      <section class="sheet-page" id="shift-${shift.code}">
        <!-- 4 Corner Fiducial Markers: 8mm Solid Squares with TL orientation white dot -->
        <div class="fiducial-marker fiducial-tl"></div>
        <div class="fiducial-marker fiducial-tr"></div>
        <div class="fiducial-marker fiducial-bl"></div>
        <div class="fiducial-marker fiducial-br"></div>

        <!-- Sheet Corner Tag (Safe Distance from TR Fiducial) -->
        <div class="sheet-corner-tag">
          <div class="tag-english">${englishDay}</div>
          <div class="tag-code">[${shift.code}]</div>
        </div>

        <!-- Content Container -->
        <div>
          <!-- Header Section -->
          <div style="text-align: center; margin-bottom: 2mm; padding-right: 30mm; padding-left: 10mm;">
            <div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
              <div class="sarawat-logo-mark"></div>
              <div>
                <div style="font-size: 16pt; font-weight: 700; color: #0f172a; margin: 0; line-height: 1.1;">
                  ใบเช็คชื่อ
                </div>
                <div style="font-size: 9pt; color: #1e3a8a; font-weight: 600; margin-top: 1px;">
                  กลุ่มงานกิจการนักเรียน • ฝ่ายสารวัตรนักเรียน
                </div>
                <div style="font-size: 8pt; color: #475569;">
                  โรงเรียนพระนารายณ์ • ${period.fullLabel}
                </div>
              </div>
            </div>
          </div>

          <!-- Leadership Bar -->
          <div style="background-color: #f8fafc; border: 1px solid #cbd5e1; padding: 2.5px 12px; border-radius: 4px; margin-bottom: 2mm; display: flex; justify-content: space-around; font-size: 8.5pt;">
            <span><strong>หัวหน้าเวร:</strong> ${headText}</span>
            <span><strong>รองหัวหน้าเวร:</strong> ${deputyText}</span>
          </div>

          <!-- Meta Line & Machine QR Code Anchor -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2mm; font-size: 8.5pt; color: #334155;">
            <div>
              <span><strong>รอบเวร:</strong> ${shift.name} (${shift.code})</span>
              <span style="margin-left: 14px;"><strong>จำนวนสมาชิกในเวร:</strong> ${shiftMembers.length} นาย</span>
              <span style="margin-left: 14px; color: #047857; font-size: 8pt; font-weight: 600;">* ฝนดำในวงกลม [○] (ม) = มาปฏิบัติหน้าที่ | ช่องว่าง = มาสาย (ส) | การลาเวรให้แจ้งผ่านระบบ Discord *</span>
            </div>

            <!-- Machine QR Session Anchor (Offline Embedded SVG 20mm) -->
            <div style="display: flex; align-items: center; gap: 8px;">
              <div style="font-size: 7.5pt; text-align: right; line-height: 1.2; color: #475569;">
                <span style="font-weight: 700; color: #0f172a;">FORM: ATT-Q${period.quarter}-${shift.code}</span><br>
                <span>REV: ${period.academicYear} • 12 WEEKS</span>
              </div>
              <div style="border: 1px solid #0f172a; padding: 0.8mm; background: #ffffff; border-radius: 2px; width: 21.6mm; height: 21.6mm; display: flex; align-items: center; justify-content: center; box-sizing: border-box;">
                ${qrSvg}
              </div>
            </div>
          </div>

          <!-- 12-WEEK QUARTER ATTENDANCE TABLE (LOCKED MM DIMENSIONS) -->
          <div class="attendance-table-wrapper">
            <table class="attendance-table">
              <thead>
                <tr style="height: 6mm;">
                  <th rowspan="2" class="col-room">ห้อง/เลขที่</th>
                  <th rowspan="2" class="col-nick">ชื่อเล่น</th>
                  <th rowspan="2" class="col-name">ชื่อ - สกุลจริง</th>
                  <th rowspan="2" class="col-id">รหัสประจำตัว</th>
                  <th colspan="12" style="background-color: #f1f5f9; font-weight: bold;">${tableColspanHeader}</th>
                  <th rowspan="2" class="col-note">หมายเหตุ</th>
                </tr>
                <tr style="height: 5.5mm;">
                  ${dateHeaders}
                </tr>
              </thead>
              <tbody>
                ${rows}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Signatures Row & Professional Metadata Footer -->
        <div style="margin-top: 3mm;">
          <div class="signatures-row">
            <div>
              <div>ลงชื่อ..................................................................</div>
              <div style="margin-top: 2px;">( ${head ? `${head.first_name} ${head.last_name}` : '......................................................'} )<br>หัวหน้า${shift.name}</div>
            </div>
            <div>
              <div>ลงชื่อ..................................................................</div>
              <div style="margin-top: 2px;">( ...................................................... )<br>ประธานสารวัตรนักเรียน</div>
            </div>
            <div>
              <div>ลงชื่อ..................................................................</div>
              <div style="margin-top: 2px;">( ...................................................... )<br>ครูหัวหน้าสารวัตรนักเรียน</div>
            </div>
          </div>

          <!-- Footer Real Machine Stamp -->
          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #cbd5e1; padding-top: 2.5mm; margin-top: 3mm; font-size: 7pt; color: #64748b;">
            <span>SARAWAT PRANARAI COMMAND OS // 12-WEEK ATTENDANCE SYSTEM</span>
            <span>PAGE 1 OF 1 • A4 LANDSCAPE (297 x 210 mm)</span>
            <span>DOC REF: ATT-Q${period.quarter}-${shift.code}-${period.academicYear}</span>
          </div>
        </div>
      </section>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <title>ใบเช็คชื่อ - รวมทุกรอบเวร (M, T, W, Ts, F)</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Sarabun:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400&display=swap" rel="stylesheet">
  <style>
    @page {
      size: A4 landscape;
      margin: 6mm 8mm;
    }
    * {
      box-sizing: border-box !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      font-family: 'Sarabun', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      margin: 0;
      padding: 10px;
      color: #0f172a;
      font-size: 13px;
      background: #f1f5f9;
    }
    .sheet-page {
      width: 281mm;
      height: 196mm;
      min-height: 196mm;
      max-height: 196mm;
      padding: 4mm 5mm;
      margin: 0 auto 20px auto;
      background: #ffffff;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
      border-radius: 4px;
      position: relative;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      page-break-after: always;
      break-after: page;
      page-break-inside: avoid;
      break-inside: avoid;
      overflow: hidden;
    }
    .sheet-page:last-child {
      page-break-after: auto;
      break-after: auto;
      margin-bottom: 0;
    }

    /* 4 Corner Fiducial Markers: 8mm Solid Squares with TL orientation white dot */
    .fiducial-marker {
      position: absolute;
      width: 8mm;
      height: 8mm;
      background: #000000;
      pointer-events: none;
      box-sizing: border-box;
      z-index: 20;
    }
    .fiducial-tl { top: 4mm; left: 4mm; }
    .fiducial-tl::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      width: 2.6mm;
      height: 2.6mm;
      background: #ffffff;
      border-radius: 50%;
      transform: translate(-50%, -50%);
    }
    .fiducial-tr { top: 4mm; right: 4mm; }
    .fiducial-bl { bottom: 4mm; left: 4mm; }
    .fiducial-br { bottom: 4mm; right: 4mm; }

    /* ป้ายเวรประจำวัน (เว้นระยะปลอดภัย ไม่ทับหมุดมุมขวาบน 8mm) */
    .sheet-corner-tag {
      position: absolute;
      top: 4.5mm;
      right: 18mm;
      text-align: right;
      border: 1.5px solid #1a5276;
      border-radius: 4px;
      padding: 2px 8px;
      background-color: #f8fafc;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      line-height: 1.1;
      z-index: 10;
    }
    .sheet-corner-tag .tag-english {
      font-size: 13pt;
      font-weight: 700;
      color: #1a5276;
      letter-spacing: 0.5px;
    }
    .sheet-corner-tag .tag-code {
      font-size: 8.5pt;
      font-weight: 700;
      color: #d35400;
    }

    /* โลโก้สารวัตรแบบฝังเดี่ยวใน CSS ครั้งเดียว ไม่ซ้ำซ้อน 5 ชุด */
    .sarawat-logo-mark {
      width: 13mm;
      height: 13mm;
      border-radius: 50%;
      border: 1px solid #1a5276;
      background-image: url('${logoBase64}');
      background-size: contain;
      background-repeat: no-repeat;
      background-position: center;
      display: inline-block;
      vertical-align: middle;
    }

    /* ตารางล็อกขนาดเป็น mm เพื่อให้ตำแหน่งตรงกันทุกเครื่อง */
    .attendance-table-wrapper {
      position: relative;
      margin-top: 2mm;
      display: flex;
      justify-content: center;
    }
    table.attendance-table {
      width: 268mm;
      max-width: 268mm;
      border-collapse: collapse;
      border: 1.5px solid #0f172a;
      table-layout: fixed;
      font-size: 8.5pt;
      background: #ffffff;
    }
    table.attendance-table th, table.attendance-table td {
      border: 1px solid #475569;
      padding: 0;
      text-align: center;
      vertical-align: middle;
      box-sizing: border-box;
    }
    table.attendance-table th {
      background-color: #f1f5f9;
      color: #0f172a;
      font-weight: 700;
    }
    table.attendance-table th.col-room { width: 18mm; }
    table.attendance-table th.col-nick { width: 22mm; }
    table.attendance-table th.col-name { width: 48mm; text-align: left; padding-left: 3mm; }
    table.attendance-table th.col-id { width: 16mm; }
    table.attendance-table th.date-header {
      width: 12.5mm;
      font-size: 7.5pt;
      font-weight: 700;
      background-color: #e2e8f0;
    }
    table.attendance-table th.col-note { width: 14mm; }

    /* วงกลม OMR ขนาด 4.2mm ขอบเข้มชัดเจน */
    .omr-circle {
      width: 4.2mm;
      height: 4.2mm;
      border: 0.5mm solid #1e293b;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 6.5pt;
      font-weight: 600;
      color: #64748b;
      cursor: pointer;
      user-select: none;
      background: #ffffff;
      margin: 0 auto;
      box-sizing: border-box;
      transition: all 0.12s ease;
    }
    .omr-circle:hover {
      border-color: #0f172a;
      box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.3);
    }
    .omr-circle.marked-present {
      background-color: #0f172a !important;
      color: #ffffff !important;
      border-color: #0f172a !important;
    }

    .signatures-row {
      display: flex;
      justify-content: space-around;
      margin-top: 3mm;
      font-size: 8.5pt;
      color: #1e293b;
      text-align: center;
    }

    .nav-bar {
      width: 281mm;
      margin: 0 auto 10px auto;
      background: #1e293b;
      color: white;
      padding: 8px 16px;
      border-radius: 4px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 2px 4px rgba(0,0,0,0.15);
    }
    .nav-links {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-wrap: wrap;
    }
    .nav-btn {
      color: #cbd5e1;
      text-decoration: none;
      padding: 4px 10px;
      border-radius: 4px;
      background: #334155;
      font-size: 12px;
      transition: all 0.2s;
    }
    .nav-btn:hover {
      background: #3b82f6;
      color: white;
    }
    .btn-print {
      background-color: #27ae60;
      color: white;
      border: none;
      padding: 7px 14px;
      font-size: 13px;
      font-weight: bold;
      border-radius: 4px;
      cursor: pointer;
    }
    .btn-print:hover {
      background-color: #219653;
    }

    @media print {
      body {
        background: transparent !important;
        padding: 0 !important;
        margin: 0 !important;
      }
      .sheet-page {
        box-shadow: none !important;
        margin: 0 !important;
        border-radius: 0 !important;
        width: 100% !important;
        height: 196mm !important;
        min-height: 196mm !important;
        max-height: 196mm !important;
      }
      .no-print {
        display: none !important;
      }
    }
  </style>
</head>
<body>
  <div class="nav-bar no-print">
    <div style="font-weight: bold; font-size: 14px;">
      ใบเช็คชื่อ (รวมทุกเวร - สมาชิกทั้งหมด ${allMembers.length} นาย)
    </div>
    <div class="nav-links">
      <span style="font-size: 11px; color: #94a3b8;">ข้ามไปเวร:</span>
      <a href="#shift-M" class="nav-btn">จันทร์</a>
      <a href="#shift-T" class="nav-btn">อังคาร</a>
      <a href="#shift-W" class="nav-btn">พุธ</a>
      <a href="#shift-Ts" class="nav-btn">พฤหัสบดี</a>
      <a href="#shift-F" class="nav-btn">ศุกร์</a>
      <button class="btn-print" onclick="window.print()">สั่งพิมพ์เอกสารทั้งหมด (Print All A4)</button>
    </div>
  </div>

  ${sectionsHtml}
</body>
</html>`;
}

// ==========================================================
// 🌐 LIGHTWEIGHT HTTP SERVER (สำหรับโฮสต์บน Render.com Web Service)
// ==========================================================
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // 🖼️ เส้นทางดาวน์โหลดไฟล์รูปภาพ Static: /assets/*
  if (parsedUrl.pathname.startsWith('/assets/')) {
    const filename = path.basename(parsedUrl.pathname);
    const assetPath = path.join(__dirname, 'assets', filename);
    if (fs.existsSync(assetPath)) {
      const ext = path.extname(filename).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mimeType, 'Cache-Control': 'public, max-age=86400' });
      fs.createReadStream(assetPath).pipe(res);
      return;
    }
  }

  // 🔲 เส้นทางเครื่องมือครอปรูปถ่าย (Redirect ไปยัง Web Dashboard)
  if (parsedUrl.pathname === '/crop' || parsedUrl.pathname === '/crop.html') {
    res.writeHead(302, { 'Location': `${getWebDashboardUrl()}/crop${parsedUrl.search}` });
    res.end();
    return;
  }

  // 🪪 เส้นทางเปิดดูบัตรประจำตัวสารวัตรนักเรียน: /card?id=UUID หรือ /verify?id=UUID
  if (parsedUrl.pathname === '/card' || parsedUrl.pathname === '/verify' || parsedUrl.pathname.startsWith('/card/')) {
    let memberId = parsedUrl.searchParams.get('id');
    if (!memberId && parsedUrl.pathname.startsWith('/card/')) {
      memberId = parsedUrl.pathname.replace('/card/', '').split('/')[0].trim();
    }

    if (!memberId) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h3>⚠️ กรุณาระบุรหัสสมาชิก (?id=UUID)</h3>');
      return;
    }

    try {
      const { data: member, error } = await supabase
        .from('members')
        .select('*')
        .or(`id.eq.${memberId},discord_id.eq.${memberId}`)
        .maybeSingle();

      if (error || !member) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!DOCTYPE html>
          <html lang="th">
          <head><meta charset="UTF-8"><title>ไม่พบบัตร</title>
          <style>body{font-family:sans-serif;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
          .box{background:#1e293b;padding:30px;border-radius:12px;text-align:center;max-width:400px;}</style></head>
          <body><div class="box"><h2>❌ ไม่พบข้อมูลบัตร</h2><p>ไม่พบรหัสสมาชิกนี้ในฐานข้อมูลสารวัตรนักเรียน</p></div></body>
          </html>
        `);
        return;
      }

      const cardHtml = generateCardHTML(member);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=60'
      });
      res.end(cardHtml);
      return;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h3>เกิดข้อผิดพลาดในการโหลดบัตร: ${err.message}</h3>`);
      return;
    }
  }

  if (parsedUrl.pathname === '/health' || parsedUrl.pathname === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), bot: client.user ? client.user.tag : 'connecting' }));
    return;
  }

  // 📦 เส้นทางรับประกาศส่งมอบของหาย: POST /api/discord/announce-handover
  if (parsedUrl.pathname === '/api/discord/announce-handover' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}');
        const {
          item_code,
          title,
          claimant_name,
          claimant_contact,
          delivered_by,
          delivered_by_duty_id,
          handover_photo_base64
        } = data;

        const targetGuild = client.guilds.cache.get(process.env.GUILD_ID) || client.guilds.cache.first();
        if (!targetGuild) throw new Error('No guild found');

        const chLostFound = findChannel(targetGuild, '📦│แจ้งพบของหาย') ||
          findChannel(targetGuild, 'แจ้งพบของหาย') ||
          targetGuild.channels.cache.find(c => c.name.includes('ของหาย'));

        if (!chLostFound) throw new Error('Channel 📦│แจ้งพบของหาย not found');

        const files = [];
        let filename = 'handover.jpg';
        if (handover_photo_base64) {
          const buf = Buffer.from(handover_photo_base64.split(',').pop(), 'base64');
          filename = `handover_${(item_code || Date.now()).toString().replace(/[^a-zA-Z0-9_-]/g, '_')}.jpg`;
          files.push(new AttachmentBuilder(buf, { name: filename }));
        }

        const embed = new EmbedBuilder()
          .setTitle(`🎉 ส่งมอบสิ่งของคืนเจ้าของเรียบร้อยแล้ว! [${item_code || ''}]`)
          .setDescription(
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🏷️ **สิ่งของ:** ${title || '-'}\n` +
            `👤 **ผู้รับคืน:** ${claimant_name || '-'} (${claimant_contact || '-'})\n` +
            `🛡️ **สารวัตรผู้ส่งมอบ:** ${delivered_by || '-'} \`[${delivered_by_duty_id || '-'}]\`\n` +
            `📅 **วันเวลา:** ${new Date().toLocaleDateString('th-TH')} (${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })})\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `*✅ บันทึกรูปหลักฐาน (Discord CDN) และปิดเคสลงระบบสารสนเทศเรียบร้อยแล้ว*`
          )
          .setColor('#2ECC71')
          .setFooter({ text: 'SARAWAT LOST & FOUND • โรงเรียนพระนารายณ์' })
          .setTimestamp();

        if (files.length > 0) {
          embed.setImage(`attachment://${filename}`);
        }

        const sentMsg = await chLostFound.send({ embeds: [embed], files });
        const discordPhotoUrl = (sentMsg.attachments && sentMsg.attachments.first()) ? sentMsg.attachments.first().url : null;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, discord_photo_url: discordPhotoUrl }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // เส้นทางเปิดดู/พิมพ์ใบเช็คชื่อชั่วคราว: /sheet/:id
  if (parsedUrl.pathname.startsWith('/sheet/')) {
    const sheetId = parsedUrl.pathname.replace('/sheet/', '').split('/')[0].trim();
    const sheet = tempAttendanceSheets.get(sheetId);

    if (!sheet || Date.now() > sheet.expiresAt) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html lang="th">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>เอกสารหมดอายุ - SARAWAT BOT</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Sarabun", sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: #1e293b; padding: 2.5rem; border-radius: 12px; border: 1px solid #334155; text-align: center; max-width: 440px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
            h2 { color: #f87171; margin-top: 0; }
            p { color: #94a3b8; font-size: 14px; line-height: 1.6; }
            .badge { display: inline-block; background: #7f1d1d; color: #fca5a5; padding: 4px 10px; border-radius: 9999px; font-size: 12px; margin-bottom: 12px; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="badge">⏰ EXPIRED</div>
            <h2>ลิ้งก์เอกสารนี้หมดอายุแล้ว</h2>
            <p>เอกสารชั่วคราวถูกลบออกจากหน่วยความจำแล้ว เพื่อความปลอดภัยและประหยัดพื้นที่</p>
            <p>กรุณากดขอใบตารางเช็คชื่อใหม่จากช่อง Discord</p>
          </div>
        </body>
        </html>
      `);
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(sheet.html);
    return;
  }

  // API Route: รับแจ้งเหตุจาก Google Apps Script เข้า Supabase + Discord
  if (req.method === 'POST' && parsedUrl.pathname === '/api/cases') {
    const expectedSecret = process.env.WEBHOOK_SECRET;
    const providedSecret = req.headers['x-api-key'] || parsedUrl.searchParams.get('secret');

    if (expectedSecret && providedSecret !== expectedSecret) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: Invalid API secret' }));
      return;
    }

    let body = '';
    let aborted = false;

    req.on('data', chunk => {
      if (aborted) return;
      body += chunk;
      if (body.length > 1e6) { // ป้องกัน DoS: จำกัดขนาด Payload สูงสุด 1MB
        aborted = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload Too Large (Max 1MB)' }));
        req.destroy();
      }
    });

    req.on('end', async () => {
      if (aborted) return;
      try {
        const payload = JSON.parse(body);
        const caseId = payload.case_id || ('CASE-' + Math.floor(1000 + Math.random() * 9000));
        
        const reporterNameWithGrade = `${payload.reporter_name || 'ไม่ประสงค์ออกนาม'}${payload.reporter_grade && payload.reporter_grade !== '-' ? ` (ชั้น ${payload.reporter_grade})` : ''}`;
        
        // 1. บันทึกลง Supabase cases table
        await supabase.from('cases').insert({
          case_id: caseId,
          reporter_email: payload.reporter_email || 'anonymous@pranarai.ac.th',
          reporter_name: reporterNameWithGrade,
          incident_date_time: payload.incident_date_time || new Date().toISOString(),
          location: (payload.contact_info && payload.contact_info !== '-' && String(payload.contact_info).trim() !== '') ? String(payload.contact_info).trim() : ((payload.location && payload.location !== 'โรงเรียนพระนารายณ์') ? String(payload.location).trim() : 'ไม่ระบุ'),
          category: payload.category || 'รับเรื่องร้องเรียน',
          description: payload.description || 'ไม่มีรายละเอียด',
          evidence_urls: Array.isArray(payload.evidence_urls) ? payload.evidence_urls : (payload.evidence_url ? [payload.evidence_url] : []),
          status: payload.status || 'PENDING'
        }).catch(err => console.warn('Supabase case insert error:', err.message));

        // 2. ส่งข้อความเข้า Discord #🔔│แจ้งเหตุใหม่-google-form
        const incidentChannelId = process.env.INCIDENT_CHANNEL_ID || '1567570890084843530';
        const incidentChannel = await client.channels.fetch(incidentChannelId).catch(() => null);
        if (incidentChannel) {
          const desc = payload.description || '';
          const isUrgent = desc.includes('บุหรี่') || desc.includes('สารเสพติด') || desc.includes('ทะเลาะ') || desc.includes('ยา') || desc.includes('ตีกัน') || desc.includes('อาวุธ') || desc.includes('มีด') || desc.includes('ขโมย');
          const embed = new EmbedBuilder()
            .setTitle(`${isUrgent ? '🔥 [เหตุด่วนความปลอดภัย]' : '🚨 [แจ้งเหตุใหม่]'} รหัสคดี: ${caseId}`)
            .setDescription(
              `ผู้ส่งเหตุ: ${reporterNameWithGrade}\n` +
              `อีเมล: ${payload.reporter_email || 'ไม่ระบุ'}\n` +
              `ข้อมูลติดต่อกลับ: ${payload.contact_info || '-'}\n` +
              `เรื่อง + บอกวันที่ ที่เกิดเหตุ: ${desc || '-'}\n` +
              `สถานะ: ⏳ รอดำเนินการ (รอสารวัตร/หัวหน้าเวรรับเรื่อง)`
            )
            .setColor(isUrgent ? '#C0392B' : '#E74C3C')
            .setFooter({ text: `ระบบรับเรื่องร้องเรียน สารวัตรนักเรียน โรงเรียนพระนารายณ์ • เวลา: ${payload.timestamp || new Date().toLocaleString('th-TH')}` })
            .setTimestamp();

          if (payload.evidence_url && (payload.evidence_url.startsWith('http://') || payload.evidence_url.startsWith('https://'))) {
            embed.addFields({ name: '📂 หลักฐานแนบ', value: `[คลิกเพื่อเปิดดูไฟล์หลักฐานใน Google Drive](${payload.evidence_url})` });
          }

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`btn_assign_case_${caseId}`)
              .setLabel('👮 มอบหมายเวร')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`btn_close_case_${caseId}`)
              .setLabel('📁 ปิดคดี')
              .setStyle(ButtonStyle.Success)
          );

          await incidentChannel.send({
            content: '@here มีรายงานแจ้งเหตุใหม่เข้ามา',
            embeds: [embed],
            components: [row]
          });
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, case_id: caseId }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // API Route: รับคำร้องแจ้งของหายจาก Google Apps Script เข้า Supabase + Discord
  if (req.method === 'POST' && parsedUrl.pathname === '/api/lost-found/claims') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const currentYear = new Date().getFullYear();
        const claimCode = payload.claim_code || `CLM-${currentYear}-${Math.floor(1000 + Math.random() * 9000)}`;

        const newClaim = {
          claim_code: claimCode,
          category: payload.category || payload.item_category || 'อื่นๆ',
          item_type: payload.item_type || payload.type || payload.title || 'ไม่ระบุ',
          characteristics: payload.characteristics || payload.description || 'ไม่มีรายละเอียด',
          lost_location: payload.lost_location || payload.location || 'ไม่ระบุ',
          lost_date: payload.lost_date || new Date().toISOString().slice(0, 10),
          claimant_name: payload.claimant_name || payload.name || 'ไม่ประสงค์ออกนาม',
          claimant_class: payload.claimant_class || payload.class || '-',
          claimant_contact: payload.claimant_contact || payload.phone || payload.contact || '-',
          status: 'PENDING',
          created_at: new Date().toISOString()
        };

        // 1. บันทึกลง Supabase lost_claims
        await supabase.from('lost_claims').insert(newClaim).catch(err => console.warn('Supabase lost_claims insert error:', err.message));

        // 2. ส่งข้อความเข้า Discord #📦│แจ้งพบของหาย
        const targetGuild = client.guilds.cache.get(GUILD_ID) || client.guilds.cache.first();
        if (targetGuild) {
          const chLostFound = findChannel(targetGuild, '📦│แจ้งพบของหาย') || findChannel(targetGuild, 'แจ้งพบของหาย');
          if (chLostFound) {
            const embed = new EmbedBuilder()
              .setTitle(`🔔 [คำร้องแจ้งของหายใหม่!] รหัส: ${claimCode}`)
              .setDescription(
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `📦 **สิ่งของที่ทำหาย:** ${newClaim.item_type}\n` +
                `🏷️ **หมวดหมู่:** ${newClaim.category}\n` +
                `📍 **จุดที่คาดว่าทำหาย:** ${newClaim.lost_location}\n` +
                `📅 **วันที่ทำหาย:** ${newClaim.lost_date}\n` +
                `🔍 **ลักษณะเด่น / ตำหนิ:** ${newClaim.characteristics}\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `👤 **ผู้แจ้ง:** ${newClaim.claimant_name} (ชั้น ${newClaim.claimant_class})\n` +
                `📞 **ช่องทางติดต่อกลับ:** ${newClaim.claimant_contact}\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `⚡ *ตรวจสอบและสแกนจับคู่กับของในคลังได้ทันทีที่หน้า Web Dashboard*`
              )
              .setColor('#F39C12')
              .setFooter({ text: 'ระบบบริหารงานสารวัตรนักเรียน • โรงเรียนพระนารายณ์' })
              .setTimestamp();

            if (payload.photo_url && (payload.photo_url.startsWith('http://') || payload.photo_url.startsWith('https://'))) {
              embed.setImage(payload.photo_url);
            }

            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setLabel('🌐 เปิดดูคำร้องใน Web Dashboard')
                .setStyle(ButtonStyle.Link)
                .setURL(`${getWebDashboardUrl()}/lost-found`)
            );

            await chLostFound.send({
              content: '📢 **[แจ้งเตือนสารวัตรทุกนาย]** มีคำร้องแจ้งของตัวเองหายใหม่เข้ามาในระบบ!',
              embeds: [embed],
              components: [row]
            }).catch(e => console.warn('[BOT_API] Send lost claim message error:', e.message));
          }
        }

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, claim_code: claimCode }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>SARAWAT PRANARAI BOT - Server Status</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .card { background: #1e293b; padding: 2.5rem; border-radius: 1rem; border: 1px solid #334155; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); max-width: 450px; }
          .status { display: inline-flex; align-items: center; gap: 0.5rem; background: #064e3b; color: #34d399; padding: 0.4rem 1rem; border-radius: 9999px; font-weight: bold; margin-bottom: 1.5rem; font-size: 0.9rem; }
          .dot { width: 10px; height: 10px; background: #10b981; border-radius: 50%; box-shadow: 0 0 10px #10b981; }
          h1 { margin: 0 0 0.5rem 0; font-size: 1.5rem; }
          p { color: #94a3b8; font-size: 0.95rem; margin: 0.3rem 0; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="status"><div class="dot"></div> BOT IS ONLINE 24/7</div>
          <h1>🛡️ สารวัตรนักเรียน โรงเรียนพระนารายณ์</h1>
          <p>🤖 บอท: <strong>${client.user ? client.user.tag : 'AI#1125'}</strong></p>
          <p>🌐 เซิร์ฟเวอร์: <strong>SARAWAT-PRANARAI</strong></p>
          <p>⏱️ Uptime: <strong>${Math.floor(process.uptime())} วินาที</strong></p>
          <p style="margin-top: 1.5rem; font-size: 0.8rem; color: #64748b;">Powered by Render.com + Discord.js v14 + Supabase</p>
        </div>
      </body>
    </html>
  `);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    server.listen(0, () => {
      // Pick random available port locally
    });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    const renderUrl = process.env.RENDER_EXTERNAL_URL;
    if (renderUrl) {
      const pingRender = setInterval(() => {
        fetch(`${renderUrl}/health`).catch(() => {});
      }, 1000 * 60 * 10);
      if (pingRender.unref) pingRender.unref();
    }
  });

  client.login(process.env.DISCORD_TOKEN).catch((err) => {
    if (err.message && err.message.includes('disallowed intents')) {
      console.log('\n[SARAWAT-BOT] ⚠️ ยังไม่ได้เปิดสวิตช์ Privileged Gateway Intents');
      console.log('กรุณาไปที่ https://discord.com/developers/applications/' + process.env.CLIENT_ID + '/bot');
      console.log('แล้วเปิดสวิตช์: Presence Intent, Server Members Intent, Message Content Intent\n');
    } else {
      console.error('[SARAWAT-BOT] Error:', err.message);
    }
  });
}

module.exports = {
  client,
  slashCommands,
  executeDDay,
  executeKillFile,
  executeDemoteLeader,
  executeDismissMember,
  refreshAllChannelsAndPanels,
  getThaiDayOfWeek,
  getTodayDutyCodes,
  sendDailyDutyReminders,
  runSystemDiagnostics,
  purgeChannelMessages,
  findChannel,
  sendVerifyPanel,
  sendPhotoPanel,
  sendAttendancePanel,
  sendAppointPanel,
  syncAllMemberRoles,
  resolveDutyDayForAppoint,
  getDutyRoles,
  getNextAvailableDutyId,
  getShiftLabel,
  getDayName,
  cleanGradeClass,
  cleanFullName,
  pendingPhotoUploads,
  pendingPhotoConfirmations,
  activeServicePhotoSessions,
  pendingLostReports,
  getUploadDir,
  getWebDashboardUrl,
  getOrCreateLogChannel,
  sendBotActionLog,
  broadcastConsolidatedShiftLeaveCard,
  getCurrentQuarterAndYear,
  getAcademicPeriod,
  updateAcademicPeriod,
  ensureInspectorChannelAccess,
  syncAllMediaToGoogleDrive,
  buildPrivateReviewCard,
  buildRegistrationEditModal,
  pendingPromptMessages,
  deleteRegistrationPromptMessage,
  logError,
  logWarn
};
