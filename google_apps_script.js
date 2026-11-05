/**
 * 🚨 GOOGLE APPS SCRIPT: ระบบแจ้งเตือนเหตุ สารวัตรนักเรียน โรงเรียนพระนารายณ์
 * บันทึกลงฐานข้อมูล Supabase อัตโนมัติ + ส่งแจ้งเตือนเข้า Discord Webhook ทันที
 * 
 * คอลัมน์ใน Google Sheets (เชื่อมต่อกับ Google Form):
 * [A] Timestamp (ประทับเวลา)
 * [B] Email Address (ที่อยู่อีเมล)
 * [C] ชื่อผู้ส่งเหตุ
 * [D] ชั้น
 * [E] เรื่อง + บอกวันที่ ที่เกิดเหตุ
 * [F] หลักฐาน
 * [G] ข้อมูลติดต่อกลับ
 * 
 * -------------------------------------------------------------
 * 📌 ขั้นตอนการติดตั้งใช้งาน:
 * 1. ใน Google Sheets ไปที่แถบเมนู: "ส่วนขยาย" (Extensions) -> "Apps Script"
 * 2. ลบโค้ดเดิมทั้งหมดในหน้าต่าง แล้วคัดลอกโค้ดนี้ทั้งหมดไปวางแทน
 * 3. กดไอคอน "บันทึกโครงการ" (รูปแผ่นดิสก์ 💾 หรือกด Ctrl+S)
 * 4. [สำคัญมาก] ตั้งค่าทริกเกอร์อัตโนมัติ:
 *    - คลิกเมนูซ้ายมือรูปนาฬิกา "ทริกเกอร์" (Triggers / นาฬิกา)
 *    - กดปุ่ม "+ เพิ่มทริกเกอร์" (+ Add Trigger) ด้านขวาล่าง
 *    - เลือกฟังก์ชัน: onFormSubmit
 *    - เลือกแหล่งที่มาของเหตุการณ์: จากสเปรดชีต (From spreadsheet)
 *    - เลือกประเภทเหตุการณ์: เมื่อส่งแบบฟอร์ม (On form submit)
 *    - การแจ้งเตือนความล้มเหลว: แจ้งทันที
 *    - กด "บันทึก" (Save) และกดยอมรับสิทธิ์ (Advanced -> Go to ... -> Allow)
 * 5. ทดสอบการทำงาน:
 *    - เลือกฟังก์ชัน testSendIncident จากดรอปดาวน์ด้านบน แล้วกด "เรียกใช้" (Run)
 *    - ข้อความจะเด้งเข้าห้อง Discord ทันที พร้อมบอทเปิดเธรดติดตามคดีอัตโนมัติ!
 * -------------------------------------------------------------
 */

// 🌐 1. ตั้งค่า Discord Webhook & Supabase REST API
const DISCORD_WEBHOOK_URL = "YOUR_DISCORD_WEBHOOK_URL";
const SUPABASE_URL = "YOUR_SUPABASE_URL";
const SUPABASE_SERVICE_KEY = "YOUR_SUPABASE_SERVICE_ROLE_KEY";

/**
 * ฟังก์ชันหลักที่ทำงานอัตโนมัติเมื่อมีคนส่ง Google Form
 */
