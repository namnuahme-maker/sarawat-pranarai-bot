/**
 * ==============================================================================
 * 🌟 SARAWAT PRANARAI - ALL-IN-ONE MASTER GOOGLE APPS SCRIPT (V2.0)
 * ระบบศูนย์บัญชาการสารวัตรนักเรียน โรงเรียนพระนารายณ์
 * 
 * รวมทุกการทำงานไว้ในไฟล์เดียว 100%:
 * 1. 📁 จัดระเบียบไดรฟ์อัตโนมัติ (กวาดไฟล์ที่กระจัดกระจายเข้าโฟลเดอร์ 01-04 ทันที)
 * 2. 🌐 Webhook Gateway กลาง (รับอัปโหลดรูปจาก Bot / Web ไปยังโฟลเดอร์ที่ถูกต้อง)
 * 3. 📦 ดูดรูปสิ่งของที่พบเจอ (lost_items) จาก Supabase เข้าโฟลเดอร์ 03_สิ่งของที่พบเจอ
 * 4. 📝 รับฟอร์มแจ้งของหาย (Google Forms) ซิงค์เข้าฐานข้อมูลและขึ้นเว็บอัตโนมัติ
 * 5. 🔄 ซิงค์คำร้องย้อนหลังทั้งหมดในคลิกเดียว
 * ==============================================================================
 */

// ⚙️ ตั้งค่าการเชื่อมต่อระบบ
const MASTER_CONFIG = {
  // ฐานข้อมูล Supabase
  SUPABASE_URL: "https://cxrakrsyxvsrbpgphgtt.supabase.co",
  SUPABASE_KEY: "YOUR_SUPABASE_SERVICE_ROLE_KEY",

  // เว็บศูนย์บัญชาการสารวัตร Promax บน Render
  WEB_API_URL: "https://sarawat-promax.onrender.com",
  WEB_CLAIMS_URL: "https://sarawat-promax.onrender.com/api/lost-found/claims",

  // โฟลเดอร์เป้าหมาย 4 หมวดหลัก
  FOLDERS: {
    ROOT: "SARAWAT",
    PROFILES: "01_รูปโปรไฟล์สารวัตร",
    EVIDENCE: "02_หลักฐานคดี",
    LOST_FOUND: "03_สิ่งของที่พบเจอ",
    ATTENDANCE: "04_ใบเช็คชื่อและลงเวลา"
  },

  // ID โฟลเดอร์สิ่งของที่พบเจอ (สำรองกรณีค้นหาตามชื่อไม่พบ)
  FALLBACK_LOST_FOLDER_ID: "1que123Zlr8ewcC5KD4Gx5DLZSbyJeapQ"
};

