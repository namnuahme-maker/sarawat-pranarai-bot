/**
 * 🚀 SARAWAT PRANARAI - DISCORD AUTO-BUILDER & ANALYZER (CLEAN MINIMAL)
 * สคริปต์วิเคราะห์และเนรมิตเซิร์ฟเวอร์ Discord สารวัตรนักเรียน
 * (รูปแบบ Clean Minimal: ข้อความกระชับ เงียบ รวดเร็ว ไม่รกหน้าจอ)
 */

process.noDeprecation = true;

const { 
  Client, 
  GatewayIntentBits, 
  ChannelType, 
  PermissionsBitField, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  AttachmentBuilder,
  Events
} = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages
  ]
});

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || TOKEN === 'your_bot_token_here') {
  console.error('[ERROR] Missing DISCORD_TOKEN in .env');
  process.exit(1);
}

const ROLES_TO_CREATE = [
  { key: 'ROLE_PRESIDENT', name: '👑 ประธานสารวัตรนักเรียน', color: '#ED4245', reason: 'ผู้บริหารระดับสูง' },
  { key: 'ROLE_VICE_PRESIDENT', name: '🎖️ รองประธานสารวัตรนักเรียน', color: '#E67E22', reason: 'ผู้บริหารระดับสูง' },
  { key: 'ROLE_HEAD_S', name: '👑 หัวหน้าเวรพิเศษ (S)', color: '#9B59B6', reason: 'ผู้นำเวรพิเศษ' },
  { key: 'ROLE_DEPUTY_S', name: '✨ รองหัวหน้าเวรพิเศษ (S)', color: '#AF7AC5', reason: 'รองผู้นำเวรพิเศษ' },
  { key: 'ROLE_HEAD_M', name: '👑 หัวหน้าเวรจันทร์ (M)', color: '#2980B9', reason: 'ผู้นำเวรวันจันทร์' },
  { key: 'ROLE_DEPUTY_M', name: '✨ รองหัวหน้าเวรจันทร์ (M)', color: '#5DADE2', reason: 'รองผู้นำเวรวันจันทร์' },
  { key: 'ROLE_HEAD_T', name: '👑 หัวหน้าเวรอังคาร (T)', color: '#884EA0', reason: 'ผู้นำเวรวันอังคาร' },
  { key: 'ROLE_DEPUTY_T', name: '✨ รองหัวหน้าเวรอังคาร (T)', color: '#BB8FCE', reason: 'รองผู้นำเวรวันอังคาร' },
  { key: 'ROLE_HEAD_W', name: '👑 หัวหน้าเวรพุธ (W)', color: '#27AE60', reason: 'ผู้นำเวรวันพุธ' },
  { key: 'ROLE_DEPUTY_W', name: '✨ รองหัวหน้าเวรพุธ (W)', color: '#58D68D', reason: 'รองผู้นำเวรวันพุธ' },
  { key: 'ROLE_HEAD_THU', name: '👑 หัวหน้าเวรพฤหัสบดี (Ts)', color: '#D35400', reason: 'ผู้นำเวรวันพฤหัสบดี' },
  { key: 'ROLE_DEPUTY_THU', name: '✨ รองหัวหน้าเวรพฤหัสบดี (Ts)', color: '#E59866', reason: 'รองผู้นำเวรวันพฤหัสบดี' },
  { key: 'ROLE_HEAD_F', name: '👑 หัวหน้าเวรศุกร์ (F)', color: '#C0392B', reason: 'ผู้นำเวรวันศุกร์' },
  { key: 'ROLE_DEPUTY_F', name: '✨ รองหัวหน้าเวรศุกร์ (F)', color: '#EC7063', reason: 'รองผู้นำเวรวันศุกร์' },
  { key: 'ROLE_SPECIAL', name: '🌟 สารวัตรเวรพิเศษ (S)', color: '#8E44AD', reason: 'สารวัตรปฏิบัติหน้าที่ทุกวัน' },
  { key: 'ROLE_VERIFIED', name: '🛡️ สารวัตรนักเรียน', color: '#3498DB', reason: 'สารวัตรที่ผ่านการอนุมัติแล้ว' },
  { key: 'ROLE_MON', name: '🔵 เวรวันจันทร์ (M)', color: '#00A8FF', reason: 'เวรวันจันทร์' },
  { key: 'ROLE_TUE', name: '🟣 เวรวันอังคาร (T)', color: '#9C88FF', reason: 'เวรวันอังคาร' },
  { key: 'ROLE_WED', name: '🟢 เวรวันพุธ (W)', color: '#4CD137', reason: 'เวรวันพุธ' },
  { key: 'ROLE_THU', name: '🟠 เวรวันพฤหัสบดี (Ts)', color: '#E67E22', reason: 'เวรวันพฤหัสบดี' },
  { key: 'ROLE_FRI', name: '🔴 เวรวันศุกร์ (F)', color: '#E84118', reason: 'เวรวันศุกร์' },
  { key: 'ROLE_UNVERIFIED', name: '⏳ รอการยืนยันตัวตน / รออนุมัติ', color: '#7F8C8D', reason: 'สมาชิกใหม่รออนุมัติ' }
];