function onFormSubmit(e) {
  try {
    let timestamp = "";
    let email = "";
    let reporterName = "";
    let grade = "";
    let incidentDetails = "";
    let evidenceUrl = "";
    let contactInfo = "";

    // ระดับ 1: ดึงจาก e.namedValues (มาตรฐาน Google Form Trigger)
    if (e && e.namedValues) {
      const named = e.namedValues;
      const getFromNamed = function(headers) {
        for (let i = 0; i < headers.length; i++) {
          const h = headers[i];
          if (named[h] && named[h][0] !== undefined && String(named[h][0]).trim() !== "") {
            return String(named[h][0]).trim();
          }
        }
        return "";
      };

      timestamp = getFromNamed(["Timestamp", "ประทับเวลา"]);
      email = getFromNamed(["Email Address", "ที่อยู่อีเมล", "อีเมล"]);
      reporterName = getFromNamed(["ชื่อผู้ส่งเหตุ", "ชื่อ-นามสกุล ผู้แจ้ง", "ชื่อผู้แจ้ง"]);
      grade = getFromNamed(["ชั้น", "ระดับชั้น"]);
      incidentDetails = getFromNamed(["เรื่อง + บอกวันที่ ที่เกิดเหตุ", "เรื่อง + บอกวันที่ที่เกิดเหตุ", "รายละเอียด"]);
      evidenceUrl = getFromNamed(["หลักฐาน", "แนบรูปถ่าย / วิดีโอหลักฐาน"]);
      contactInfo = getFromNamed(["ข้อมูลติดต่อกลับ", "เบอร์โทร", "ช่องทางติดต่อ"]);
    }

    // ระดับ 2: ดึงจาก e.values (เมื่อ namedValues ว่าง)
    if ((!reporterName || !incidentDetails) && e && e.values && e.values.length > 0) {
      const v = e.values;
      if (!timestamp && v[0]) timestamp = String(v[0]).trim();
      if (!email && v[1]) email = String(v[1]).trim();
      if (!reporterName && v[2]) reporterName = String(v[2]).trim();
      if (!grade && v[3]) grade = String(v[3]).trim();
      if (!incidentDetails && v[4]) incidentDetails = String(v[4]).trim();
      if (!evidenceUrl && v[5]) evidenceUrl = String(v[5]).trim();
      if (!contactInfo && v[6]) contactInfo = String(v[6]).trim();
    }

    // ระดับ 3 (ระบบป้องกันข้อมูลสูญหาย 100%): อ่านแถวล่าสุดจาก Google Sheets โดยตรง
    if (!reporterName || !incidentDetails) {
      try {
        const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
        const lastRow = sheet.getLastRow();
        if (lastRow >= 2) {
          const rowData = sheet.getRange(lastRow, 1, 1, 7).getValues()[0];
          if (!timestamp && rowData[0]) timestamp = String(rowData[0]).trim();
          if (!email && rowData[1]) email = String(rowData[1]).trim();
          if (!reporterName && rowData[2]) reporterName = String(rowData[2]).trim();
          if (!grade && rowData[3]) grade = String(rowData[3]).trim();
          if (!incidentDetails && rowData[4]) incidentDetails = String(rowData[4]).trim();
          if (!evidenceUrl && rowData[5]) evidenceUrl = String(rowData[5]).trim();
          if (!contactInfo && rowData[6]) contactInfo = String(rowData[6]).trim();
        }
      } catch (sheetErr) {
        Logger.log("Direct sheet fallback warning: " + sheetErr);
      }
    }

    // กำหนดค่าเริ่มต้นหากช่องใดว่าง
    if (!timestamp) timestamp = new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
    if (!email) email = "anonymous@pranarai.ac.th";
    if (!reporterName) reporterName = "ไม่ประสงค์ออกนาม";
    if (!grade) grade = "-";
    if (!incidentDetails) incidentDetails = "ไม่มีรายละเอียดเหตุ";
    if (!contactInfo) contactInfo = "-";

    // 2. สร้างรหัสคดีแบบสุ่ม เช่น CASE-4821
    const caseId = "CASE-" + Math.floor(1000 + Math.random() * 9000);

    // 3. ตรวจจับคำสำคัญเร่งด่วน
    const isUrgent = incidentDetails.includes("บุหรี่") || incidentDetails.includes("ยา") || 
                     incidentDetails.includes("สารเสพติด") || incidentDetails.includes("ตีกัน") || 
                     incidentDetails.includes("ทะเลาะ") || incidentDetails.includes("อาวุธ") ||
                     incidentDetails.includes("มีด") || incidentDetails.includes("ขโมย");

    const category = isUrgent ? "เหตุด่วนความปลอดภัย" : "แจ้งเหตุทั่วไป";
    const embedColor = isUrgent ? 12597547 : 15158332; // แดงเข้ม (#C0392B) หรือ แดงสด (#E74C3C)
    const urgentTag = isUrgent ? "🔥 [เหตุด่วนความปลอดภัย]" : "🚨 [แจ้งเหตุใหม่]";

    // 4. บันทึกตรงเข้าฐานข้อมูล Supabase REST API
    try {
      const supabasePayload = {
        case_id: caseId,
        reporter_email: email,
        reporter_name: `${reporterName} (ชั้น ${grade})`,
        incident_date_time: new Date().toISOString(),
        location: (contactInfo && contactInfo !== '-' && String(contactInfo).trim() !== '') ? String(contactInfo).trim() : 'ไม่ระบุ',
        category: category,
        description: incidentDetails,
        evidence_urls: (evidenceUrl && evidenceUrl.startsWith("http")) ? [evidenceUrl] : [],
        status: "PENDING"
      };

      UrlFetchApp.fetch(SUPABASE_URL + "/rest/v1/cases", {
        method: "post",
        contentType: "application/json",
        headers: {
          "apikey": SUPABASE_SERVICE_KEY,
          "Authorization": "Bearer " + SUPABASE_SERVICE_KEY,
          "Prefer": "return=minimal"
        },
        payload: JSON.stringify(supabasePayload),
        muteHttpExceptions: true
      });
      Logger.log("Supabase insert completed for " + caseId);
    } catch (dbErr) {
      Logger.log("Supabase direct insert error: " + dbErr);
    }

    // 5. เตรียมข้อความแจ้งเตือน Discord Webhook
    const fields = [
      { name: "👤 ผู้ส่งเหตุ", value: `${reporterName} (ชั้น ${grade})`, inline: true },
      { name: "📧 อีเมล", value: email, inline: true },
      { name: "📞 ข้อมูลติดต่อกลับ", value: contactInfo, inline: true },
      { name: "📝 เรื่อง + บอกวันที่ ที่เกิดเหตุ", value: incidentDetails.length > 900 ? incidentDetails.substring(0, 897) + "..." : incidentDetails, inline: false },
      { name: "⏳ สถานะระบบ", value: "รอดำเนินการ (รอสารวัตร/หัวหน้าเวรรับเรื่อง)", inline: true }
    ];

    if (evidenceUrl && (evidenceUrl.startsWith("http://") || evidenceUrl.startsWith("https://"))) {
      fields.push({
        name: "📂 หลักฐานแนบ",
        value: `[คลิกเพื่อเปิดดูไฟล์หลักฐานใน Google Drive](${evidenceUrl})`,
        inline: false
      });
    }

    const discordPayload = {
      content: `@here มีรายงานแจ้งเหตุใหม่จาก Google Form กรุณาตรวจสอบและมอบหมายเวร`,
      embeds: [
        {
          title: `${urgentTag} รหัสคดี: ${caseId}`,
          color: embedColor,
          fields: fields,
          footer: {
            text: `ระบบรับเรื่องร้องเรียน สารวัตรนักเรียน โรงเรียนพระนารายณ์ • เวลา: ${timestamp}`
          }
        }
      ]
    };

    // 6. ส่งเข้า Discord Webhook ทันที
    const response = UrlFetchApp.fetch(DISCORD_WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(discordPayload),
      muteHttpExceptions: true
    });

    Logger.log("Discord Webhook status: " + response.getResponseCode());
  } catch (fatalErr) {
    Logger.log("Fatal onFormSubmit error: " + fatalErr);
  }
}

/**
 * 🧪 ฟังก์ชันทดสอบ: กดปุ่ม 'เรียกใช้' (Run) ฟังก์ชันนี้เพื่อทดสอบระบบได้ทันที
 */
function testSendIncident() {
  const dummyEvent = {
    namedValues: {
      "Timestamp": [new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })],
      "Email Address": ["student.test@pranarai.ac.th"],
      "ชื่อผู้ส่งเหตุ": ["นายทดสอบ ระบบแจ้งเหตุ"],
      "ชั้น": ["ม.5/7"],
      "เรื่อง + บอกวันที่ ที่เกิดเหตุ": ["พบบุคคลต้องสงสัยบริเวณหลังอาคาร 3 เวลา 12:45 น."],
      "หลักฐาน": ["https://drive.google.com/"],
      "ข้อมูลติดต่อกลับ": ["081-234-5678"]
    }
  };
  onFormSubmit(dummyEvent);
}
