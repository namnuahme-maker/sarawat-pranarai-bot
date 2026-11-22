/**
 * 📦 สคริปต์เชื่อมต่อ Google Sheets (จาก Google Form ที่มีอยู่แล้ว) เข้าสู่ฐานข้อมูล Supabase & ศูนย์บัญชาการสารวัตร
 * โรงเรียนพระนารายณ์ • ฝ่ายบริหารงานสารวัตรนักเรียน
 * 
 * คอลัมน์ที่รองรับตรงกัน 100%:
 * [A] Timestamp (ประทับเวลา)
 * [B] ชื่อ-นามสกุล นักเรียนผู้แจ้ง
 * [C] ระดับชั้น / ห้อง
 * [D] เบอร์โทรศัพท์ หรือช่องทางติดต่อกลับ
 * [E] ชื่อสิ่งของที่ทำหาย
 * [F] หมวดหมู่สิ่งของ
 * [G] จุดหรือบริเวณที่คาดว่าทำหาย
 * [H] วันที่ทำหาย
 * [I] ลักษณะเด่น / ตำหนิ / รายละเอียดเพิ่มเติม
 * [J] รูปประกอบของ ของสิ่งนั้น
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
 * 🔄 ซิงค์ข้อมูลคำร้องย้อนหลังทั้งหมดที่มีในชีต เข้า Supabase และหน้าเว็บในคลิกเดียว!
 * วิธีใช้: ในหน้า Apps Script ให้เลือกฟังก์ชัน "syncAllPastResponses" ด้านบน แล้วกดปุ่ม "Run" (เรียกใช้)
 */
function syncAllPastResponses() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) {
    Logger.log("❌ ไม่พบข้อมูลคำร้องในชีต (มีแต่หัวตารางหรือว่างเปล่า)");
    return "ไม่พบข้อมูลในชีต";
  }

  const headers = data[0].map(function(h) { return String(h).trim(); });
  Logger.log("📌 Headers: " + JSON.stringify(headers));

  let successCount = 0;
  let failCount = 0;

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    // ข้ามแถวที่ว่างเปล่า
    if (!row || row.every(function(cell) { return String(cell).trim() === ""; })) continue;

    // สร้าง Map จากชื่อคอลัมน์
    const namedValues = {};
    for (let c = 0; c < headers.length; c++) {
      namedValues[headers[c]] = [row[c]];
    }

    const parsed = parseFormData({ namedValues: namedValues, values: row });
    const currentYear = new Date().getFullYear();
    const claimCode = "CLM-" + currentYear + "-" + String(1000 + r);

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
      created_at: row[0] ? new Date(row[0]).toISOString() : new Date().toISOString()
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
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });

      if (res.getResponseCode() >= 200 && res.getResponseCode() < 300) {
        successCount++;
        Logger.log("✅ แถวที่ " + (r + 1) + " บันทึกเข้า Supabase สำเร็จ: " + claimCode);
      } else {
        failCount++;
        Logger.log("⚠️ แถวที่ " + (r + 1) + " Supabase error (" + res.getResponseCode() + "): " + res.getContentText());
      }
    } catch (err) {
      failCount++;
      Logger.log("❌ แถวที่ " + (r + 1) + " Error: " + err.message);
    }

    // 2. ส่งเข้า Web API
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
 * ฟังก์ชันหลักที่ทำงานอัตโนมัติเมื่อมีคนส่ง Google Form เข้าสเปรดชีต
 */
function onFormSubmit(e) {
  try {
    const row = parseFormData(e);
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
    let dbSuccess = false;
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
        dbSuccess = true;
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
 * ดึงข้อมูลตามชื่อคอลัมน์ของชีต
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
    // รองรับกรณีดึงจากลำดับคอลัมน์ A-J โดยตรง
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

  // แปลงรูปแบบวันที่เป็น YYYY-MM-DD (ค.ศ.) ป้องกันปัญหา PostgreSQL out of range (เช่น พ.ศ. 2569 -> ค.ศ. 2026)
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

    if (payload.photo_urls && payload.photo_urls.length > 1) {
      embed.fields = [{
        name: "🖼️ รูปประกอบทั้งหมด (" + payload.photo_urls.length + " ไฟล์)",
        value: payload.photo_urls.map(function(u, idx) { return "[ดูรูปที่ " + (idx + 1) + "](" + u + ")"; }).join(" • ")
      }];
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
 * ฟังก์ชันสำหรับกดทดสอบส่งข้อมูลเข้าฐานข้อมูลทันที (กดปุ่ม Run ได้เลย)
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