// ==============================================================================
// 1. 🧹 ฟังก์ชันจัดระเบียบไฟล์ใน Google Drive ทันที (แก้ปัญหาไฟล์กองรก)
// วิธีใช้: เลือกฟังก์ชัน "organizeAndCleanDrive" ด้านบน แล้วกดปุ่ม "Run"
// ==============================================================================
function organizeAndCleanDrive() {
  Logger.log("🧹 กำลังสแกนและจัดระเบียบไฟล์ในโฟลเดอร์ SARAWAT...");

  const rootFolders = DriveApp.getFoldersByName(MASTER_CONFIG.FOLDERS.ROOT);
  if (!rootFolders.hasNext()) {
    Logger.log("❌ ไม่พบโฟลเดอร์ชื่อ 'SARAWAT' ในไดรฟ์");
    return "ไม่พบโฟลเดอร์ SARAWAT";
  }

  const sarawatRoot = rootFolders.next();
  const files = sarawatRoot.getFiles();

  let countProfiles = 0;
  let countEvidences = 0;
  let countLostItems = 0;
  let countAttendance = 0;

  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName();
    const lower = name.toLowerCase();

    let targetFolder = null;

    if (lower.startsWith("profile_") || lower.includes("โปรไฟล์")) {
      targetFolder = getOrCreateTargetFolder(MASTER_CONFIG.FOLDERS.PROFILES, sarawatRoot);
      countProfiles++;
    } else if (lower.startsWith("evidence_") || lower.includes("case-") || lower.includes("bodycam")) {
      targetFolder = getOrCreateTargetFolder(MASTER_CONFIG.FOLDERS.EVIDENCE, sarawatRoot);
      countEvidences++;
    } else if (lower.startsWith("lf-") || lower.includes("lost_") || lower.includes("ของหาย")) {
      targetFolder = getOrCreateTargetFolder(MASTER_CONFIG.FOLDERS.LOST_FOUND, sarawatRoot);
      countLostItems++;
    } else if (lower.includes("attendance") || lower.includes("เช็คชื่อ") || lower.includes("ลงเวลา")) {
      targetFolder = getOrCreateTargetFolder(MASTER_CONFIG.FOLDERS.ATTENDANCE, sarawatRoot);
      countAttendance++;
    }

    if (targetFolder && targetFolder.getId() !== sarawatRoot.getId()) {
      try {
        if (typeof file.moveTo === 'function') {
          file.moveTo(targetFolder);
        } else {
          targetFolder.addFile(file);
          sarawatRoot.removeFile(file);
        }
        Logger.log("📦 ย้ายเรียบร้อย: " + name + " ➡️ [" + targetFolder.getName() + "]");
      } catch (e) {
        Logger.log("⚠️ ย้ายไฟล์ " + name + " ล้มเหลว: " + e.message);
      }
    }
  }

  const result = "🎉 จัดระเบียบ Google Drive สำเร็จ!\n" +
    "- ย้ายรูปโปรไฟล์สารวัตรเข้า '01_รูปโปรไฟล์สารวัตร': " + countProfiles + " ไฟล์\n" +
    "- ย้ายหลักฐานคดีเข้า '02_หลักฐานคดี': " + countEvidences + " ไฟล์\n" +
    "- ย้ายของหายเข้า '03_สิ่งของที่พบเจอ': " + countLostItems + " ไฟล์\n" +
    "- ย้ายงานเช็คชื่อเข้า '04_ใบเช็คชื่อและลงเวลา': " + countAttendance + " ไฟล์";
  Logger.log(result);
  return result;
}

// ==============================================================================
// 2. 🌐 WEBHOOK GATEWAY (doPost) - รับอัปโหลดรูปจาก Bot และ Web Dashboard
// ส่งรูปเข้าโฟลเดอร์ 01-04 อัตโนมัติ ไม่กองในโฟลเดอร์หลักอีกต่อไป
// ==============================================================================
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ success: false, error: "No post data received" });
    }

    const data = JSON.parse(e.postData.contents);
    const category = (data.category || "").toLowerCase();
    const filename = data.filename || ("file_" + Date.now() + ".jpg");

    // เลือกโฟลเดอร์เป้าหมายอัตโนมัติตามประเภทและชื่อไฟล์
    let targetFolder = null;
    const rootFolders = DriveApp.getFoldersByName(MASTER_CONFIG.FOLDERS.ROOT);
    const sarawatRoot = rootFolders.hasNext() ? rootFolders.next() : null;

    if (category === "profile" || filename.toLowerCase().startsWith("profile_")) {
      targetFolder = getOrCreateTargetFolder(MASTER_CONFIG.FOLDERS.PROFILES, sarawatRoot);
    } else if (category === "case" || category === "evidence" || filename.toLowerCase().startsWith("evidence_") || filename.includes("CASE-")) {
      targetFolder = getOrCreateTargetFolder(MASTER_CONFIG.FOLDERS.EVIDENCE, sarawatRoot);
    } else if (category === "lost_found" || filename.toLowerCase().startsWith("lf-")) {
      targetFolder = getOrCreateTargetFolder(MASTER_CONFIG.FOLDERS.LOST_FOUND, sarawatRoot);
    } else if (category === "attendance") {
      targetFolder = getOrCreateTargetFolder(MASTER_CONFIG.FOLDERS.ATTENDANCE, sarawatRoot);
    } else if (data.folderId) {
      try { targetFolder = DriveApp.getFolderById(data.folderId); } catch (fErr) {}
    }

    if (!targetFolder) {
      targetFolder = sarawatRoot || DriveApp.getRootFolder();
    }

    // แปลง Base64 เป็นไฟล์และเซฟลงไดรฟ์
    const decodedBytes = Utilities.base64Decode(data.base64Data);
    const blob = Utilities.newBlob(decodedBytes, data.mimeType || "image/jpeg", filename);
    const file = targetFolder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    Logger.log("✅ บันทึกไฟล์สำเร็จ: " + filename + " ➡️ [" + targetFolder.getName() + "]");

    return jsonResponse({
      success: true,
      fileId: file.getId(),
      fileUrl: file.getUrl(),
      webViewLink: file.getUrl(),
      filename: filename,
      folderName: targetFolder.getName()
    });

  } catch (err) {
    Logger.log("❌ Error in doPost: " + err.toString());
    return jsonResponse({ success: false, error: err.toString() });
  }
}

