/**
 * 📦 สคริปต์เชื่อมต่อ Google Forms / Google Sheets เข้าสู่ฐานข้อมูล Supabase & ศูนย์บัญชาการสารวัตร
 * โรงเรียนพระนารายณ์ • ฝ่ายบริหารงานสารวัตรนักเรียน
 * 
 * รองรับการติดตั้งทั้ง 2 รูปแบบ:
 * 1. ติดตั้งใน Google Forms โดยตรง (FormApp)
 * 2. ติดตั้งใน Google Sheets ที่เชื่อมกับฟอร์ม (SpreadsheetApp)
 */

// ⚙️ ตั้งค่าการเชื่อมต่อฐานข้อมูลและแจ้งเตือน
const CONFIG = {
  // 1. Supabase Database Direct Insert (โรงเรียนพระนารายณ์)
  SUPABASE_URL: "https://cxrakrsyxvsrbpgphgtt.supabase.co",
  SUPABASE_KEY: "YOUR_SUPABASE_SERVICE_ROLE_KEY",

  // 2. Web API Endpoint (ซิงค์ขึ้นเว็บสารวัตร Promax บน Render)
  WEB_API_URL: "https://sarawat-promax.onrender.com/api/lost-found/claims",
  WEB_DASHBOARD_URL: "https://sarawat-promax.onrender.com/lost-found",

  // 3. Discord Webhook URL (ใส่ Webhook ของห้อง #📦│แจ้งพบของหาย ถ้ามี)
  DISCORD_WEBHOOK_URL: ""
};

/**
 * 🔄 ซิงค์ข้อมูลคำร้องย้อนหลังทั้งหมด เข้า Supabase และหน้าเว็บในคลิกเดียว!
 * รองรับทั้ง Google Forms และ Google Sheets อัตโนมัติ
 * วิธีใช้: เลือกฟังก์ชัน "syncAllPastResponses" ด้านบน แล้วกดปุ่ม "Run" (เรียกใช้)
 */
