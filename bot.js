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
const { generateCardHTML } = require('./card_template');

const PORT = process.env.PORT || 10000;

const SETTINGS_FILE = path.join(__dirname, 'settings.json');
function getSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    }
  } catch (e) {}
  return { current_semester: 'ภาคเรียนที่ 2 ปีการศึกษา 2569' };
}

function updateSemester(semester, userId) {
  const settings = getSettings();
  settings.current_semester = semester;
  settings.updated_by = userId;
  settings.updated_at = new Date().toISOString();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
  return settings;
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

client.on('error', err => {
  console.warn('[Discord Client Error]', err?.message || err);
});

process.on('unhandledRejection', reason => {
  console.warn('[Unhandled Rejection]', reason?.message || reason);
});

process.on('uncaughtException', err => {
  console.error('[Uncaught Exception]', err?.message || err);
});

const ROLE_IDS = {
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
    .setName('setup-lost-found')
    .setDescription('📦 ติดตั้งจุดรับแจ้งสิ่งของที่พบเจอ (Lost & Found Hub) (Admin)'),
  new SlashCommandBuilder()
    .setName('d-day')
    .setDescription('🚨 ปฏิบัติการ D-DAY: ล้างข้อมูลสารวัตรทุกนาย และเริ่มใหม่แต่ 0 ทุกช่องแชท (Admin Only)'),
  new SlashCommandBuilder()
    .setName('killfile')
    .setDescription('🗑️ ลบข้อมูลสิ่งของที่มีอยู่ในระบบของหายทั้งหมด เริ่มใหม่แต่ 0 (Admin Only)')
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

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('🌐 ตรวจสอบคลังของหาย (Web)')
      .setStyle(ButtonStyle.Link)
      .setURL(`${getWebDashboardUrl()}/lost-found`)
  );

  return await channel.send({ embeds: [embed], components: [row], files });
}