function doGet(e) {
  return jsonResponse({
    status: "online",
    service: "SARAWAT PRANARAI All-in-One Master Gateway",
    version: "2.0",
    timestamp: new Date().toISOString()
  });
}

// ==============================================================================
// 3. 📦 ดูดรูปสิ่งของที่พบเจอจาก Supabase เข้าโฟลเดอร์ "03_สิ่งของที่พบเจอ" ทันที
// วิธีใช้: เลือกฟังก์ชัน "syncPhotosToDriveFolder" ด้านบน แล้วกดปุ่ม "Run"
// ==============================================================================
function syncPhotosToDriveFolder() {
  Logger.log("📦 เริ่มต้นดึงรูปสิ่งของที่พบเจอจาก Supabase เข้า Google Drive...");

  let folder = getOrCreateTargetFolder(MASTER_CONFIG.FOLDERS.LOST_FOUND);
  if (!folder) {
    try { folder = DriveApp.getFolderById(MASTER_CONFIG.FALLBACK_LOST_FOLDER_ID); } catch (e) {}
  }
  if (!folder) {
    Logger.log("❌ ไม่พบโฟลเดอร์ 03_สิ่งของที่พบเจอ");
    return "ไม่พบโฟลเดอร์";
  }

  Logger.log("📁 ปลายทางโฟลเดอร์: " + folder.getName());

  const endpoint = MASTER_CONFIG.SUPABASE_URL + "/rest/v1/lost_items?select=id,item_code,title,image_url";
  const res = UrlFetchApp.fetch(endpoint, {
    method: "GET",
    headers: {
      "apikey": MASTER_CONFIG.SUPABASE_KEY,
      "Authorization": "Bearer " + MASTER_CONFIG.SUPABASE_KEY
    },
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    Logger.log("❌ เชื่อมต่อ Supabase ไม่สำเร็จ: " + res.getContentText());
    return;
  }

  const items = JSON.parse(res.getContentText());
  Logger.log("📦 พบสิ่งของใน Supabase ทั้งหมด: " + items.length + " ชิ้น");

  let uploadedCount = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.image_url || !item.image_url.startsWith("http")) continue;

    const filename = (item.item_code || "LF-" + (i + 1)) + ".jpg";

    if (folder.getFilesByName(filename).hasNext()) {
      Logger.log("⏩ ไฟล์ " + filename + " มีอยู่ใน Drive แล้ว (ข้าม)");
      continue;
    }

    try {
      const imgRes = UrlFetchApp.fetch(item.image_url, { muteHttpExceptions: true });
      if (imgRes.getResponseCode() === 200) {
        const blob = imgRes.getBlob().setName(filename);
        const file = folder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        Logger.log("✅ บันทึกเข้า Drive สำเร็จ: " + filename + " (ID: " + file.getId() + ")");
        uploadedCount++;
      }
    } catch (err) {
      Logger.log("❌ เกิดข้อผิดพลาดในการโหลดรูป " + filename + ": " + err.message);
    }
  }

  const msg = "🎉 ซิงค์รูปภาพสิ่งของเข้า Google Drive สำเร็จ: " + uploadedCount + " ไฟล์";
  Logger.log(msg);
  return msg;
}