function syncAllPastResponses() {
  const entries = [];
  let sourceName = "";

  // 1. ตรวจสอบว่าเปิดสคริปต์จากใน Google Form หรือไม่
  try {
    const form = FormApp.getActiveForm();
    if (form) {
      sourceName = "Google Form: " + form.getTitle();
      Logger.log("📋 กำลังอ่านข้อมูลจาก " + sourceName);
      const responses = form.getResponses();
      for (let i = 0; i < responses.length; i++) {
        const fResp = responses[i];
        const itemResponses = fResp.getItemResponses();
        const namedValues = {};
        for (let j = 0; j < itemResponses.length; j++) {
          const item = itemResponses[j];
          const title = item.getItem().getTitle().trim();
          const val = item.getResponse();
          namedValues[title] = Array.isArray(val) ? val : [val];
        }
        entries.push({
          timestamp: fResp.getTimestamp(),
          namedValues: namedValues,
          values: []
        });
      }
    }
  } catch (err) {}

  // 2. ถ้าไม่ได้เปิดจาก Form ให้ตรวจสอบใน Google Sheet
  if (entries.length === 0) {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      if (ss) {
        sourceName = "Google Sheet: " + ss.getName();
        Logger.log("📊 กำลังอ่านข้อมูลจาก " + sourceName);
        const sheet = ss.getActiveSheet();
        const data = sheet.getDataRange().getValues();
        if (data && data.length >= 2) {
          const headers = data[0].map(function(h) { return String(h).trim(); });
          for (let r = 1; r < data.length; r++) {
            const row = data[r];
            if (!row || row.every(function(cell) { return String(cell).trim() === ""; })) continue;
            const namedValues = {};
            for (let c = 0; c < headers.length; c++) {
              namedValues[headers[c]] = [row[c]];
            }
            entries.push({
              timestamp: row[0],
              namedValues: namedValues,
              values: row
            });
          }
        }
      }
    } catch (err) {}
  }

  if (entries.length === 0) {
    Logger.log("❌ ไม่พบข้อมูลคำร้อง (หรือยังไม่มีใครส่งคำร้องเข้ามา)");
    return "ไม่พบข้อมูลคำร้อง";
  }

  Logger.log("🔍 พบข้อมูลคำร้องทั้งหมด " + entries.length + " รายการ กำลังเริ่มซิงค์...");
  let successCount = 0;
  let failCount = 0;

  for (let idx = 0; idx < entries.length; idx++) {
    const entry = entries[idx];
    const parsed = parseFormData({ namedValues: entry.namedValues, values: entry.values });
    const currentYear = new Date().getFullYear();
    const claimCode = "CLM-" + currentYear + "-" + String(1001 + idx);

    let chars = parsed.characteristics || "ไม่มีรายละเอียด";
    if (parsed.photo_url) {
      chars += "\n📷 รูปแนบ: " + parsed.photo_url;
    }

    const payload = {
      claim_code: claimCode,
      category: parsed.category || "อื่นๆ",
      item_type: parsed.item_type || "ไม่ระบุชื่อสิ่งของ",
      characteristics: chars,
      lost_location: parsed.lost_location || "ไม่ระบุสถานที่",
      lost_date: parsed.lost_date || new Date().toISOString().slice(0, 10),
      claimant_name: parsed.claimant_name || "ไม่ประสงค์ออกนาม",
      claimant_class: parsed.claimant_class || "-",
      claimant_contact: parsed.claimant_contact || "-",
      status: "PENDING",
      created_at: entry.timestamp ? new Date(entry.timestamp).toISOString() : new Date().toISOString()
    };

    // ยิงตรงเข้า Supabase
    try {
      const endpoint = CONFIG.SUPABASE_URL.replace(/\/+$/, '') + "/rest/v1/lost_claims";
      const res = UrlFetchApp.fetch(endpoint, {
        method: "POST",
        headers: {
          "apikey": CONFIG.SUPABASE_KEY,
          "Authorization": "Bearer " + CONFIG.SUPABASE_KEY,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });

      if (res.getResponseCode() >= 200 && res.getResponseCode() < 300) {
        successCount++;
        Logger.log("✅ รายการที่ " + (idx + 1) + " บันทึกเข้า Supabase สำเร็จ: " + claimCode + " (" + payload.item_type + ")");
      } else {
        failCount++;
        Logger.log("⚠️ รายการที่ " + (idx + 1) + " Supabase error (" + res.getResponseCode() + "): " + res.getContentText());
      }
    } catch (err) {
      failCount++;
      Logger.log("❌ รายการที่ " + (idx + 1) + " Error: " + err.message);
    }

    // ยิงเข้า Web API บน Render
    try {
      UrlFetchApp.fetch(CONFIG.WEB_API_URL, {
        method: "POST",
        contentType: "application/json",
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
    } catch (wErr) {
      Logger.log("Web API notice: " + wErr.message);
    }
  }

  const resultMsg = "🎉 ซิงค์ข้อมูลเสร็จสิ้น! สำเร็จ " + successCount + " รายการ, ไม่ผ่าน " + failCount + " รายการ";
  Logger.log(resultMsg);
  return resultMsg;
}

/**
 * ฟังก์ชันหลักที่ทำงานอัตโนมัติเมื่อมีคนส่ง Google Form เข้ามาใหม่
 */
function onFormSubmit(e) {
  try {
    let namedValues = null;
    let values = null;

    // 1. กรณีผูก Trigger จาก Google Form โดยตรง
    if (e && e.response) {
      const itemResponses = e.response.getItemResponses();
      namedValues = {};
      for (let j = 0; j < itemResponses.length; j++) {
        const item = itemResponses[j];
        const title = item.getItem().getTitle().trim();
        const val = item.getResponse();
        namedValues[title] = Array.isArray(val) ? val : [val];
      }
    } else if (e && e.namedValues) {
      // 2. กรณีผูก Trigger จาก Google Sheet
      namedValues = e.namedValues;
      values = e.values;
    }

    const row = parseFormData({ namedValues: namedValues, values: values });
    Logger.log("Parsed Form Data: " + JSON.stringify(row));

    const currentYear = new Date().getFullYear();
    const claimCode = "CLM-" + currentYear + "-" + Math.floor(1000 + Math.random() * 9000);

    let chars = row.characteristics || "ไม่มีรายละเอียด";
    if (row.photo_url) {
      chars += "\n📷 รูปแนบ: " + row.photo_url;
    }

    const payload = {
      claim_code: claimCode,
      category: row.category || "อื่นๆ",
      item_type: row.item_type || "ไม่ระบุชื่อสิ่งของ",
      characteristics: chars,
      lost_location: row.lost_location || "ไม่ระบุสถานที่",
      lost_date: row.lost_date || new Date().toISOString().slice(0, 10),
      claimant_name: row.claimant_name || "ไม่ประสงค์ออกนาม",
      claimant_class: row.claimant_class || "-",
      claimant_contact: row.claimant_contact || "-",
      photo_url: row.photo_url || "",
      photo_urls: row.photo_urls || [],
      status: "PENDING",
      created_at: new Date().toISOString()
    };

    // 1. บันทึกตรงเข้า Supabase lost_claims
    try {
      const endpoint = CONFIG.SUPABASE_URL.replace(/\/+$/, '') + "/rest/v1/lost_claims";
      const res = UrlFetchApp.fetch(endpoint, {
        method: "POST",
        headers: {
          "apikey": CONFIG.SUPABASE_KEY,
          "Authorization": "Bearer " + CONFIG.SUPABASE_KEY,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        payload: JSON.stringify({
          claim_code: payload.claim_code,
          category: payload.category,
          item_type: payload.item_type,
          characteristics: payload.characteristics,
          lost_location: payload.lost_location,
          lost_date: payload.lost_date,
          claimant_name: payload.claimant_name,
          claimant_class: payload.claimant_class,
          claimant_contact: payload.claimant_contact,
          status: "PENDING",
          created_at: payload.created_at
        }),
        muteHttpExceptions: true
      });
      if (res.getResponseCode() >= 200 && res.getResponseCode() < 300) {
        Logger.log("Saved to Supabase successfully: " + claimCode);
      } else {
        Logger.log("Supabase response: " + res.getContentText());
      }
    } catch (err) {
      Logger.log("Supabase Insert Error: " + err.message);
    }

    // 2. ส่งเข้า Web API (อัปเดตแคชและหน้าเว็บ Dashboard)
    try {
      UrlFetchApp.fetch(CONFIG.WEB_API_URL, {
        method: "POST",
        contentType: "application/json",
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
    } catch (wErr) {
      Logger.log("Web API notice: " + wErr.message);
    }

    // 3. ส่งการ์ดแจ้งเตือนเข้า Discord Webhook (ถ้าใส่ไว้)
    if (CONFIG.DISCORD_WEBHOOK_URL && CONFIG.DISCORD_WEBHOOK_URL.startsWith("https://discord.com/api/webhooks")) {
      sendDiscordCard(payload);
    }

  } catch (globalErr) {
    Logger.log("Fatal Error in onFormSubmit: " + globalErr.toString());
  }
}

/**
 * ดึงข้อมูลตามชื่อคำถามของฟอร์ม หรือชื่อคอลัมน์ของชีต
 */
function parseFormData(e) {
  let claimant_name = "ไม่ประสงค์ออกนาม";
  let claimant_class = "-";
  let claimant_contact = "-";
  let item_type = "ไม่ระบุชื่อสิ่งของ";
  let category = "อื่นๆ";
  let lost_location = "ไม่ระบุสถานที่";
  let lost_date = new Date().toISOString().slice(0, 10);
  let characteristics = "";
  let rawPhoto = "";

  if (e && e.namedValues) {
    const nv = e.namedValues;
    const getCol = function(exactName, fallbackList) {
      if (nv[exactName] && nv[exactName][0] !== undefined && String(nv[exactName][0]).trim() !== "") {
        return String(nv[exactName][0]).trim();
      }
      for (const k in nv) {
        for (let i = 0; i < fallbackList.length; i++) {
          if (k.toLowerCase().includes(fallbackList[i].toLowerCase())) {
            const val = nv[k];
            if (val && val.length > 0 && String(val[0]).trim() !== "") return String(val[0]).trim();
          }
        }
      }
      return "";
    };

    claimant_name = getCol("ชื่อ-นามสกุล นักเรียนผู้แจ้ง", ["ชื่อ-นามสกุล", "ผู้แจ้ง", "ชื่อ"]) || claimant_name;
    claimant_class = getCol("ระดับชั้น / ห้อง", ["ระดับชั้น", "ชั้น", "ห้อง"]) || claimant_class;
    claimant_contact = getCol("เบอร์โทรศัพท์ หรือช่องทางติดต่อกลับ", ["เบอร์โทร", "ติดต่อ", "phone"]) || claimant_contact;
    item_type = getCol("ชื่อสิ่งของที่ทำหาย", ["ชื่อสิ่งของ", "สิ่งของ"]) || item_type;
    category = getCol("หมวดหมู่สิ่งของ", ["หมวดหมู่", "ประเภท"]) || category;
    lost_location = getCol("จุดหรือบริเวณที่คาดว่าทำหาย", ["จุดหรือบริเวณ", "สถานที่", "บริเวณ"]) || lost_location;
    lost_date = getCol("วันที่ทำหาย", ["วันที่", "เวลา"]) || lost_date;
    characteristics = getCol("ลักษณะเด่น / ตำหนิ / รายละเอียดเพิ่มเติม", ["ลักษณะเด่น", "ตำหนิ", "รายละเอียด"]) || characteristics;
    rawPhoto = getCol("รูปประกอบของ ของสิ่งนั้น", ["รูปประกอบของ ของสิ่งนั้น", "รูปประกอบ", "ของสิ่งนั้น", "รูป", "ภาพ"]) || rawPhoto;
  } else if (e && e.values && Array.isArray(e.values)) {
    const v = e.values;
    claimant_name = v[1] || claimant_name;
    claimant_class = v[2] || claimant_class;
    claimant_contact = v[3] || claimant_contact;
    item_type = v[4] || item_type;
    category = v[5] || category;
    lost_location = v[6] || lost_location;
    lost_date = v[7] || lost_date;
    characteristics = v[8] || characteristics;
    rawPhoto = v[9] || rawPhoto;
  }

  // แปลงไฟล์ Google Drive และเปิดสิทธิ์ Anyone with link อัตโนมัติ
  const photos = processDriveFiles(rawPhoto);

  // แปลงรูปแบบวันที่เป็น YYYY-MM-DD (ค.ศ.) ป้องกันปัญหา PostgreSQL out of range
  const normalizeDate = function(str) {
    if (!str) return new Date().toISOString().slice(0, 10);
    str = String(str).trim();
    const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dmy) {
      const day = ("0" + dmy[1]).slice(-2);
      const month = ("0" + dmy[2]).slice(-2);
      let year = parseInt(dmy[3], 10);
      if (year > 2400) year -= 543;
      return year + "-" + month + "-" + day;
    }
    const ymd = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (ymd) {
      let year = parseInt(ymd[1], 10);
      if (year > 2400) year -= 543;
      const month = ("0" + ymd[2]).slice(-2);
      const day = ("0" + ymd[3]).slice(-2);
      return year + "-" + month + "-" + day;
    }
    return new Date().toISOString().slice(0, 10);
  };

  return {
    claimant_name: claimant_name,
    claimant_class: claimant_class,
    claimant_contact: claimant_contact,
    item_type: item_type,
    category: category,
    lost_location: lost_location,
    lost_date: normalizeDate(lost_date),
    characteristics: characteristics || "ไม่มีรายละเอียด",
    photo_url: photos.primary,
    photo_urls: photos.all
  };
}

/**
 * เปิดสิทธิ์ไฟล์ใน Drive ให้ทุกคนดูได้ และสร้าง Thumbnail URL
 */
function processDriveFiles(rawVal) {
  if (!rawVal) return { primary: "", all: [] };
  const rawStr = Array.isArray(rawVal) ? rawVal.join(", ") : String(rawVal);
  const ids = rawStr.match(/[-\w]{25,}/g) || [];
  const urls = [];

  for (let i = 0; i < ids.length; i++) {
    const fileId = ids[i];
    try {
      const file = DriveApp.getFileById(fileId);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      urls.push("https://drive.google.com/thumbnail?id=" + fileId + "&sz=w1000");
    } catch (e) {
      urls.push("https://drive.google.com/thumbnail?id=" + fileId + "&sz=w1000");
    }
  }

  if (urls.length === 0 && rawStr.startsWith("http")) {
    urls.push(rawStr.trim());
  }

  return {
    primary: urls[0] || "",
    all: urls
  };
}

/**
 * ส่งการ์ดแจ้งเตือนเข้าห้อง Discord #📦│แจ้งพบของหาย
 */
function sendDiscordCard(payload) {
  try {
    const embed = {
      title: "🔔 [คำร้องแจ้งของหายใหม่!] รหัส: " + payload.claim_code,
      description:
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
        "👤 **ผู้แจ้ง:** " + payload.claimant_name + " (ชั้น " + payload.claimant_class + ")\n" +
        "📞 **เบอร์ติดต่อ:** " + payload.claimant_contact + "\n" +
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
        "📦 **สิ่งของ:** " + payload.item_type + "\n" +
        "🏷️ **หมวดหมู่:** " + payload.category + "\n" +
        "📍 **จุดที่คาดว่าทำหาย:** " + payload.lost_location + "\n" +
        "📅 **วันที่ทำหาย:** " + payload.lost_date + "\n" +
        "🔍 **ลักษณะเด่น:** " + payload.characteristics + "\n" +
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      color: 0xF39C12,
      footer: { text: "ระบบรับแจ้งของหายดิจิทัล • โรงเรียนพระนารายณ์" },
      timestamp: new Date().toISOString()
    };

    if (payload.photo_url) {
      embed.image = { url: payload.photo_url };
    }

    UrlFetchApp.fetch(CONFIG.DISCORD_WEBHOOK_URL, {
      method: "POST",
      contentType: "application/json",
      payload: JSON.stringify({
        content: "📢 **[แจ้งเตือนสารวัตร]** มีคำร้องแจ้งของหายใหม่จาก Google Form:",
        embeds: [embed],
        components: [{
          type: 1,
          components: [{
            type: 2,
            style: 5,
            label: "🌐 เปิดดูใน Web Dashboard",
            url: CONFIG.WEB_DASHBOARD_URL
          }]
        }]
      }),
      muteHttpExceptions: true
    });
  } catch (err) {
    Logger.log("Discord error: " + err.message);
  }
}

/**
 * ทดสอบส่งข้อมูลเข้าฐานข้อมูลทันที
 */
function testSendToDatabase() {
  const mockEvent = {
    namedValues: {
      "Timestamp": [new Date().toLocaleString("th-TH")],
      "ชื่อ-นามสกุล นักเรียนผู้แจ้ง": ["นายทดสอบ เชื่อมต่อฐานข้อมูล"],
      "ระดับชั้น / ห้อง": ["ม.5/1"],
      "เบอร์โทรศัพท์ หรือช่องทางติดต่อกลับ": ["089-111-2222"],
      "ชื่อสิ่งของที่ทำหาย": ["หูฟังไร้สาย AirPods Pro"],
      "หมวดหมู่สิ่งของ": ["อุปกรณ์อิเล็กทรอนิกส์ / โทรศัพท์ / หูฟัง"],
      "จุดหรือบริเวณที่คาดว่าทำหาย": ["โรงอาหาร 2 ใกล้ร้านน้ำ"],
      "วันที่ทำหาย": [new Date().toLocaleDateString("th-TH")],
      "ลักษณะเด่น / ตำหนิ / รายละเอียดเพิ่มเติม": ["เคสสีดำ มีสติกเกอร์รูปดาว"],
      "รูปประกอบของ ของสิ่งนั้น": ["https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?w=500"]
    }
  };
  onFormSubmit(mockEvent);
}