client.once(Events.ClientReady || 'ready', async () => {
  try {
    let guild = null;
    if (GUILD_ID && GUILD_ID !== 'your_guild_id_here') {
      guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
    } else {
      guild = client.guilds.cache.first();
    }

    if (!guild) {
      console.error('[ERROR] Target guild not found');
      process.exit(1);
    }

    console.log(`[SETUP] Connected: ${client.user.tag} | Guild: ${guild.name} (${guild.id})`);

    const createdRoleIds = {};
    const createdChannelIds = {};

    // 1. ตรวจสอบและสร้าง Roles
    const existingRoles = await guild.roles.fetch();
    for (const r of ROLES_TO_CREATE) {
      let role = existingRoles.find(er => er.name === r.name);
      if (!role) {
        role = await guild.roles.create({
          name: r.name,
          color: r.color,
          reason: r.reason
        });
      }
      createdRoleIds[r.key] = role.id;
    }
    console.log(`[SETUP] Roles synced (${Object.keys(createdRoleIds).length} roles ready)`);

    const everyoneRole = guild.roles.everyone;
    const verifiedRole = await guild.roles.fetch(createdRoleIds['ROLE_VERIFIED']);
    const specialRole = await guild.roles.fetch(createdRoleIds['ROLE_SPECIAL']);

    // 2. ตรวจสอบและสร้าง Categories & Channels
    // Category 1
    const catOnboarding = await getOrCreateCategory(guild, '📌 จุดเริ่มต้น & ยืนยันตัวตน');
    const chVerify = await getOrCreateTextChannel(guild, '🛡️│ยืนยันตัวตน', catOnboarding.id, [
      { id: everyoneRole.id, allow: [PermissionsBitField.Flags.ViewChannel], deny: [PermissionsBitField.Flags.SendMessages] },
      { id: verifiedRole.id, deny: [PermissionsBitField.Flags.ViewChannel] }
    ]);
    const chPhoto = await getOrCreateTextChannel(guild, '📸│อัปโหลดรูปโปรไฟล์-ทำบัตร', catOnboarding.id, [
      { id: everyoneRole.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: verifiedRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles] }
    ]);
    createdChannelIds['PHOTO_CHANNEL_ID'] = chPhoto.id;

    // Category 2
    const catHQ = await getOrCreateCategory(guild, '📢 ข่าวสารและส่วนกลาง');
    await getOrCreateTextChannel(guild, '📢│ประกาศและมอบหมายงาน', catHQ.id, [
      { id: everyoneRole.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: verifiedRole.id, allow: [PermissionsBitField.Flags.ViewChannel], deny: [PermissionsBitField.Flags.SendMessages] }
    ]);

    // Category 3
    const catIncidents = await getOrCreateCategory(guild, '🚨 ศูนย์รับเรื่องและคดี');
    await getOrCreateTextChannel(guild, '🔔│แจ้งเหตุใหม่-google-form', catIncidents.id, [
      { id: everyoneRole.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: verifiedRole.id, allow: [PermissionsBitField.Flags.ViewChannel], deny: [PermissionsBitField.Flags.SendMessages] }
    ]);
    await getOrCreateTextChannel(guild, '📁│ติดตามและปิดคดี', catIncidents.id, [
      { id: everyoneRole.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: verifiedRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
    ]);

    // Category 4
    const catDuty = await getOrCreateCategory(guild, '📅 ปฏิบัติการประจำเวร');
    await getOrCreateTextChannel(guild, '💬│แค่พูดคุย', catDuty.id, [
      { id: everyoneRole.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: verifiedRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
    ]);
    const chServiceDesk = await getOrCreateTextChannel(guild, '📑│เช็คชื่อ', catDuty.id, [
      { id: everyoneRole.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: verifiedRole.id, allow: [PermissionsBitField.Flags.ViewChannel] }
    ]);
    createdChannelIds['ATTENDANCE_CHANNEL_ID'] = chServiceDesk.id;

    const dayChannels = [
      { code: 'S', name: '⭐│เวรพิเศษ-s', roleKey: 'ROLE_SPECIAL' },
      { code: 'M', name: '🔵│เวรวันจันทร์-m', roleKey: 'ROLE_MON' },
      { code: 'T', name: '🟣│เวรวันอังคาร-t', roleKey: 'ROLE_TUE' },
      { code: 'W', name: '🟢│เวรวันพุธ-w', roleKey: 'ROLE_WED' },
      { code: 'Ts', name: '🟠│เวรวันพฤหัสบดี-ts', roleKey: 'ROLE_THU' },
      { code: 'F', name: '🔴│เวรวันศุกร์-f', roleKey: 'ROLE_FRI' }
    ];

    const leaderRole = await guild.roles.fetch(createdRoleIds['ROLE_PRESIDENT']);
    const vpRole = await guild.roles.fetch(createdRoleIds['ROLE_VICE_PRESIDENT']);

    for (const dc of dayChannels) {
      const shiftRole = await guild.roles.fetch(createdRoleIds[dc.roleKey]);
      const headRoleId = createdRoleIds[`ROLE_HEAD_${dc.code}`];
      const depRoleId = createdRoleIds[`ROLE_DEPUTY_${dc.code}`];

      const overwrites = [
        { id: everyoneRole.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: shiftRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
      ];

      if (headRoleId) overwrites.push({ id: headRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] });
      if (depRoleId) overwrites.push({ id: depRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] });
      if (leaderRole) overwrites.push({ id: leaderRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] });
      if (vpRole) overwrites.push({ id: vpRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] });

      await getOrCreateTextChannel(guild, dc.name, catDuty.id, overwrites);
    }

    // Category 5
    const catAdmin = await getOrCreateCategory(guild, '🔒 ฝ่ายบริหารและฐานข้อมูล');

    const chApproval = await getOrCreateTextChannel(guild, '✅│อนุมัติสมาชิก-สารวัตร', catAdmin.id, [
      { id: everyoneRole.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: leaderRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
    ]);
    const chAllInOne = await getOrCreateTextChannel(guild, '👑│ผู้นำ-all-in-one', catAdmin.id, [
      { id: everyoneRole.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: leaderRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.EmbedLinks, PermissionsBitField.Flags.AttachFiles] }
    ]);
    await getOrCreateTextChannel(guild, '👑│ห้องประชุมหัวหน้า', catAdmin.id, [
      { id: everyoneRole.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: leaderRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
    ]);
    createdChannelIds['APPROVAL_CHANNEL_ID'] = chApproval.id;

    console.log(`[SETUP] Channels synced (5 categories, 16 channels optimized)`);

    // 3. ติดตั้งปุ่มระบบ
    const verifyMessages = await chVerify.messages.fetch({ limit: 5 });
    if (verifyMessages.size === 0) {
      const embed = new EmbedBuilder()
        .setTitle('🛡️ ยืนยันตัวตนสารวัตรนักเรียน')
        .setDescription(
          'กดปุ่ม **"🛡️ ยืนยันตัวตน"** ด้านล่างเพื่อ:\n' +
          '• ค้นหาชื่อตนเอง หรือกดเพิ่มชื่อใหม่\n' +
          '• เลือกรอบเวรประจำวัน (จันทร์-ศุกร์ หรือ เวรพิเศษ S)\n' +
          '• ส่งคำขอให้ผู้บริหารอนุมัติเข้าปฏิบัติหน้าที่'
        )
        .setColor('#3498DB')
        .setFooter({ text: 'SARAWAT-BOT • ระบบลงทะเบียนสารวัตร' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('btn_start_verify')
          .setLabel('🛡️ ยืนยันตัวตน')
          .setStyle(ButtonStyle.Primary)
      );

      const verifyFiles = [];
      const verifyBanner = path.join(__dirname, 'assets', 'panel_input_data.jpg');
      if (fs.existsSync(verifyBanner)) {
        verifyFiles.push(new AttachmentBuilder(verifyBanner, { name: 'panel_input_data.jpg' }));
        embed.setImage('attachment://panel_input_data.jpg');
      }

      await chVerify.send({ embeds: [embed], components: [row], files: verifyFiles });
    }

    const webUrl = process.env.WEB_URL || process.env.RENDER_WEB_URL || 'https://sarawat-pranarai-web.onrender.com';

    const serviceMessages = await chServiceDesk.messages.fetch({ limit: 5 });
    if (serviceMessages.size === 0) {
      const embed = new EmbedBuilder()
        .setTitle('📑 ศูนย์บริการปฏิบัติการประจำเวร | โรงเรียนพระนารายณ์')
        .setDescription(
          'กดเลือกรายการที่ต้องการทำรายการ:\n\n' +
          '• **ขอลาเวร:** บอทส่ง DM แจ้งหัวหน้าเวรทันที\n' +
          '• **ขอใบเช็คชื่อ A4:** รับแบบฟอร์มลงเวลา 12 สัปดาห์พร้อมพิมพ์\n' +
          '• **เข้าสู่ระบบเว็บไซต์:** เปิดแดชบอร์ดศูนย์บัญชาการสารวัตรนักเรียน'
        )
        .setColor('#1ABC9C')
        .setFooter({ text: 'SARAWAT-BOT • ระบบบริการสารวัตรนักเรียน' });

      const serviceFiles = [];
      const serviceBanner = path.join(__dirname, 'assets', 'panel_all_in_one.jpg');
      if (fs.existsSync(serviceBanner)) {
        serviceFiles.push(new AttachmentBuilder(serviceBanner, { name: 'panel_all_in_one.jpg' }));
        embed.setImage('attachment://panel_all_in_one.jpg');
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('btn_request_leave')
          .setLabel('📝 ขอลาเวร')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('btn_request_attendance')
          .setLabel('📄 ขอใบเช็คชื่อ')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setLabel('🌐 เข้าสู่เว็บไซต์ระบบ')
          .setStyle(ButtonStyle.Link)
          .setURL(webUrl)
      );

      await chServiceDesk.send({ embeds: [embed], components: [row], files: serviceFiles });
    }

    const allInOneMessages = await chAllInOne.messages.fetch({ limit: 5 });
    if (allInOneMessages.size === 0) {
      const embed = new EmbedBuilder()
        .setTitle('👑 ศูนย์สั่งการสารวัตร (All in One)')
        .setDescription('สิทธิ์: ประธาน | รองประธาน | หัวหน้าเวร | รองหัวหน้าเวร\n\nเลือกทำรายการ:')
        .setColor('#F1C40F')
        .setFooter({ text: 'SARAWAT-BOT • All in One' });

      const aioFiles = [];
      const aioBanner = path.join(__dirname, 'assets', 'panel_all_in_one.jpg');
      if (fs.existsSync(aioBanner)) {
        aioFiles.push(new AttachmentBuilder(aioBanner, { name: 'panel_all_in_one.jpg' }));
        embed.setImage('attachment://panel_all_in_one.jpg');
      }

      const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('btn_request_attendance')
          .setLabel('📄 ขอใบเช็คชื่อ')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('btn_open_remove_member_menu')
          .setLabel('🗑️ ลบข้อมูล (ออกจากสารวัตร)')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setLabel('🌐 เข้าสู่ระบบแดชบอร์ด (Web)')
          .setStyle(ButtonStyle.Link)
          .setURL(webUrl)
      );

      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('btn_inspect_roster')
          .setLabel('👥 ดูข้อมูลสารวัตร')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('btn_open_appoint_menu')
          .setLabel('👑 แต่งตั้งตำแหน่ง')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('btn_set_semester')
          .setLabel('🎓 กำหนดภาคเรียน')
          .setStyle(ButtonStyle.Primary)
      );

      await chAllInOne.send({ embeds: [embed], components: [row1, row2], files: aioFiles });
    }

    const photoMessages = await chPhoto.messages.fetch({ limit: 5 });
    if (photoMessages.size === 0) {
      const embed = new EmbedBuilder()
        .setTitle('📸 ส่งรูปโปรไฟล์ทำบัตร')
        .setDescription(
          '1. แนบรูปถ่ายหน้าตรงแล้วส่งในห้องนี้\n' +
          '2. บอทผูกรูปเข้ากับข้อมูลสมาชิกอัตโนมัติ\n\n' +
          '*(ยังไม่ลงทะเบียน? ไปห้อง 🛡️│ยืนยันตัวตน ก่อน)*'
        )
        .setColor('#3498DB');

      const photoFiles = [];
      const photoBanner = path.join(__dirname, 'assets', 'panel_send_photo.jpg');
      if (fs.existsSync(photoBanner)) {
        photoFiles.push(new AttachmentBuilder(photoBanner, { name: 'panel_send_photo.jpg' }));
        embed.setImage('attachment://panel_send_photo.jpg');
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('btn_check_my_photo')
          .setLabel('🔍 เช็ครูปของฉัน')
          .setStyle(ButtonStyle.Primary)
      );

      await chPhoto.send({ embeds: [embed], components: [row], files: photoFiles });
    }

    console.log(`[SETUP] Interactive buttons deployed (#ยืนยันตัวตน, #อัปโหลดรูปโปรไฟล์, #ขอใบตารางเช็คชื่อ, #ขอลาเวร, #ตรวจสอบข้อมูลสมาชิก)`);

    // 4. บันทึกค่า Config ลง .env
    updateEnvFile({
      GUILD_ID: guild.id,
      ...createdChannelIds,
      ...createdRoleIds
    });

    console.log(`[SETUP] Configuration updated in .env`);
    console.log(`[SETUP] Done. All systems operational.`);
    process.exit(0);

  } catch (err) {
    console.error('[ERROR]', err.message);
    process.exit(1);
  }
});

async function getOrCreateCategory(guild, name) {
  const existing = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === name);
  if (existing) return existing;
  return await guild.channels.create({
    name: name,
    type: ChannelType.GuildCategory
  });
}

async function getOrCreateTextChannel(guild, name, parentId, permissionOverwrites = []) {
  const existing = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.name === name);
  if (existing) return existing;
  return await guild.channels.create({
    name: name,
    type: ChannelType.GuildText,
    parent: parentId,
    permissionOverwrites: permissionOverwrites
  });
}

function updateEnvFile(configMap) {
  const envPath = path.join(__dirname, '.env');
  let currentContent = '';
  if (fs.existsSync(envPath)) {
    currentContent = fs.readFileSync(envPath, 'utf8');
  }

  for (const [k, v] of Object.entries(configMap)) {
    const regex = new RegExp(`^${k}=.*$`, 'm');
    if (regex.test(currentContent)) {
      currentContent = currentContent.replace(regex, `${k}=${v}`);
    } else {
      currentContent += `\n${k}=${v}`;
    }
  }

  fs.writeFileSync(envPath, currentContent.trim() + '\n', 'utf8');
}

client.login(TOKEN);