// ==============================================================================
// 4. 📝 ฟังก์ชันรับฟอร์ม Google Form และซิงค์คำร้องของหาย
// ==============================================================================
function onFormSubmit(e) {
  try {
    let namedValues = null;
    let values = null;

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
      namedValues = e.namedValues;
      values = e.values;
    }

    const row = parseFormData({ namedValues: namedValues, values: values });
    const claimCode = "CLM-" + new Date().getFullYear() + "-" + Math.floor(1000 + Math.random() * 9000);

    let chars = row.characteristics || "ไม่มีรายละเอียด";
    if (row.photo_url) chars += "\n📷 รูปแนบ: " + row.photo_url;

    const payload = {
      claim_code: claimCode,
      category: row.category || "อื่นๆ",
      item_type: row.item_type || "ไม่ระบุชื่อสิ่งของ",
      characteristics: chars,
      lost_location: row.lost_location || "ไม่ระบุสถานที่",
      lost_date: row.lost_date,
      claimant_name: row.claimant_name,
      claimant_class: row.claimant_class,
      claimant_contact: row.claimant_contact,
      status: "PENDING",
      created_at: new Date().toISOString()
    };

    // ส่งเข้า Supabase
    UrlFetchApp.fetch(MASTER_CONFIG.SUPABASE_URL.replace(/\/+$/, '') + "/rest/v1/lost_claims", {
      method: "POST",
      headers: {
        "apikey": MASTER_CONFIG.SUPABASE_KEY,
        "Authorization": "Bearer " + MASTER_CONFIG.SUPABASE_KEY,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    // ส่งเข้า Web Render
    UrlFetchApp.fetch(MASTER_CONFIG.WEB_CLAIMS_URL, {
      method: "POST",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

  } catch (err) {
    Logger.log("Error onFormSubmit: " + err.message);
  }
}

function syncAllPastResponses() {
  const entries = [];
  try {
    const form = FormApp.getActiveForm();
    if (form) {
      const responses = form.getResponses();
      for (let i = 0; i < responses.length; i++) {
        const fResp = responses[i];
        const itemResponses = fResp.getItemResponses();
        const namedValues = {};
        for (let j = 0; j < itemResponses.length; j++) {
          const item = itemResponses[j];
          namedValues[item.getItem().getTitle().trim()] = [item.getResponse()];
        }
        entries.push({ timestamp: fResp.getTimestamp(), namedValues: namedValues });
      }
    }
  } catch (e) {}

  if (entries.length === 0) {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      if (ss) {
        const data = ss.getActiveSheet().getDataRange().getValues();
        if (data && data.length >= 2) {
          const headers = data[0].map(h => String(h).trim());
          for (let r = 1; r < data.length; r++) {
            const row = data[r];
            if (!row || row.every(c => String(c).trim() === "")) continue;
            const nv = {};
            for (let c = 0; c < headers.length; c++) nv[headers[c]] = [row[c]];
            entries.push({ timestamp: row[0], namedValues: nv });
          }
        }
      }
    } catch (e) {}
  }

  let count = 0;
  for (let idx = 0; idx < entries.length; idx++) {
    const entry = entries[idx];
    const parsed = parseFormData({ namedValues: entry.namedValues });
    const claimCode = "CLM-" + new Date().getFullYear() + "-" + String(1001 + idx);
    let chars = parsed.characteristics || "ไม่มีรายละเอียด";
    if (parsed.photo_url) chars += "\n📷 รูปแนบ: " + parsed.photo_url;

    const payload = {
      claim_code: claimCode,
      category: parsed.category || "อื่นๆ",
      item_type: parsed.item_type || "ไม่ระบุชื่อสิ่งของ",
      characteristics: chars,
      lost_location: parsed.lost_location || "ไม่ระบุสถานที่",
      lost_date: parsed.lost_date,
      claimant_name: parsed.claimant_name,
      claimant_class: parsed.claimant_class,
      claimant_contact: parsed.claimant_contact,
      status: "PENDING",
      created_at: entry.timestamp ? new Date(entry.timestamp).toISOString() : new Date().toISOString()
    };

    try {
      UrlFetchApp.fetch(MASTER_CONFIG.SUPABASE_URL.replace(/\/+$/, '') + "/rest/v1/lost_claims", {
        method: "POST",
        headers: {
          "apikey": MASTER_CONFIG.SUPABASE_KEY,
          "Authorization": "Bearer " + MASTER_CONFIG.SUPABASE_KEY,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
      count++;
    } catch (e) {}
  }

  Logger.log("🎉 ซิงค์คำร้องย้อนหลังเสร็จสิ้น: " + count + " รายการ");
}

// ==============================================================================
// 🛠️ ฟังก์ชันช่วยเหลือ (Helper Utilities)
// ==============================================================================
function getOrCreateTargetFolder(folderName, parentFolder) {
  if (parentFolder) {
    const sub = parentFolder.getFolders();
    while (sub.hasNext()) {
      const f = sub.next();
      if (f.getName() === folderName) return f;
    }
    const prefix = folderName.substring(0, 3);
    const sub2 = parentFolder.getFolders();
    while (sub2.hasNext()) {
      const f = sub2.next();
      if (f.getName().startsWith(prefix) || f.getName().includes(prefix)) return f;
    }
    return parentFolder.createFolder(folderName);
  }

  const folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();

  const rootFolders = DriveApp.getFoldersByName(MASTER_CONFIG.FOLDERS.ROOT);
  if (rootFolders.hasNext()) {
    const root = rootFolders.next();
    const prefix = folderName.substring(0, 3);
    const sub = root.getFolders();
    while (sub.hasNext()) {
      const f = sub.next();
      if (f.getName().startsWith(prefix) || f.getName().includes(prefix)) return f;
    }
    return root.createFolder(folderName);
  }

  return DriveApp.createFolder(folderName);
}

function parseFormData(e) {
  let claimant_name = "ไม่ประสงค์ออกนาม", claimant_class = "-", claimant_contact = "-";
  let item_type = "ไม่ระบุชื่อสิ่งของ", category = "อื่นๆ", lost_location = "ไม่ระบุสถานที่";
  let lost_date = new Date().toISOString().slice(0, 10), characteristics = "", rawPhoto = "";

  if (e && e.namedValues) {
    const nv = e.namedValues;
    const getCol = (name, list) => {
      if (nv[name] && nv[name][0]) return String(nv[name][0]).trim();
      for (let k in nv) {
        if (list.some(sub => k.includes(sub)) && nv[k][0]) return String(nv[k][0]).trim();
      }
      return "";
    };
    claimant_name = getCol("ชื่อ-นามสกุล นักเรียนผู้แจ้ง", ["ชื่อ-นามสกุล", "ผู้แจ้ง"]) || claimant_name;
    claimant_class = getCol("ระดับชั้น / ห้อง", ["ระดับชั้น", "ห้อง"]) || claimant_class;
    claimant_contact = getCol("เบอร์โทรศัพท์ หรือช่องทางติดต่อกลับ", ["เบอร์โทร", "ติดต่อ"]) || claimant_contact;
    item_type = getCol("ชื่อสิ่งของที่ทำหาย", ["ชื่อสิ่งของ", "สิ่งของ"]) || item_type;
    category = getCol("หมวดหมู่สิ่งของ", ["หมวดหมู่"]) || category;
    lost_location = getCol("จุดหรือบริเวณที่คาดว่าทำหาย", ["จุด", "สถานที่"]) || lost_location;
    lost_date = getCol("วันที่ทำหาย", ["วันที่"]) || lost_date;
    characteristics = getCol("ลักษณะเด่น / ตำหนิ / รายละเอียดเพิ่มเติม", ["ลักษณะเด่น", "ตำหนิ"]) || characteristics;
    rawPhoto = getCol("รูปประกอบของ ของสิ่งนั้น", ["รูป", "ภาพ"]) || rawPhoto;
  }

  let photo_url = "";
  if (rawPhoto) {
    const ids = String(rawPhoto).match(/[-\w]{25,}/g);
    if (ids && ids[0]) {
      try {
        const f = DriveApp.getFileById(ids[0]);
        f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (x) {}
      photo_url = "https://drive.google.com/thumbnail?id=" + ids[0] + "&sz=w1000";
    }
  }

  const dmy = String(lost_date).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    let y = parseInt(dmy[3], 10);
    if (y > 2400) y -= 543;
    lost_date = y + "-" + ("0" + dmy[2]).slice(-2) + "-" + ("0" + dmy[1]).slice(-2);
  }

  return { claimant_name, claimant_class, claimant_contact, item_type, category, lost_location, lost_date, characteristics, photo_url };
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
