const test = require('node:test');
const assert = require('node:assert');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

test('Photo Upload Card and 2-Button Interaction Architecture', async (t) => {
  await t.test('Preview card should generate exactly 2 buttons: Crop (Link) and Re-upload (Danger)', () => {
    const memberId = 'mem_12345';
    const cropToken = 'mock_crop_token_abc';
    const cropUrl = `https://sarawat-pranarai-web.onrender.com/crop?token=${cropToken}`;

    const photoActionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('🔲 ปรับแต่ง/ครอบรูป (ขนาด 1 นิ้ว)')
        .setStyle(ButtonStyle.Link)
        .setURL(cropUrl),
      new ButtonBuilder()
        .setCustomId(`btn_reupload_photo_${memberId}`)
        .setLabel('🔄 เปลี่ยนรูปภาพใหม่')
        .setStyle(ButtonStyle.Danger)
    );

    const components = photoActionRow.components;
    assert.strictEqual(components.length, 2, 'Must contain exactly 2 buttons');

    // Button 1: ครอบรูป (Link)
    const cropBtn = components[0];
    assert.strictEqual(cropBtn.data.style, ButtonStyle.Link);
    assert.ok(cropBtn.data.label.includes('ครอบรูป') || cropBtn.data.label.includes('ปรับแต่ง'));
    assert.strictEqual(cropBtn.data.url, cropUrl);

    // Button 2: เปลี่ยนรูป (Danger / CustomId)
    const reuploadBtn = components[1];
    assert.strictEqual(reuploadBtn.data.style, ButtonStyle.Danger);
    assert.strictEqual(reuploadBtn.data.custom_id, `btn_reupload_photo_${memberId}`);
    assert.ok(reuploadBtn.data.label.includes('เปลี่ยนรูป'));
  });

  await t.test('Preview embed must categorize member info, shift duty, and photo status clearly', () => {
    const member = {
      first_name: 'สมชาย',
      last_name: 'ใจดี',
      nickname: 'ชาย',
      grade_class: '4/1',
      student_no: '15',
      duty_day: 'MS',
      phone_number: '0812345678'
    };

    const isSpecial = member.duty_day && member.duty_day.endsWith('S');
    const weekday = 'M';
    const weekdayName = 'จันทร์';
    const shiftLabel = 'เวรวันจันทร์ (เวรพิเศษทุกวัน)';
    const finalProfileUrl = 'https://supabase.co/storage/v1/object/public/sarawat-photos/members/photo.jpg';

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
      .setImage(finalProfileUrl)
      .setColor('#F59E0B');

    const fields = previewEmbed.data.fields;
    assert.strictEqual(fields.length, 3);
    assert.ok(fields[0].name.includes('ข้อมูลส่วนตัวผู้สมัคร'));
    assert.ok(fields[1].name.includes('ข้อมูลการปฏิบัติหน้าที่'));
    assert.ok(fields[2].name.includes('สถานะรูปถ่ายและการดำเนินการต่อ'));
    assert.strictEqual(previewEmbed.data.image.url, finalProfileUrl);
    assert.strictEqual(previewEmbed.data.color, 0xF59E0B);
  });
});