async function sendVerifyPanel(channel) {
  if (!channel) return null;
  const embed = new EmbedBuilder()
    .setTitle('🛡️ จุดลงทะเบียนและยืนยันตัวตนสารวัตรนักเรียน')
    .setDescription(
      'ยินดีต้อนรับสารวัตรนักเรียนโรงเรียนพระนารายณ์ทุกท่าน เข้าสู่ระบบบริหารงานดิจิทัล\n\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
      '📌 **ขั้นตอนการยืนยันตัวตน (3 ขั้นตอนง่ายๆ):**\n' +
      '1️⃣ **[เลือกชื่อของคุณ]** — ค้นหาชื่อ-นามสกุลจากฐานข้อมูล หรือกดขอเพิ่มชื่อใหม่\n' +
      '2️⃣ **[เลือกรอบเวร]** — กำหนดวันปฏิบัติหน้าที่หลัก (จันทร์-ศุกร์) หรือเวรพิเศษ (S)\n' +
      '3️⃣ **[รอการอนุมัติ]** — ส่งคำขอให้คณะผู้บริหารตรวจสอบ บอทจะมอบยศและตั้งชื่อให้อัตโนมัติ\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
      '👉 *กดปุ่ม **"🛡️ เริ่มต้นยืนยันตัวตน"** ด้านล่างเพื่อเริ่มทำรายการทันที*'
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
      .setLabel('🛡️ เริ่มต้นยืนยันตัวตน')
      .setStyle(ButtonStyle.Primary)
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
  if (channel.name && channel.name.includes('บริการเวรและใบเช็คชื่อ')) {
    await channel.setName('📑│บริการ').catch(() => {});
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
      .setCustomId('btn_request_attendance')
      .setLabel('📄 ขอใบเช็คชื่อ A4')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('btn_request_leave')
      .setLabel('📝 แจ้งขอลาเวร')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('btn_request_inspection')
      .setLabel('🚨 ขอออกปฏิบัติหน้าที่')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setLabel('🌐 เข้าสู่เว็บไซต์ระบบ')
      .setStyle(ButtonStyle.Link)
      .setURL(getWebDashboardUrl())
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
      'แต่งตั้งตำแหน่ง **ประธาน**, **รองประธาน**, **หัวหน้าเวร** หรือ **รองหัวหน้าเวร**\n' +
      'ระบบจะอัปเดตบทบาทในฐานข้อมูล และแจก/ปรับยศใน Discord ให้อัตโนมัติทันที\n\n' +
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
      .setCustomId('btn_inspect_roster')
      .setLabel('👥 ตรวจสอบทำเนียบสารวัตร')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_set_semester')
      .setLabel('🎓 กำหนดภาคเรียน')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setLabel('🌐 เข้าสู่ระบบแดชบอร์ด (Web)')
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
    const chVerify = findChannel(guild, '🛡️│ยืนยันตัวตน') || guild.channels.cache.find(c => c.name.includes('ยืนยันตัวตน'));
    const chPhoto = findChannel(guild, process.env.PHOTO_CHANNEL_ID) || guild.channels.cache.find(c => c.name.includes('อัปโหลดรูปโปรไฟล์'));
    const chAttendance = findChannel(guild, process.env.ATTENDANCE_CHANNEL_ID) ||
      findChannel(guild, '📑│บริการ') ||
      findChannel(guild, 'บริการ') ||
      guild.channels.cache.find(c => c.name.includes('บริการ'));
    if (chAttendance && chAttendance.name.includes('บริการเวรและใบเช็คชื่อ')) {
      await chAttendance.setName('📑│บริการ').catch(() => {});
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

    if (chPhoto) {
      if (options.purge) await purgeChannelMessages(chPhoto);
      await sendPhotoPanel(chPhoto);
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
 * 📅 ดึงรหัสเวรที่ต้องปฏิบัติหน้าที่สำหรับวันนี้
 */
function getTodayDutyCodes() {
  const dayNum = new Date().getDay(); // 0 = Sun, 1 = Mon, ..., 5 = Fri, 6 = Sat
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
 * 🔔 ระบบส่งแจ้งเตือนส่วนตัวว่า "วันนี้เป็นเวรของคุณ" พร้อมปุ่มกดขอลาเวรด่วน
 */
async function sendDailyDutyReminders(guild, options = { dryRun: false, forceDay: null }) {
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
    day: 'numeric'
  });

  let sentCount = 0;
  const errors = [];

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
        }
      } catch (err) {
        errors.push(`${m.nickname}: ${err.message}`);
      }
    } else {
      sentCount++;
    }
  }

  return {
    success: true,
    count: sentCount,
    totalTargeted: members.length,
    codes: targetCodes,
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
      { key: 'SERVICE', name: process.env.ATTENDANCE_CHANNEL_ID || '📑│บริการ' },
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
  const dayName = new Date().toLocaleDateString('th-TH', { weekday: 'long' });
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
      const chVerify = findChannel(guild, '🛡️│ยืนยันตัวตน') || guild.channels.cache.find(c => c.name.includes('ยืนยันตัวตน'));
      const chPhoto = findChannel(guild, process.env.PHOTO_CHANNEL_ID) || guild.channels.cache.find(c => c.name.includes('อัปโหลดรูปโปรไฟล์'));
      const chAttendance = findChannel(guild, process.env.ATTENDANCE_CHANNEL_ID) ||
        findChannel(guild, '📑│บริการ') ||
        findChannel(guild, 'บริการ') ||
        guild.channels.cache.find(c => c.name.includes('บริการ'));
      if (chAttendance && chAttendance.name.includes('บริการเวรและใบเช็คชื่อ')) {
        await chAttendance.setName('📑│บริการ').catch(() => {});
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

      if (chPhoto) {
        await purgeChannelMessages(chPhoto);
        await sendPhotoPanel(chPhoto);
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

  // ⏰ ระบบแจ้งเตือนเวรประจำวันอัตโนมัติ (Daily Duty Reminder) เวลา 06:30 น.
  let lastReminderDate = '';
  const reminderTimer = setInterval(async () => {
    try {
      const now = new Date();
      const thaiTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));
      const hours = thaiTime.getUTCHours();
      const minutes = thaiTime.getUTCMinutes();
      const todayKey = thaiTime.toISOString().slice(0, 10);

      if (hours === 6 && minutes >= 30 && lastReminderDate !== todayKey) {
        lastReminderDate = todayKey;
        const targetGuild = client.guilds.cache.get(process.env.GUILD_ID) || client.guilds.cache.first();
        if (targetGuild) {
          console.log(`[SCHEDULE] ⏰ เริ่มส่งข้อความแจ้งเตือนเวรประจำวันอัตโนมัติ (${todayKey})`);
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
  // ตรวจจับการส่งไฟล์คลิป Bodycam หรือภาพถ่ายหลักฐานพร้อมระบุรหัสคดี (เช่น CASE-1234)
  if (message.attachments.size > 0 && !message.author.bot) {
    const match = message.content.match(/CASE-\d+/i);
    if (match) {
      const caseId = match[0].toUpperCase();
      const urls = message.attachments.map(att => att.url);
      const { data: c } = await supabase.from('cases').select('evidence_urls, resolution_notes').eq('case_id', caseId).maybeSingle();
      if (c) {
        const merged = [...(c.evidence_urls || []), ...urls];
        await supabase.from('cases').update({
          evidence_urls: merged,
          resolution_notes: (c.resolution_notes ? c.resolution_notes + '\n' : '') + `[แนบไฟล์ทาง Discord]: ${urls.join(' , ')}`
        }).eq('case_id', caseId);
        await message.reply({ content: `✅ บันทึกไฟล์หลักฐาน/คลิป Bodycam จำนวน ${urls.length} ไฟล์ เข้าคดี **${caseId}** สำเร็จแล้ว!` }).catch(() => {});
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

  // ฟังก์ชันดักรับรูปโปรไฟล์ทำบัตรในห้อง #อัปโหลดรูปโปรไฟล์-ทำบัตร
  const isVaultChannel = message.channel && message.channel.name && (
    message.channel.name === PHOTO_VAULT_CHANNEL_NAME ||
    message.channel.name.includes('คลังเก็บรูปสำรอง')
  );
  if (isVaultChannel) return;

  const isPhotoChannel = (PHOTO_CHANNEL_ID && message.channel.id === PHOTO_CHANNEL_ID) ||
    (message.channel.id === '1567570866663989389') ||
    (message.channel && message.channel.name && (
      message.channel.name.includes('รูป') ||
      message.channel.name.includes('photo') ||
      message.channel.name.includes('ทำบัตร')
    ));

  if (isPhotoChannel && !message.author.bot) {
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

          if (member) {
            // 1. ดาวน์โหลดไฟล์รูปภาพเข้าสู่ Memory Buffer ทันทีเพื่อป้องกันลิงก์ Discord หมดอายุ
            const imgRes = await fetch(attachment.url);
            if (!imgRes.ok) throw new Error(`Download attachment failed with status ${imgRes.status}`);
            const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

            const extMatch = (attachment.name || attachment.url).match(/\.(jpe?g|png|webp|gif|heic)/i);
            const ext = extMatch ? extMatch[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
            const safeDutyId = (member.duty_id || member.id || 'photo').replace(/[^a-zA-Z0-9_-]/g, '_');
            const filename = `member_${safeDutyId}_${Date.now()}.${ext}`;

            // 2. บันทึกสำเนาลง Local Storage สำหรับ Web Server
            const uploadDir = path.join(__dirname, '..', 'web', 'public', 'uploads');
            try {
              if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
              fs.writeFileSync(path.join(uploadDir, filename), imgBuffer);
            } catch (fsErr) {
              console.warn('[PHOTO UPLOAD] Local save notice:', fsErr.message);
            }

            // 3. อัปโหลดเข้าสู่ Supabase Storage (Bucket: sarawat-photos) เพื่อให้ได้ Public CDN URL ถาวร ไม่หมดอายุ
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

            // 4. สำรองไฟล์เข้าห้องคลังรูปสำรองลับของบอท (#📸│คลังเก็บรูปสำรอง-bot)
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

            // 5. บันทึก URL ที่เสถียรที่สุดเข้า Database (Supabase Public CDN > Vault URL > Local URL)
            const finalProfileUrl = permanentUrl || vaultAttachmentUrl || `/uploads/${filename}`;

            await supabase
              .from('members')
              .update({ profile_image_url: finalProfileUrl, updated_at: new Date() })
              .eq('id', member.id);

            const shiftLabel = getShiftLabel(member.duty_day);
            const dutyTag = member.duty_id ? `\`[${member.duty_id}]\`` : '`[รออนุมัติ]`';
            const cardUrl = `${getBaseUrl()}/card?id=${member.id}`;
            const cardRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setLabel('🪪 เปิดดูบัตรประจำตัว')
                .setStyle(ButtonStyle.Link)
                .setURL(cardUrl)
            );

            const successEmbed = new EmbedBuilder()
              .setTitle('📸 บันทึกรูปถ่ายทำบัตรสำเร็จ')
              .setDescription(
                `สมาชิก: **${member.first_name} ${member.last_name} (${member.nickname})**\n` +
                `ชั้น: ม.${member.grade_class} #${member.student_no} • รหัสเวร: ${dutyTag} • เวร: ${shiftLabel}\n\n` +
                `✅ บันทึกรูปถ่ายต้นฉบับเข้าคลังเก็บรูปสำรองบอท และอัปเดตระบบทำบัตรสารวัตรเรียบร้อยแล้ว`
              )
              .setImage(finalProfileUrl.startsWith('http') ? finalProfileUrl : attachment.url)
              .setColor('#2ECC71');

            await message.reply({ embeds: [successEmbed], components: [cardRow] }).catch(() => {});
            return;
          } else {
            await message.reply({
              content: `⚠️ <@${message.author.id}> ไม่พบข้อมูลในระบบ: กรุณายืนยันตัวตนที่ห้อง **#🛡️│ยืนยันตัวตน** ก่อนส่งรูป`
            }).catch(() => {});
            return;
          }
        } catch (err) {
          console.error('[PHOTO UPLOAD ERROR]:', err);
        }
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
        const sem = getSettings().current_semester;
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('btn_set_semester')
            .setLabel('🎓 กำหนดภาคเรียนใหม่')
            .setStyle(ButtonStyle.Primary)
        );
        await interaction.reply({
          content: `🎓 **ภาคเรียนปัจจุบัน:** \`${sem}\` (กำหนดโดยประธานสารวัตรนักเรียน)`,
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
          await interaction.editReply({ content: `✅ ซิงค์ยศและชื่อเรียบร้อย: สำเร็จ ${res.successCount} คน` });
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
        await interaction.reply({ content: '✅ ติดตั้งแผงจุดรับแจ้งของหายเรียบร้อยแล้ว', ephemeral: true });
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
                       interaction.member.roles.cache.has(ROLE_IDS.PRESIDENT) ||
                       interaction.member.roles.cache.has(ROLE_IDS.VICE_PRESIDENT);

      if (!isLeader) {
        await interaction.reply({
          content: '⛔ สงวนสิทธิ์เฉพาะ **ประธานสารวัตรนักเรียน** เท่านั้นในการกำหนดภาคเรียน',
          ephemeral: true
        });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId('modal_set_semester')
        .setTitle('🎓 กำหนดภาคเรียนปัจจุบัน');

      const semInput = new TextInputBuilder()
        .setCustomId('input_semester')
        .setLabel('ภาคเรียน (เช่น ภาคเรียนที่ 1 ปีการศึกษา 2569)')
        .setValue(getSettings().current_semester)
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(semInput));
      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'modal_set_semester') {
      const newSemester = interaction.fields.getTextInputValue('input_semester').trim();
      updateSemester(newSemester, interaction.user.id);

      await interaction.reply({
        content: `✅ **บันทึกภาคเรียนสำเร็จ!**\nขณะนี้ระบบถูกกำหนดเป็น: **${newSemester}**`,
        ephemeral: true
      });

      const chAnnounce = interaction.guild.channels.cache.find(c => c.name.includes('ประกาศและมอบหมายงาน'));
      const leaderRoom = interaction.guild.channels.cache.find(c => c.name.includes('ห้องประชุมหัวหน้า'));

      const announceEmbed = new EmbedBuilder()
        .setTitle('🎓 ประกาศภาคเรียนปฏิบัติหน้าที่')
        .setDescription(
          `ประธานสารวัตรนักเรียน <@${interaction.user.id}> ได้กำหนดภาคเรียนปัจจุบัน:\n\n` +
          `🌟 **${newSemester}**\n\n` +
          `*แบบบันทึกการลงเวลา A4 และระบบสารวัตรทั้งหมดจะอัปเดตเป็นภาคเรียนนี้อัตโนมัติ*`
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

    // 1. ยืนยันตัวตน
    if (interaction.isButton() && interaction.customId === 'btn_start_verify') {
      await interaction.deferReply({ ephemeral: true });

      // ตรวจสอบว่าบัญชีนี้ได้รับการอนุมัติเป็นสารวัตรอยู่แล้วหรือไม่
      const { data: existingActive } = await supabase
        .from('members')
        .select('*')
        .eq('discord_id', interaction.user.id)
        .eq('status', 'ACTIVE')
        .maybeSingle();

      if (existingActive) {
        const shiftLabel = getShiftLabel(existingActive.duty_day);
        await interaction.editReply({
          content: `✅ คุณได้รับการยืนยันตัวตนและอนุมัติเป็นสารวัตรนักเรียนแล้ว:\n` +
                   `• ชื่อ: ${existingActive.first_name} ${existingActive.last_name} (${existingActive.nickname})\n` +
                   `• รหัสเวร: \`[${existingActive.duty_id || '-'}]\`\n` +
                   `• เวร: ${shiftLabel}\n` +
                   `• ตำแหน่ง: ${existingActive.shift_role === 'SHIFT_HEAD' ? 'หัวหน้าเวร' : (existingActive.shift_role === 'SHIFT_DEPUTY' ? 'รองหัวหน้าเวร' : 'สารวัตรประจำเวร')}\n\n` +
                   `*(หากต้องการส่งรูปโปรไฟล์ทำบัตร ให้ไปที่ห้อง <#${PHOTO_CHANNEL_ID || '1567570866663989389'}> ได้เลยครับ)*`
        });
        return;
      }

      const { data: members } = await supabase
        .from('members')
        .select('id, first_name, last_name, nickname, grade_class, student_no, phone_number')
        .is('discord_id', null)
        .order('grade_class', { ascending: true });

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_member_identity')
        .setPlaceholder('🔍 ค้นหาและเลือกชื่อของคุณจากรายชื่อ');

      selectMenu.addOptions({
        label: '➕ ขอเพิ่มชื่อใหม่ (ไม่มีชื่อในระบบ)',
        description: 'กดเพื่อกรอก ชื่อ-นามสกุล, ชื่อเล่น, ชั้น, เลขที่ และเบอร์โทร',
        value: 'action_add_new_member'
      });

      (members || []).slice(0, 24).forEach(m => {
        selectMenu.addOptions({
          label: `${m.nickname} — ${m.first_name} ${m.last_name}`,
          description: `ชั้น ม.${m.grade_class} เลขที่ #${m.student_no}`,
          value: m.id
        });
      });

      const row = new ActionRowBuilder().addComponents(selectMenu);
      const step1Embed = new EmbedBuilder()
        .setTitle('🛡️ [ขั้นตอนที่ 1/3] ค้นหาและเลือกชื่อของคุณ')
        .setColor('#3498DB')
        .setDescription(
          'โปรดค้นหาและเลือกชื่อของคุณจากเมนูด้านล่างนี้\n' +
          '*(หากไม่มีชื่อของคุณในระบบ ให้กดเลือก **"➕ ขอเพิ่มชื่อใหม่"**)*'
        );

      await interaction.editReply({
        embeds: [step1Embed],
        components: [row]
      });
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
      const rawFullName = interaction.fields.getTextInputValue('input_full_name').trim();
      const nickname = interaction.fields.getTextInputValue('input_nickname').trim();
      const rawClass = interaction.fields.getTextInputValue('input_class').trim();
      const studentNo = parseInt(interaction.fields.getTextInputValue('input_no').trim(), 10) || 0;
      const phone = interaction.fields.getTextInputValue('input_phone').trim();

      // 1. ตรวจสอบและจัดระเบียบคำนำหน้าชื่อจริง (ต้องขึ้นต้นด้วย นาย/นาง/นางสาว ติดกับชื่อจริงเลย)
      const cleanedFullName = cleanFullName(rawFullName);
      if (!/^(นาย|นางสาว|นาง|ด\.ช\.|ด\.ญ\.)/.test(cleanedFullName)) {
        await interaction.reply({
          content: '❌ **ข้อมูลชื่อจริงไม่ถูกต้อง:** ต้องขึ้นต้นด้วยคำนำหน้า **นาย**, **นาง** หรือ **นางสาว** ติดกับชื่อจริงเลย\n*(ตัวอย่างที่ถูกต้อง: `นายสมชาย ใจดี` หรือ `นางสาวสมหญิง รักเรียน`)*',
          ephemeral: true
        });
        return;
      }

      // 2. จัดรูปแบบระดับชั้น (ตัด "ม." ออก เอาเฉพาะ เลข/เลข เช่น 6/7, 4/10)
      const cleanedGradeClass = cleanGradeClass(rawClass);
      if (!cleanedGradeClass || !/^[1-6]\/[0-9]+$/.test(cleanedGradeClass)) {
        await interaction.reply({
          content: '❌ **ข้อมูลระดับชั้นไม่ถูกต้อง:** กรุณาระบุเฉพาะเลขชั้น/ห้อง เช่น `6/7`, `4/10`, `5/2` *(ไม่ต้องใส่ "ม.")*',
          ephemeral: true
        });
        return;
      }

      const nameParts = cleanedFullName.split(' ');
      const firstName = nameParts[0] || cleanedFullName;
      const lastName = nameParts.slice(1).join(' ') || '-';

      const { data: newMember, error } = await supabase
        .from('members')
        .insert({
          first_name: firstName,
          last_name: lastName,
          nickname: nickname,
          grade_class: cleanedGradeClass,
          student_no: studentNo,
          phone_number: phone,
          role: 'MEMBER',
          shift_role: 'MEMBER',
          status: 'PENDING_APPROVAL'
        })
        .select()
        .single();

      if (error) throw error;
      await showDutySelection(interaction, newMember.id, nickname, `${firstName} ${lastName}`);
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

      const doneEmbed = new EmbedBuilder()
        .setTitle('✅ [ขั้นตอนที่ 3/3] ส่งคำขอลงทะเบียนเรียบร้อยแล้ว')
        .setColor('#2ECC71')
        .setDescription(
          `ระบบได้บันทึกและส่งข้อมูลคำขอของคุณไปยังห้องตรวจสอบของคณะผู้บริหารแล้ว\n\n` +
          `👤 **ผู้ลงทะเบียน:** ${member.first_name} ${member.last_name} (**${member.nickname}**)\n` +
          `📅 **รอบการปฏิบัติหน้าที่:** **${shiftLabel}**\n` +
          `⏳ **สถานะ:** **รอการอนุมัติจากผู้บริหาร (PENDING APPROVAL)**\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `🔹 **สถานะขั้นตอน:** 🟩🟩🟩 (ส่งคำขอสำเร็จ)\n` +
          `💡 *เมื่อผู้บริหารกดอนุมัติ ระบบจะมอบยศ Discord และส่งข้อความแจ้งเตือนทาง DM ทันที*`
        );

      await interaction.editReply({
        embeds: [doneEmbed],
        content: null,
        components: []
      });

      // ค้นหาห้องอนุมัติ: 1. จาก APPROVAL_CHANNEL_ID 2. fallback ID 3. ค้นหาอัตโนมัติจากชื่อห้อง 'อนุมัติ' ใน Server
      let approvalChannel = null;
      const targetApprovalId = APPROVAL_CHANNEL_ID || '1567570916932722778';
      approvalChannel = await client.channels.fetch(targetApprovalId).catch(() => null);

      if (!approvalChannel && interaction.guild) {
        approvalChannel = interaction.guild.channels.cache.find(c =>
          c.isTextBased() && (c.name.includes('อนุมัติ') || c.name.toLowerCase().includes('approval'))
        ) || null;
      }

      if (approvalChannel) {
        const weekdayName = DAY_NAMES[weekday] || weekday;
        const approvalEmbed = new EmbedBuilder()
          .setTitle('📋 คำขอลงทะเบียนสารวัตรใหม่ [รอการตรวจสอบ]')
          .setDescription(
            `มีสารวัตรนักเรียนทำรายการลงทะเบียนเข้ามาใหม่ โปรดตรวจสอบและดำเนินการ\n\n` +
            `👤 **ชื่อ-สกุล:** ${member.first_name} ${member.last_name} (**${member.nickname}**)\n` +
            `🏫 **ชั้นเรียน:** ม.${member.grade_class} (เลขที่ ${member.student_no})\n` +
            `📞 **เบอร์โทรศัพท์:** \`${member.phone_number || '-'}\`\n` +
            `📅 **เวรประจำวัน:** วัน${weekdayName} (\`${weekday}\`)\n` +
            `⭐ **ลักษณะเวร:** ${isSpecial ? `⭐ **เวรพิเศษ (ทุกวัน)** [ผลัด \`${effectiveDutyDay}\`]` : `👤 เวรเฉพาะวัน [ผลัด \`${effectiveDutyDay}\`]`}\n` +
            `🏷️ **ผลัดเวรสุทธิ:** **${shiftLabel}**\n` +
            `💬 **บัญชี Discord:** <@${interaction.user.id}> (\`${interaction.user.tag}\`)`
          )
          .setColor(isSpecial ? '#9B59B6' : '#F39C12')
          .setFooter({ text: 'ระบบลงทะเบียนสารวัตร • โรงเรียนพระนารายณ์' })
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
      } else {
        console.warn('[APPROVAL WARNING] Could not find approval channel. Checked ID:', targetApprovalId);
      }
      return;
    }

    // 3. จัดการการอนุมัติโดยผู้บริหาร + แจกยศหัวหน้า/รองหัวหน้าเวรเฉพาะวัน
    if (interaction.isButton() && (interaction.customId.startsWith('btn_approve_member_') || interaction.customId.startsWith('btn_reject_member_'))) {
      const isLeader = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
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

        const effectiveDutyDay = dutyDay || 'M';
        const dutyId = await getNextAvailableDutyId(supabase, effectiveDutyDay);

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
                const newNickname = `[${dutyId}] ${member.nickname} (${member.first_name})`;
                await guildMember.setNickname(newNickname.slice(0, 32)).catch((err) => {
                  console.warn('Cannot set nickname (likely Server Owner):', err.message);
                });
              }

              const rolesToAdd = [ROLE_IDS.VERIFIED, ...getDutyRoles(member.duty_day)];
              if (member.role === 'PRESIDENT' && ROLE_IDS.PRESIDENT) rolesToAdd.push(ROLE_IDS.PRESIDENT);
              if (member.role === 'VICE_PRESIDENT' && ROLE_IDS.VICE_PRESIDENT) rolesToAdd.push(ROLE_IDS.VICE_PRESIDENT);
              
              // แจกยศหัวหน้าเวร / รองหัวหน้าเวรประจำวันนั้นๆ
              const baseDay = member.duty_day === 'TSS' ? 'Ts' : member.duty_day.replace(/S+$/, '');
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
              const dmEmbed = new EmbedBuilder()
                .setTitle('🎉 ยินดีด้วย! คำขอลงทะเบียนได้รับการอนุมัติแล้ว')
                .setColor('#2ECC71')
                .setDescription(
                  `คุณได้รับการอนุมัติเป็นสารวัตรนักเรียนโรงเรียนพระนารายณ์เรียบร้อยแล้ว\n\n` +
                  `🆔 **รหัสประจำตัว:** \`[${dutyId}]\`\n` +
                  `👤 **ชื่อเล่น:** คุณ**${member.nickname}** (${member.first_name})\n` +
                  `📅 **รอบการปฏิบัติหน้าที่:** **${shiftLabel}**\n\n` +
                  `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                  `📸 **ขั้นตอนถัดไป:**\n` +
                  `โปรดเข้าไปที่ห้อง <#${PHOTO_CHANNEL_ID || '1567570866663989389'}> เพื่อส่งรูปถ่ายหน้าตรงของคุณสำหรับจัดทำบัตรประจำตัวสารวัตรดิจิทัล 3D`
                )
                .setFooter({ text: 'คณะกรรมการสารวัตรนักเรียน โรงเรียนพระนารายณ์' });

              await guildMember.send({ embeds: [dmEmbed] }).catch(() => {});
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
        const { data: member } = await supabase.from('members').select('*').eq('id', memberId).single();

        await supabase.from('members').update({ status: 'REJECTED' }).eq('id', memberId);

        if (member.discord_id) {
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
          .setTitle('📄 ตารางเช็คชื่อ: รวมทุกรอบเวร (M, T, W, Ts, F, S)')
          .setDescription(
            `เวร: รวมทุกรอบเวร (6 รอบเวร)\n` +
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
            .setURL(onlineUrl)
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
          { label: '📑 ขอรวม (ทุกรอบเวร M, T, W, Ts, F, S)', value: 'ALL', description: 'รวมสมาชิกทุกรอบเวรในเอกสารเดียว', emoji: '📑' },
          { label: 'วันจันทร์ (M)', value: 'M', description: 'ใบเช็คชื่อสารวัตรเวรวันจันทร์', emoji: '🔵' },
          { label: 'วันอังคาร (T)', value: 'T', description: 'ใบเช็คชื่อสารวัตรเวรวันอังคาร', emoji: '🟣' },
          { label: 'วันพุธ (W)', value: 'W', description: 'ใบเช็คชื่อสารวัตรเวรวันพุธ', emoji: '🟢' },
          { label: 'วันพฤหัสบดี (Ts)', value: 'Ts', description: 'ใบเช็คชื่อสารวัตรเวรวันพฤหัสบดี', emoji: '🟠' },
          { label: 'วันศุกร์ (F)', value: 'F', description: 'ใบเช็คชื่อสารวัตรเวรวันศุกร์', emoji: '🔴' },
          { label: 'เวรพิเศษทุกวัน (S)', value: 'S', description: 'ใบเช็คชื่อสารวัตรเวรพิเศษ (มาทุกวัน)', emoji: '⭐' }
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
          .setTitle('📄 ตารางเช็คชื่อ: รวมทุกรอบเวร (M, T, W, Ts, F, S)')
          .setDescription(
            `เวร: รวมทุกรอบเวร (6 รอบเวร)\n` +
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
            .setURL(onlineUrl)
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
          .setURL(onlineUrl)
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

      const { data: heads } = await supabase
        .from('members')
        .select('*')
        .eq('duty_day', member.duty_day)
        .in('shift_role', ['SHIFT_HEAD', 'SHIFT_DEPUTY'])
        .not('discord_id', 'is', null)
        .eq('status', 'ACTIVE');

      const dmEmbed = new EmbedBuilder()
        .setTitle('🔔 [แจ้งเตือนการลาเวร] มีสมาชิกขอลาเวร')
        .setColor('#E74C3C')
        .setDescription(
          `# 🔔 มีสารวัตรแจ้งขอลาเวรด่วน\n\n` +
          `### 👮 [${member.duty_id || 'สารวัตร'}] คุณ${member.nickname} (${member.first_name} ${member.last_name})\n` +
          `🏷️ **ประเภทการลา:** **${leaveType}**\n` +
          `📅 **วันที่ขอลา:** ${leaveDate} (${shiftPeriod})\n` +
          `📝 **หมายเหตุ:** ${reason}\n` +
          `🔄 **ผู้เข้าเวรแทน:** ${substitute}\n` +
          `📞 **เบอร์โทรติดต่อ:** ${member.phone_number || '-'}`
        )
        .setFooter({ text: `เวร${DAY_NAMES[member.duty_day] || member.duty_day} • โรงเรียนพระนารายณ์` });

      let dmSentCount = 0;
      if (heads && heads.length > 0) {
        for (const head of heads) {
          try {
            const user = await client.users.fetch(head.discord_id);
            await user.send({ embeds: [dmEmbed] });
            dmSentCount++;
          } catch (e) {}
        }
      }

      await interaction.editReply({
        content: `# ✅ ส่งคำขอลาเวรเรียบร้อยแล้ว\n` +
                 `- **ผู้ลา:** [${member.duty_id}] ${member.nickname} (${member.first_name})\n` +
                 `- **ประเภท:** ${leaveType}\n` +
                 `- **หมายเหตุ:** ${reason}\n` +
                 `📨 ส่งข้อความแจ้งเตือนหาหัวหน้าเวรและรองหัวหน้าเวรแล้ว (${dmSentCount} ท่าน)`
      });
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
      const baseDay = member.duty_day === 'TSS' ? 'Ts' : member.duty_day.replace(/S+$/, '');
      const targetDays = [member.duty_day, baseDay].filter(Boolean);
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

      if (action === 'APPOINT_PRESIDENT') {
        newRole = 'PRESIDENT';
        roleTitle = '👑 ประธานสารวัตรนักเรียน';
        addRoleId = ROLE_IDS.PRESIDENT;
        removeRoleIds = [ROLE_IDS.VICE_PRESIDENT, ...allHeadAndDeputyRoles].filter(Boolean);
      } else if (action === 'APPOINT_VICE_PRESIDENT') {
        newRole = 'VICE_PRESIDENT';
        roleTitle = '🎖️ รองประธานสารวัตรนักเรียน';
        addRoleId = ROLE_IDS.VICE_PRESIDENT;
        removeRoleIds = [ROLE_IDS.PRESIDENT, ...allHeadAndDeputyRoles].filter(Boolean);
      } else if (action === 'DEMOTE_MEMBER') {
        newRole = 'MEMBER';
        newShiftRole = 'MEMBER';
        roleTitle = '🛡️ สารวัตรนักเรียนทั่วไป';
        removeRoleIds = [
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

    // 9. ระบบลบข้อมูล / ถอดถอนสารวัตร (Remove Member / Leave Sarawat)
    if (interaction.isButton() && interaction.customId === 'btn_open_remove_member_menu') {
      const isLeadership = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
                           interaction.member.roles.cache.has(ROLE_IDS.PRESIDENT) ||
                           interaction.member.roles.cache.has(ROLE_IDS.VICE_PRESIDENT);

      if (!isLeadership) {
        await interaction.reply({
          content: 'ไม่มีสิทธิ์: เฉพาะประธานและผู้บริหาร',
          ephemeral: true
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const { data: members } = await supabase
        .from('members')
        .select('*')
        .eq('status', 'ACTIVE')
        .order('duty_day')
        .order('duty_id');

      if (!members || members.length === 0) {
        await interaction.editReply({
          content: 'ไม่มีข้อมูล: ยังไม่มีสารวัตรในระบบ'
        });
        return;
      }

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_remove_member_target')
        .setPlaceholder('เลือกสารวัตรที่ต้องการลบข้อมูล / ให้ออก');

      members.slice(0, 25).forEach(m => {
        const dayText = getDayName(m.duty_day);
        selectMenu.addOptions({
          label: `[${m.duty_id || '-'}] ${m.nickname} (${m.first_name} ${m.last_name})`,
          description: `${dayText} | ม.${m.grade_class} #${m.student_no}`,
          value: m.id
        });
      });

      const row = new ActionRowBuilder().addComponents(selectMenu);
      await interaction.editReply({
        content: 'เลือกสารวัตรที่ต้องการลบข้อมูล (ถอดถอนออกจากสารวัตร):',
        components: [row]
      });
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'select_remove_member_target') {
      const memberId = interaction.values[0];
      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).single();
      const dayText = getDayName(member.duty_day);

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`btn_confirm_remove_${member.id}`)
          .setLabel('ยืนยันลบข้อมูล')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('btn_cancel_remove')
          .setLabel('ยกเลิก')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.update({
        content: `ยืนยันลบข้อมูล\nชื่อ: [${member.duty_id || '-'}] ${member.nickname} (${member.first_name} ${member.last_name})\nชั้น: ม.${member.grade_class} #${member.student_no} | เวร: ${dayText}\n\nผล: ปลดรหัสเวร ${member.duty_id || ''}, ปลดยศทั้งหมด, คืนสล็อตเวรสู่ระบบ`,
        components: [confirmRow]
      });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('btn_confirm_remove_')) {
      await interaction.deferUpdate();
      const memberId = interaction.customId.replace('btn_confirm_remove_', '');
      const { data: member } = await supabase.from('members').select('*').eq('id', memberId).single();

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

      if (member.discord_id) {
        try {
          const guildMember = await interaction.guild.members.fetch(member.discord_id).catch(() => null);
          if (guildMember) {
            const rolesToRemove = [
              ROLE_IDS.VERIFIED,
              ROLE_IDS.PRESIDENT,
              ROLE_IDS.VICE_PRESIDENT,
              ROLE_IDS.DAYS[freedDay],
              ROLE_IDS.HEADS[freedDay],
              ROLE_IDS.DEPUTIES[freedDay]
            ].filter(Boolean);

            await guildMember.roles.remove(rolesToRemove).catch(() => {});
            if (ROLE_IDS.UNVERIFIED) await guildMember.roles.add(ROLE_IDS.UNVERIFIED).catch(() => {});

            if (guildMember.nickname && guildMember.nickname.startsWith('[')) {
              const cleanedNick = guildMember.nickname.replace(/^\[.*?\]\s*/, '');
              await guildMember.setNickname(cleanedNick.slice(0, 32)).catch(() => {});
            }
          }
        } catch (e) {
          console.warn('Error removing member roles:', e.message);
        }
      }

      await interaction.editReply({
        content: `ลบข้อมูลสำเร็จ\nชื่อ: ${member.first_name} (${member.nickname})\nสถานะ: พ้นสภาพสารวัตร\nคืนรหัส: ${freedDutyId || '-'} สู่ระบบแล้ว\nโดย: <@${interaction.user.id}>`,
        components: []
      });

      const leaderRoom = interaction.guild.channels.cache.find(c => c.name.includes('ผู้นำ-all-in-one') || c.name.includes('ห้องประชุมหัวหน้า'));
      if (leaderRoom) {
        const logEmbed = new EmbedBuilder()
          .setTitle('ถอดถอนสมาชิกสารวัตร')
          .setDescription(
            `ชื่อ: ${member.first_name} ${member.last_name} (${member.nickname})\n` +
            `รหัสเดิม: [${freedDutyId || '-'}]\n` +
            `สถานะ: พ้นสภาพสารวัตร | คืนรหัสเวรว่างสู่ระบบ\n` +
            `ผู้ดำเนินการ: <@${interaction.user.id}>`
          )
          .setColor('#E74C3C')
          .setTimestamp();

        await leaderRoom.send({ embeds: [logEmbed] }).catch(() => {});
      }
      return;
    }

    if (interaction.isButton() && interaction.customId === 'btn_cancel_remove') {
      await interaction.update({
        content: 'ยกเลิกรายการแล้ว',
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
      if (interaction.deferred) {
        await interaction.editReply({ content: 'ข้อผิดพลาด: ดำเนินการไม่สำเร็จ' }).catch(() => {});
      } else if (!interaction.replied) {
        await interaction.reply({ content: 'ข้อผิดพลาด: ดำเนินการไม่สำเร็จ', ephemeral: true }).catch(() => {});
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
      .setLabel('↩️ ย้อนกลับไปเลือกชื่อใหม่')
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

  if (interaction.isModalSubmit()) {
    await interaction.reply({ ...payload, ephemeral: true });
  } else if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
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

// ฟังก์ชันสร้างหน้าเว็บใบเช็คชื่อ A4 มาตรฐาน พร้อมระบุชื่อหัวหน้า/รองหัวหน้าบนหัวกระดาษ
function generateAttendanceSheetHTML(dayCode, dayName, members) {
  const head = members.find(m => m.shift_role === 'SHIFT_HEAD');
  const deputy = members.find(m => m.shift_role === 'SHIFT_DEPUTY');

  const headText = head ? `[${head.duty_id}] ${head.nickname} (${head.first_name} ${head.last_name})` : 'ยังไม่ได้แต่งตั้ง';
  const deputyText = deputy ? `[${deputy.duty_id}] ${deputy.nickname} (${deputy.first_name} ${deputy.last_name})` : 'ยังไม่ได้แต่งตั้ง';
  const logoBase64 = getSarawatLogoBase64();
  const englishDay = getEnglishDayName(dayCode);
  const isSpecial = dayCode === 'S';
  const dates = getAttendanceDates(dayCode, 12);

  const tableColspanHeader = isSpecial 
    ? 'บันทึกการมาปฏิบัติหน้าที่ (สัปดาห์ที่ 1 ถึง 12)' 
    : 'บันทึกการมาปฏิบัติหน้าที่ (เดือน/วัน)';
  const dateHeaders = isSpecial
    ? Array.from({ length: 12 }).map((_, i) => `<th style="width: 27px; font-size: 10px;">ส.${i + 1}</th>`).join('')
    : dates.map(d => `<th style="width: 27px; font-size: 10px; cursor: pointer;" contenteditable="true" title="คลิกเพื่อแก้ไขวันที่">${d}</th>`).join('');

  const rows = members.map((m, idx) => {
    const roleTag = m.shift_role === 'SHIFT_HEAD' ? ' <span style="color:#d35400; font-size:10px;">(หัวหน้า)</span>' : (m.shift_role === 'SHIFT_DEPUTY' ? ' <span style="color:#27ae60; font-size:10px;">(รอง)</span>' : '');
    return `
      <tr>
        <td style="text-align: center; font-weight: bold;">${idx + 1}</td>
        <td style="font-weight: bold; color: #1a5276;">[${m.duty_id || '-'}] ${m.nickname}${roleTag}</td>
        <td>${m.first_name} ${m.last_name}</td>
        <td style="text-align: center;">${m.grade_class} (${m.student_no})</td>
        ${Array.from({ length: 12 }).map(() => '<td style="text-align: center; width: 28px; height: 26px;">&nbsp;</td>').join('')}
        <td style="text-align: center;">&nbsp;</td>
        <td>&nbsp;</td>
      </tr>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <title>ใบเช็คชื่อ - ${dayName} (${dayCode})</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Chakra+Petch:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500;1,600;1,700&family=Rubik:ital,wght@0,300..900;1,300..900&family=Zen+Antique&display=swap" rel="stylesheet">
  <style>
    @page {
      size: A4 landscape;
      margin: 10mm 10mm;
    }
    body {
      font-family: 'Sarabun', 'TH Sarabun New', sans-serif;
      margin: 0;
      padding: 10px 15px;
      color: #111;
      font-size: 13px;
      position: relative;
    }
    .sheet-corner-tag {
      position: absolute;
      top: 10px;
      right: 15px;
      text-align: right;
      border: 1.5px solid #1a5276;
      border-radius: 6px;
      padding: 4px 10px;
      background-color: #f8fafc;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .sheet-corner-tag .tag-english {
      font-family: 'Bebas Neue', 'Chakra Petch', 'Rubik', sans-serif;
      font-size: 22px;
      font-weight: 400;
      color: #1a5276;
      letter-spacing: 1.5px;
      line-height: 1;
    }
    .sheet-corner-tag .tag-code {
      font-family: 'Chakra Petch', monospace;
      font-size: 11px;
      font-weight: 700;
      color: #d35400;
      line-height: 1.1;
    }
    .header {
      margin-bottom: 8px;
      padding-right: 110px;
      padding-left: 20px;
    }
    .header-content {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
    }
    .sarawat-logo {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      object-fit: cover;
      border: 2px solid #1a5276;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      flex-shrink: 0;
    }
    .header-titles {
      text-align: center;
    }
    .title {
      font-family: 'Chakra Petch', 'Sarabun', sans-serif;
      font-size: 22px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 2px;
      letter-spacing: 0.5px;
    }
    .subtitle {
      font-size: 13px;
      color: #1e3a8a;
      font-weight: 600;
      margin-bottom: 2px;
    }
    .sub-meta {
      font-size: 11.5px;
      color: #475569;
    }
    .leadership-bar {
      background-color: #f8f9f9;
      border: 1px solid #d5dbdb;
      padding: 5px 12px;
      border-radius: 4px;
      margin-bottom: 8px;
      display: flex;
      justify-content: space-around;
      font-size: 13px;
      font-weight: bold;
    }
    .meta-box {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 12px;
      color: #444;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 12px;
    }
    th, td {
      border: 1px solid #333;
      padding: 5px 4px;
      font-size: 12px;
    }
    th {
      background-color: #eaecee;
      text-align: center;
      font-weight: bold;
    }
    th[contenteditable]:hover {
      background-color: #fef3c7;
    }
    .footer {
      display: flex;
      justify-content: space-around;
      margin-top: 18px;
      font-size: 13px;
      text-align: center;
    }
    .sig-line {
      margin-top: 28px;
      border-bottom: 1px dotted #333;
      width: 190px;
      display: inline-block;
    }
    @media print {
      .no-print { display: none; }
      body { padding: 0; }
      th[contenteditable] { outline: none; }
    }
    .btn-print {
      background-color: #27ae60;
      color: white;
      border: none;
      padding: 8px 16px;
      font-size: 14px;
      border-radius: 4px;
      cursor: pointer;
      margin-bottom: 10px;
    }
  </style>
</head>
<body>
  <div class="sheet-corner-tag">
    <div class="tag-english">${englishDay}</div>
    <div class="tag-code">[${dayCode}]</div>
  </div>

  <div class="no-print" style="text-align: right;">
    <button class="btn-print" onclick="window.print()">สั่งพิมพ์เอกสารนี้ (Print A4)</button>
  </div>

  <div class="header">
    <div class="header-content">
      ${logoBase64 ? `<img src="${logoBase64}" class="sarawat-logo" alt="ตราสารวัตรนักเรียน โรงเรียนพระนารายณ์">` : ''}
      <div class="header-titles">
        <div class="title">ใบเช็คชื่อ</div>
        <div class="subtitle">กลุ่มงานกิจการนักเรียน • ฝ่ายสารวัตรนักเรียน</div>
        <div class="sub-meta">โรงเรียนพระนารายณ์ • ภาคเรียนที่ ..... / ปีการศึกษา 2569 • ประจำเดือน .................... • ไตรมาสที่ ........</div>
      </div>
    </div>
  </div>

  <div class="leadership-bar">
    <span><strong>หัวหน้าเวร:</strong> ${headText}</span>
    <span><strong>รองหัวหน้าเวร:</strong> ${deputyText}</span>
  </div>

  <div class="meta-box">
    <span><strong>รอบเวร:</strong> ${dayName} (${dayCode})</span>
    <span><strong>จำนวนสมาชิกในเวร:</strong> ${members.length} นาย</span>
  </div>

  <table>
    <thead>
      <tr>
        <th rowspan="2" style="width: 30px;">ลำดับ</th>
        <th rowspan="2" style="width: 100px;">รหัสเวร+ชื่อเล่น</th>
        <th rowspan="2" style="width: 145px;">ชื่อ - สกุลจริง</th>
        <th rowspan="2" style="width: 80px;">ชั้น (เลขที่)</th>
        <th colspan="12">${tableColspanHeader}</th>
        <th rowspan="2" style="width: 48px;">รวมมา</th>
        <th rowspan="2" style="width: 80px;">หมายเหตุ</th>
      </tr>
      <tr>
        ${dateHeaders}
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  <div class="footer">
    <div>
      ลงชื่อ<span class="sig-line"></span><br>
      ( ${head ? `${head.first_name} ${head.last_name}` : '......................................................'} )<br>
      หัวหน้า${dayName}
    </div>
    <div>
      ลงชื่อ<span class="sig-line"></span><br>
      (......................................................)<br>
      ประธานสารวัตรนักเรียน
    </div>
    <div>
      ลงชื่อ<span class="sig-line"></span><br>
      (......................................................)<br>
      ครูหัวหน้าสารวัตรนักเรียน
    </div>
  </div>
</body>
</html>`;
}

function generateCombinedAttendanceSheetHTML(allMembers) {
  const logoBase64 = getSarawatLogoBase64();
  const shifts = [
    { code: 'M', name: 'เวรวันจันทร์' },
    { code: 'T', name: 'เวรวันอังคาร' },
    { code: 'W', name: 'เวรวันพุธ' },
    { code: 'Ts', name: 'เวรวันพฤหัสบดี' },
    { code: 'F', name: 'เวรวันศุกร์' },
    { code: 'S', name: 'เวรพิเศษ (ทุกวัน)' }
  ];

  const sectionsHtml = shifts.map(shift => {
    const shiftMembers = allMembers.filter(m => {
      if (shift.code === 'S') return m.duty_day === 'S' || (m.duty_day && m.duty_day.endsWith('S'));
      const combinedCode = shift.code === 'Ts' ? 'TSS' : `${shift.code}S`;
      return m.duty_day === shift.code || m.duty_day === combinedCode;
    });

    const head = shiftMembers.find(m => m.shift_role === 'SHIFT_HEAD');
    const deputy = shiftMembers.find(m => m.shift_role === 'SHIFT_DEPUTY');

    const headText = head ? `[${head.duty_id}] ${head.nickname} (${head.first_name} ${head.last_name})` : 'ยังไม่ได้แต่งตั้ง';
    const deputyText = deputy ? `[${deputy.duty_id}] ${deputy.nickname} (${deputy.first_name} ${deputy.last_name})` : 'ยังไม่ได้แต่งตั้ง';
    const englishDay = getEnglishDayName(shift.code);
    const isSpecial = shift.code === 'S';
    const dates = getAttendanceDates(shift.code, 12);

    const tableColspanHeader = isSpecial 
      ? 'บันทึกการมาปฏิบัติหน้าที่ (สัปดาห์ที่ 1 ถึง 12)' 
      : 'บันทึกการมาปฏิบัติหน้าที่ (เดือน/วัน)';
    const dateHeaders = isSpecial
      ? Array.from({ length: 12 }).map((_, i) => `<th style="width: 27px; font-size: 10px;">ส.${i + 1}</th>`).join('')
      : dates.map(d => `<th style="width: 27px; font-size: 10px; cursor: pointer;" contenteditable="true" title="คลิกเพื่อแก้ไขวันที่">${d}</th>`).join('');

    let rows = '';
    if (shiftMembers.length > 0) {
      rows = shiftMembers.map((m, idx) => {
        const roleTag = m.shift_role === 'SHIFT_HEAD' ? ' <span style="color:#d35400; font-size:10px;">(หัวหน้า)</span>' : (m.shift_role === 'SHIFT_DEPUTY' ? ' <span style="color:#27ae60; font-size:10px;">(รอง)</span>' : '');
        return `
          <tr>
            <td style="text-align: center; font-weight: bold;">${idx + 1}</td>
            <td style="font-weight: bold; color: #1a5276;">[${m.duty_id || '-'}] ${m.nickname}${roleTag}</td>
            <td>${m.first_name} ${m.last_name}</td>
            <td style="text-align: center;">${m.grade_class} (${m.student_no})</td>
            ${Array.from({ length: 12 }).map(() => '<td style="text-align: center; width: 28px; height: 26px;">&nbsp;</td>').join('')}
            <td style="text-align: center;">&nbsp;</td>
            <td>&nbsp;</td>
          </tr>
        `;
      }).join('');
    } else {
      rows = Array.from({ length: 3 }).map((_, idx) => `
        <tr>
          <td style="text-align: center; color: #888;">${idx + 1}</td>
          <td style="text-align: center; color: #999;">-</td>
          <td style="text-align: center; color: #999;">(ว่าง)</td>
          <td style="text-align: center;">-</td>
          ${Array.from({ length: 12 }).map(() => '<td style="text-align: center; width: 28px; height: 26px;">&nbsp;</td>').join('')}
          <td>&nbsp;</td>
          <td>&nbsp;</td>
        </tr>
      `).join('');
    }

    return `
      <section class="sheet-page" id="shift-${shift.code}">
        <div class="sheet-corner-tag">
          <div class="tag-english">${englishDay}</div>
          <div class="tag-code">[${shift.code}]</div>
        </div>

        <div class="header">
          <div class="header-content">
            ${logoBase64 ? `<img src="${logoBase64}" class="sarawat-logo" alt="ตราสารวัตรนักเรียน โรงเรียนพระนารายณ์">` : ''}
            <div class="header-titles">
              <div class="title">ใบเช็คชื่อ</div>
              <div class="subtitle">กลุ่มงานกิจการนักเรียน • ฝ่ายสารวัตรนักเรียน</div>
              <div class="sub-meta">โรงเรียนพระนารายณ์ • ภาคเรียนที่ ..... / ปีการศึกษา 2569 • ประจำเดือน .................... • ไตรมาสที่ ........</div>
            </div>
          </div>
        </div>

        <div class="leadership-bar">
          <span><strong>หัวหน้าเวร:</strong> ${headText}</span>
          <span><strong>รองหัวหน้าเวร:</strong> ${deputyText}</span>
        </div>

        <div class="meta-box">
          <span><strong>รอบเวร:</strong> ${shift.name} (${shift.code})</span>
          <span><strong>จำนวนสมาชิกในเวร:</strong> ${shiftMembers.length} นาย</span>
        </div>

        <table>
          <thead>
            <tr>
              <th rowspan="2" style="width: 30px;">ลำดับ</th>
              <th rowspan="2" style="width: 100px;">รหัสเวร+ชื่อเล่น</th>
              <th rowspan="2" style="width: 145px;">ชื่อ - สกุลจริง</th>
              <th rowspan="2" style="width: 80px;">ชั้น (เลขที่)</th>
              <th colspan="12">${tableColspanHeader}</th>
              <th rowspan="2" style="width: 48px;">รวมมา</th>
              <th rowspan="2" style="width: 80px;">หมายเหตุ</th>
            </tr>
            <tr>
              ${dateHeaders}
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>

        <div class="footer">
          <div>
            ลงชื่อ<span class="sig-line"></span><br>
            ( ${head ? `${head.first_name} ${head.last_name}` : '......................................................'} )<br>
            หัวหน้า${shift.name}
          </div>
          <div>
            ลงชื่อ<span class="sig-line"></span><br>
            (......................................................)<br>
            ประธานสารวัตรนักเรียน
          </div>
          <div>
            ลงชื่อ<span class="sig-line"></span><br>
            (......................................................)<br>
            ครูหัวหน้าสารวัตรนักเรียน
          </div>
        </div>
      </section>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <title>ใบเช็คชื่อ - รวมทุกรอบเวร</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Chakra+Petch:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500;1,600;1,700&family=Rubik:ital,wght@0,300..900;1,300..900&family=Zen+Antique&display=swap" rel="stylesheet">
  <style>
    @page {
      size: A4 landscape;
      margin: 10mm 10mm;
    }
    body {
      font-family: 'Sarabun', 'TH Sarabun New', sans-serif;
      margin: 0;
      padding: 10px;
      color: #111;
      font-size: 13px;
      background: #f1f5f9;
    }
    .sheet-page {
      position: relative;
      background: #ffffff;
      padding: 15px 20px;
      margin-bottom: 25px;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
      border-radius: 6px;
      page-break-after: always;
      break-after: page;
    }
    .sheet-page:last-child {
      page-break-after: auto;
      break-after: auto;
      margin-bottom: 0;
    }
    .sheet-corner-tag {
      position: absolute;
      top: 10px;
      right: 15px;
      text-align: right;
      border: 1.5px solid #1a5276;
      border-radius: 6px;
      padding: 4px 10px;
      background-color: #f8fafc;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .sheet-corner-tag .tag-english {
      font-family: 'Bebas Neue', 'Chakra Petch', 'Rubik', sans-serif;
      font-size: 22px;
      font-weight: 400;
      color: #1a5276;
      letter-spacing: 1.5px;
      line-height: 1;
    }
    .sheet-corner-tag .tag-code {
      font-family: 'Chakra Petch', monospace;
      font-size: 11px;
      font-weight: 700;
      color: #d35400;
      line-height: 1.1;
    }
    .header {
      margin-bottom: 8px;
      padding-right: 110px;
      padding-left: 20px;
    }
    .header-content {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
    }
    .sarawat-logo {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      object-fit: cover;
      border: 2px solid #1a5276;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      flex-shrink: 0;
    }
    .header-titles {
      text-align: center;
    }
    .title {
      font-family: 'Chakra Petch', 'Sarabun', sans-serif;
      font-size: 22px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 2px;
      letter-spacing: 0.5px;
    }
    .subtitle {
      font-size: 13px;
      color: #1e3a8a;
      font-weight: 600;
      margin-bottom: 2px;
    }
    .sub-meta {
      font-size: 11.5px;
      color: #475569;
    }
    .leadership-bar {
      background-color: #f8f9f9;
      border: 1px solid #d5dbdb;
      padding: 5px 12px;
      border-radius: 4px;
      margin-bottom: 8px;
      display: flex;
      justify-content: space-around;
      font-size: 13px;
      font-weight: bold;
    }
    .meta-box {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 12px;
      color: #444;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 12px;
    }
    th, td {
      border: 1px solid #333;
      padding: 5px 4px;
      font-size: 12px;
    }
    th {
      background-color: #eaecee;
      text-align: center;
      font-weight: bold;
    }
    th[contenteditable]:hover {
      background-color: #fef3c7;
    }
    .footer {
      display: flex;
      justify-content: space-around;
      margin-top: 18px;
      font-size: 13px;
      text-align: center;
    }
    .sig-line {
      margin-top: 28px;
      border-bottom: 1px dotted #333;
      width: 190px;
      display: inline-block;
    }
    .nav-bar {
      position: sticky;
      top: 0;
      z-index: 1000;
      background: #1e293b;
      color: #f8fafc;
      padding: 10px 16px;
      margin: -10px -10px 15px -10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      font-family: -apple-system, BlinkMacSystemFont, "Sarabun", sans-serif;
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
        padding: 0 !important;
        margin: 0 !important;
        border-radius: 0 !important;
      }
      .no-print {
        display: none !important;
      }
      th[contenteditable] { outline: none; }
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
      <a href="#shift-S" class="nav-btn">เวรพิเศษ</a>
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
  refreshAllChannelsAndPanels,
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
  pendingLostReports,
  getUploadDir,
  getWebDashboardUrl
};
