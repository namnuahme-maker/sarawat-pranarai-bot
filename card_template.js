/**
 * 🪪 SARAWAT PRANARAI - ID CARD HTML TEMPLATE (v6.0 Exact Mockup Replica)
 * - สัดส่วน 430px x 680px มาตรฐาน CR80 เป๊ะ 100%
 * - แถบขอบซ้ายน้ำเงิน (#002b80) / แถบขอบขวาแดง (#b91c1c)
 * - ฟอนต์หัว SARAWAT กว้างหนาพิเศษ (Syncopate 700 / Chakra Petch 800) ชิดขอบซ้ายจรดขวา
 * - ข้อความ INSPECTOR แบบกลวง (Hollow / Stroke) สีโปร่งใสขอบเทา อยู่ใต้คำว่า SARAWAT
 * - ข้อความแนวตั้ง PRANARAI SCHOOL ชิดข้างในแถบแดงทางขวา
 * - ตราสารวัตรนักเรียนแบบโปร่งแสง (Watermark) หมุนเอียง 15 องศา อยู่ด้านหลังไหล่ซ้าย
 * - รูปนักเรียนแบบไม่มีกรอบสี่เหลี่ยมสีดำ ไล่เฉดโปร่งแสง (Gradient fade-out) กลืนลงล่าง
 * - ชื่อเล่นอังกฤษ (เช่น NAMNUAH) ตัวหนากว้างพิเศษเต็มความกว้าง
 * - รหัสประจำตัว (เช่น M5-7-TS1-0634125121) ตัวหนากว้างพิเศษ
 * - โซนล่าง: ซ้ายชื่อเล่นไทย + ชื่อจริงไทย + บาร์โค้ด Code128 / ขวาตราโรงเรียนพระนารายณ์แบบตั้งตรงไม่มีกรอบ
 * - ปราศจากกรอบบอกระยะสีดำในบัตรจริง 100%
 */

'use strict';

const fs = require('fs');
const path = require('path');

function getAssetBase64(filename) {
  const possibleDirs = [
    path.join(__dirname, 'assets'),
    path.join(__dirname, '..', 'assets'),
    path.join(__dirname, 'web', 'public', 'assets'),
    path.join(__dirname, '..', 'web', 'public', 'assets')
  ];

  for (const d of possibleDirs) {
    const fullPath = path.join(d, filename);
    if (fs.existsSync(fullPath)) {
      try {
        const ext = path.extname(filename).toLowerCase();
        const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
        return `data:${mime};base64,${fs.readFileSync(fullPath).toString('base64')}`;
      } catch (e) {}
    }
  }
  return '';
}

const COMMON_NICKNAMES = {
  'น้ำเหนือ': 'NAMNUAH',
  'นำเหนือ': 'NAMNUAH',
  'น้ำำ': 'NAM',
  'น้ำ': 'NAM',
  'ปัน': 'PUN',
  'คิว': 'Q',
  'แบงก์': 'BANK',
  'แบงค์': 'BANK',
  'กานต์': 'KANT',
  'บีม': 'BEAM',
  'ภีมะ': 'PEEMA',
  'นาย': 'NINE',
  'น้ำชา': 'NAMCHA',
  'พิมมี่': 'PIMMY',
  'นน': 'NON',
  'ดิสดิส': 'DISDIS',
  'โบ๊ท': 'BOAT',
  'โบ๊ต': 'BOAT',
  'บอส': 'BOSS',
  'เบสท์': 'BEST',
  'เบส': 'BEST',
  'แบงค์': 'BANK',
  'แบงก์': 'BANK',
  'อาร์ม': 'ARM',
  'ไอซ์': 'ICE',
  'กาย': 'GUY',
  'มิว': 'MEW',
  'ภูมิ': 'POOM',
  'วิน': 'WIN',
  'นิว': 'NEW',
  'ฟลุ๊ค': 'FLUKE',
  'ฟลุ๊คส์': 'FLUKE',
  'ฟลุค': 'FLUKE',
  'นนท์': 'NON',
  'นนท': 'NON',
  'กันต์': 'GUN',
  'กัน': 'GUN',
  'มาร์ค': 'MARK',
  'มาร์คัส': 'MARCUS',
  'เกม': 'GAME',
  'เกมส์': 'GAME',
  'ก้อง': 'KONG',
  'เฟิร์ส': 'FIRST',
  'บิว': 'BEW',
  'เต้': 'TAE',
  'ตูน': 'TOON',
  'ต้น': 'TON',
  'นัท': 'NUT',
  'พี': 'PEE',
  'พีท': 'PETE',
  'กอล์ฟ': 'GOLF',
  'กิ๊ฟ': 'GIFT',
  'แอน': 'ANN',
  'ฟ้า': 'FAH',
  'พลอย': 'PLOY',
  'มายด์': 'MIND',
  'มาย': 'MIND',
  'เฟิร์น': 'FERN',
  'มุก': 'MOOK',
  'บิวตี้': 'BEAUTY',
  'เจมส์': 'JAMES',
  'ปอนด์': 'POUND',
  'โฟกัส': 'FOCUS',
  'มิกซ์': 'MIX',
  'ออฟ': 'OFF',
  'เต๋า': 'TAO',
  'ท็อป': 'TOP',
  'มิ้น': 'MINT',
  'มินต์': 'MINT',
  'แพร': 'PRAE',
  'พิม': 'PIM',
  'บอม': 'BOMB',
  'บอมบ์': 'BOMB',
  'เบียร์': 'BEER',
  'วิว': 'VIEW',
  'โอ๊ค': 'OAK',
  'เอิร์ธ': 'EARTH',
  'ข้าว': 'KHAO',
  'เนย': 'NOEY',
  'เตย': 'TOEY',
  'เป็ด': 'PED',
  'ไก่': 'KAI',
  'หมู': 'MOO',
  'ปลา': 'PLA'
};

function romanizeThaiNickname(thai) {
  if (!thai) return 'SARAWAT';
  const clean = thai.trim();
  if (!clean || clean === '.' || clean === '-') return 'SARAWAT';
  
  if (/^[A-Za-z0-9_\-\s]+$/.test(clean)) {
    return clean.toUpperCase();
  }

  if (COMMON_NICKNAMES[clean]) {
    return COMMON_NICKNAMES[clean];
  }

  const withoutTones = clean.replace(/[\u0E48-\u0E4C\u0E47\u0E4D\u0E4E\u0E3A]/g, '');
  if (COMMON_NICKNAMES[withoutTones]) {
    return COMMON_NICKNAMES[withoutTones];
  }

  for (const [k, v] of Object.entries(COMMON_NICKNAMES)) {
    if (clean === k || withoutTones === k) return v;
  }

  let res = clean;
  res = res.replace(/เ(.*)ือ(.*)/g, '$1UAH$2');
  res = res.replace(/แ(.*)ว/g, '$1AEW');
  res = res.replace(/เ(.*)ย/g, '$1OEY');
  res = res.replace(/เ(.*)า/g, '$1AO');
  res = res.replace(/โ(.*)ะ/g, '$1O');
  res = res.replace(/โ(.*)/g, '$1O');
  res = res.replace(/แ(.*)/g, '$1AE');
  res = res.replace(/เ(.*)/g, '$1E');
  res = res.replace(/ำ/g, 'AM');
  res = res.replace(/ั/g, 'U');
  res = res.replace(/า/g, 'A');
  res = res.replace(/ิ/g, 'I');
  res = res.replace(/ี/g, 'EE');
  res = res.replace(/ึ/g, 'EU');
  res = res.replace(/ื/g, 'EU');
  res = res.replace(/ุ/g, 'U');
  res = res.replace(/ู/g, 'OO');
  
  const consonants = {
    'ก': 'K', 'ข': 'KH', 'ฃ': 'KH', 'ค': 'KH', 'ฅ': 'KH', 'ฆ': 'KH',
    'ง': 'NG', 'จ': 'J', 'ฉ': 'CH', 'ช': 'CH', 'ซ': 'S', 'ฌ': 'CH',
    'ญ': 'Y', 'ด': 'D', 'ต': 'T', 'ถ': 'TH', 'ท': 'TH', 'ธ': 'TH',
    'น': 'N', 'บ': 'B', 'ป': 'P', 'ผ': 'PH', 'ฝ': 'F', 'พ': 'PH',
    'ฟ': 'F', 'ภ': 'PH', 'ม': 'M', 'ย': 'Y', 'ร': 'R', 'ล': 'L',
    'ว': 'W', 'ศ': 'S', 'ษ': 'S', 'ส': 'S', 'ห': 'H', 'ฬ': 'L',
    'อ': 'O', 'ฮ': 'H', 'ๆ': ''
  };

  let out = '';
  for (let i = 0; i < res.length; i++) {
    const ch = res[i];
    if (consonants[ch] !== undefined) {
      out += consonants[ch];
    } else if (/[A-Z0-9]/i.test(ch)) {
      out += ch.toUpperCase();
    }
  }

  out = out.replace(/[^A-Z0-9]/g, '');
  return out || 'SARAWAT';
}

function generateCardHTML(member) {
  const schoolEmblemB64 = getAssetBase64('school_emblem.png');
  const inspectorLogoB64 = getAssetBase64('logo.png') || getAssetBase64('logo.jpg');
  
  // โหลดคอนฟิกเทมเพลตล่าสุดจาก card_layout_config.json ถ้ามี
  let customConfig = null;
  const configPaths = [
    path.join(__dirname, 'card_layout_config.json'),
    path.join(__dirname, 'web', 'card_layout_config.json'),
    path.join(__dirname, '..', 'card_layout_config.json')
  ];
  for (const cp of configPaths) {
    if (fs.existsSync(cp)) {
      try {
        customConfig = JSON.parse(fs.readFileSync(cp, 'utf8'));
        break;
      } catch (e) {}
    }
  }

  const rawNickname = member.nickname || 'SARAWAT';
  const englishNickname = romanizeThaiNickname(rawNickname);
  const thaiNickname = member.thai_nickname || rawNickname;
  const rawClass = (member.grade_class || '').replace('ม.', '').trim();
  const classDisplay = rawClass ? `M${rawClass.replace('/', '-')}` : 'M5-7';
  const dutyId = member.duty_id || 'TS1';
  const phoneOrNo = member.phone_number || member.student_no || '0634125121';
  const codeLine = `${classDisplay}-${dutyId}-${phoneOrNo}`;
  const studentNo = member.student_no || '69055';
  
  let fullName = `${member.first_name || ''} ${member.last_name || ''}`.trim();
  if (!fullName) fullName = member.name || 'นายณิชกานต์ คำไชย';
  if (!fullName.startsWith('นาย') && !fullName.startsWith('นางสาว') && !fullName.startsWith('ด.ช.') && !fullName.startsWith('ด.ญ.')) {
    fullName = `นาย${fullName}`;
  }
  
  const barcodeValue = `${dutyId}-${studentNo}`;
  const photoUrl = member.profile_image_url || '';

  // ค่าพิกัดแบบไดนามิกจาก Custom Template หรือ Default
  const el = (customConfig && customConfig.elements) || {};
  const sTopPhoto = el.photo ? el.photo.top : 125;
  const sHeightPhoto = el.photo ? el.photo.height : 360;
  const sTopWhiteFade = Math.max(0, sTopPhoto + sHeightPhoto - 175);

  let cardInnerHtml = '';
  if (customConfig && customConfig.elements && Object.keys(customConfig.elements).length > 0) {
    let elementsHtml = '';
    for (const [key, elem] of Object.entries(customConfig.elements)) {
      const left = Math.round(elem.left || 0);
      const top = Math.round(elem.top || 0);
      const width = elem.width ? `${Math.round(elem.width)}px` : 'auto';
      const height = elem.height ? `${Math.round(elem.height)}px` : 'auto';
      const opacity = elem.opacity !== undefined ? elem.opacity : 1;
      const angle = elem.angle || 0;

      if (elem.type === 'rect') {
        elementsHtml += `
          <div style="position: absolute; left: ${left}px; top: ${top}px; width: ${width}; height: ${height}; background: ${elem.fill || '#000'}; opacity: ${opacity}; z-index: 25; pointer-events: none;"></div>
        `;
      } else if (elem.type === 'image' && elem.src) {
        let imgSrc = elem.src;
        if (imgSrc.includes('logo.png') || imgSrc.includes('logo.jpg')) {
          imgSrc = inspectorLogoB64 || imgSrc;
        } else if (imgSrc.includes('school_emblem.png')) {
          imgSrc = schoolEmblemB64 || imgSrc;
        }
        const transform = angle ? `transform: rotate(${angle}deg);` : '';
        elementsHtml += `
          <img src="${imgSrc}" style="position: absolute; left: ${left}px; top: ${top}px; width: ${width}; height: ${height}; object-fit: contain; opacity: ${opacity}; ${transform} z-index: ${key.includes('watermark') ? 2 : 20}; pointer-events: none;" alt="${elem.name || ''}">
        `;
      } else if (elem.type === 'photo') {
        elementsHtml += `
          <div style="position: absolute; left: ${left}px; top: ${top}px; width: ${width}; height: ${height}; display: flex; align-items: center; justify-content: center; z-index: 5; pointer-events: none;">
            ${photoUrl 
              ? `<img src="${photoUrl}" style="width: 100%; height: 100%; object-fit: cover; object-position: top center; -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 75%, rgba(0,0,0,0) 100%); mask-image: linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 75%, rgba(0,0,0,0) 100%);" crossorigin="anonymous" alt="Photo">` 
              : `<span style="font-size: 80px; color: #94a3b8;">👤</span>`
            }
          </div>
        `;
      } else if (elem.type === 'text') {
        let textVal = elem.text;
        if (textVal === '{{nickname}}') textVal = englishNickname;
        if (textVal === '{{codeline}}') textVal = codeLine;
        if (textVal === '{{thaiNickname}}') textVal = thaiNickname;
        if (textVal === '{{thaiFullname}}') textVal = fullName;

        const fontSize = Math.round(elem.fontSize || 20);
        const charSpacing = elem.charSpacing ? `${(elem.charSpacing / 1000) * 10}px` : 'normal';
        const strokeStyle = elem.stroke ? `-webkit-text-stroke: ${elem.strokeWidth || 1}px ${elem.stroke};` : '';
        const originTransform = elem.originX === 'center' ? 'translateX(-50%)' : '';
        const rotTransform = angle ? `rotate(${angle}deg)` : '';
        const scaleYTransform = elem.scaleY ? `scaleY(${elem.scaleY})` : '';
        const combinedTransform = [originTransform, rotTransform, scaleYTransform].filter(Boolean).join(' ');
        const transformStyle = combinedTransform ? `transform: ${combinedTransform};` : '';

        elementsHtml += `
          <div style="position: absolute; left: ${left}px; top: ${top}px; ${transformStyle} font-family: '${elem.fontFamily || 'Prompt'}', sans-serif; font-size: ${fontSize}px; font-weight: ${elem.fontWeight || 'normal'}; color: ${elem.fill || '#050505'}; letter-spacing: ${charSpacing}; ${strokeStyle} opacity: ${opacity}; z-index: 20; white-space: nowrap; pointer-events: none; text-align: ${elem.originX || 'left'};">
            ${textVal}
          </div>
        `;
      } else if (elem.type === 'barcode') {
        elementsHtml += `
          <div style="position: absolute; left: ${left}px; top: ${top}px; width: ${width}; height: ${height}; display: flex; align-items: center; justify-content: center; z-index: 20; pointer-events: none;">
            <svg id="cardBarcode" style="width: 100%; height: 100%;"></svg>
          </div>
        `;
      }
    }

    cardInnerHtml = `
      <!-- Ambient Glow Fades (Over photo & background, strictly below all text) -->
      <div class="glow-fade-blue"></div>
      <div class="glow-fade-red"></div>
      <div class="glow-fade-white-bottom" style="top: ${sTopWhiteFade}px;"></div>

      ${elementsHtml}
    `;
  } else {
    cardInnerHtml = `
      <!-- Side Stripes -->
      <div class="stripe-blue"></div>
      <div class="stripe-red"></div>

      <!-- Right Vertical School Text -->
      <div class="vertical-school-text">PRANARAI SCHOOL</div>

      <!-- Watermark Emblem Behind Left Shoulder -->
      ${inspectorLogoB64 ? `<img src="${inspectorLogoB64}" class="watermark-emblem" alt="Watermark">` : ''}

      <!-- Center Photo with Soft Gradient Fade-Out -->
      <div class="photo-center-area">
        ${photoUrl 
          ? `<img src="${photoUrl}" class="photo-fade-img" crossorigin="anonymous" alt="Photo">` 
          : `<span class="photo-fallback">👤</span>`
        }
      </div>

      <!-- Ambient Glow Fades (Over photo & background, strictly below all text) -->
      <div class="glow-fade-blue"></div>
      <div class="glow-fade-red"></div>
      <div class="glow-fade-white-bottom" style="top: ${sTopWhiteFade}px;"></div>

      <!-- Top Header -->
      <div class="header-wrap" style="position: absolute; left: 13px; right: 13px; top: 10px;">
        <div class="title-sarawat">SARAWAT</div>
        <div class="title-inspector">INSPECTOR</div>
      </div>

      <!-- Mid Text: Nickname & Code -->
      <div class="mid-text-section">
        <div class="text-nickname-big">${englishNickname}</div>
        <div class="text-code-line">${codeLine}</div>
      </div>

      <!-- Bottom Details -->
      <div class="bottom-row-section">
        <div class="bottom-left-col">
          <div class="text-thai-nick">${thaiNickname}</div>
          <div class="text-thai-full">${fullName}</div>
          <div class="barcode-svg-wrap">
            <svg id="cardBarcode"></svg>
          </div>
        </div>
        <div class="bottom-right-col">
          ${schoolEmblemB64 ? `<img src="${schoolEmblemB64}" class="school-crest-img" alt="School Emblem">` : ''}
        </div>
      </div>
    `;
  }

  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>บัตรประจำตัวสารวัตรนักเรียน - ${fullName} (${englishNickname})</title>
  
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Syncopate:wght@400;700&family=Chakra+Petch:wght@500;600;700;800&family=Michroma&family=Kanit:ital,wght@0,400;0,600;0,700;0,800;0,900&family=Prompt:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"></script>
  
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: #0b1120;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px 10px;
      font-family: 'Prompt', sans-serif;
      color: #f8fafc;
    }

    .card-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 100%;
      max-width: 440px;
    }

    /* CARD CONTAINER: 430px x 680px (Standard CR80 Ratio) */
    .id-card {
      width: 430px;
      height: 680px;
      background: #ffffff;
      position: relative;
      overflow: hidden;
      border-radius: 6px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
      user-select: none;
    }

    /* Left Blue Stripe / Right Red Stripe */
    .stripe-blue {
      position: absolute;
      left: 0; top: 0; bottom: 0;
      width: 13px;
      background: #002b80;
      z-index: 30;
    }
    .stripe-red {
      position: absolute;
      right: 0; top: 0; bottom: 0;
      width: 13px;
      background: #b91c1c;
      z-index: 30;
    }

    /* Ambient Glow Fades (Soft Blue from left, Soft Red from right, Soft White upwards from photo bottom) */
    .glow-fade-blue {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 140px;
      background: linear-gradient(to right, rgba(0, 43, 128, 0.22) 0%, rgba(0, 43, 128, 0.08) 45%, rgba(0, 43, 128, 0) 100%);
      z-index: 8;
      pointer-events: none;
    }
    .glow-fade-red {
      position: absolute;
      right: 0;
      top: 0;
      bottom: 0;
      width: 140px;
      background: linear-gradient(to left, rgba(185, 28, 28, 0.22) 0%, rgba(185, 28, 28, 0.08) 45%, rgba(185, 28, 28, 0) 100%);
      z-index: 8;
      pointer-events: none;
    }
    .glow-fade-white-bottom {
      position: absolute;
      left: 0;
      right: 0;
      height: 180px;
      background: linear-gradient(to top, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0.5) 45%, rgba(255, 255, 255, 0) 100%);
      z-index: 8;
      pointer-events: none;
    }

    /* Vertical PRANARAI SCHOOL text alongside red stripe */
    .vertical-school-text {
      position: absolute;
      right: 17px;
      top: 108px;
      writing-mode: vertical-rl;
      text-orientation: mixed;
      font-family: 'Syncopate', 'Chakra Petch', 'Kanit', sans-serif;
      font-weight: 700;
      font-size: 13px;
      letter-spacing: 5px;
      color: #050505;
      z-index: 25;
      text-transform: uppercase;
    }

    /* Watermark Seal */
    .watermark-emblem {
      position: absolute;
      left: -20px;
      top: 75px;
      width: 250px;
      height: 250px;
      object-fit: contain;
      opacity: 0.45;
      transform: rotate(-14deg);
      pointer-events: none;
      z-index: 2;
    }

    /* CARD CONTENT WRAPPER */
    .card-content {
      position: absolute;
      left: 13px;
      right: 13px;
      top: 0;
      bottom: 0;
      padding: 10px 8px 12px 10px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      z-index: 10;
    }

    /* HEADER */
    .header-wrap {
      width: 100%;
      text-align: center;
      padding-top: 2px;
      position: relative;
      z-index: 20;
    }
    .title-sarawat {
      font-family: 'Syncopate', 'Chakra Petch', sans-serif;
      font-weight: 700;
      font-size: 47px;
      line-height: 0.9;
      letter-spacing: 4px;
      color: #050505;
      text-transform: uppercase;
      text-align: center;
      width: 100%;
      transform: scaleY(1.05);
    }
    .title-inspector {
      font-family: 'Syncopate', 'Chakra Petch', sans-serif;
      font-weight: 700;
      font-size: 26px;
      letter-spacing: 7px;
      line-height: 1;
      margin-top: -2px;
      color: transparent;
      -webkit-text-stroke: 1.2px #94a3b8;
      text-transform: uppercase;
      text-align: center;
      width: 100%;
    }

    /* MIDDLE: PHOTO */
    .photo-center-area {
      position: absolute;
      left: 35px;
      right: 45px;
      top: 125px;
      height: 360px;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 5;
      pointer-events: none;
    }
    .photo-fade-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: top center;
      -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 75%, rgba(0,0,0,0) 100%);
      mask-image: linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 75%, rgba(0,0,0,0) 100%);
    }
    .photo-fallback {
      font-size: 80px;
      color: #94a3b8;
    }

    /* MIDDLE-LOWER TEXT SECTION */
    .mid-text-section {
      position: absolute;
      left: 13px;
      right: 13px;
      bottom: 125px;
      padding: 0 4px;
      z-index: 20;
      text-align: center;
    }
    .text-nickname-big {
      font-family: 'Syncopate', 'Chakra Petch', sans-serif;
      font-weight: 700;
      font-size: 47px;
      line-height: 0.9;
      letter-spacing: 5px;
      color: #050505;
      text-transform: uppercase;
      text-align: center;
      width: 100%;
      transform: scaleY(1.05);
    }
    .text-code-line {
      font-family: 'Syncopate', 'Chakra Petch', sans-serif;
      font-weight: 700;
      font-size: 19px;
      letter-spacing: 2.2px;
      line-height: 1.1;
      color: #050505;
      text-transform: uppercase;
      text-align: center;
      margin-top: 4px;
      width: 100%;
      white-space: nowrap;
    }

    /* BOTTOM ROW: LEFT NAMES + BARCODE / RIGHT SCHOOL EMBLEM */
    .bottom-row-section {
      position: absolute;
      left: 13px;
      right: 13px;
      bottom: 12px;
      padding: 0 10px 0 14px;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      z-index: 20;
    }
    .bottom-left-col {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-end;
      flex: 1;
      text-align: center;
      padding-right: 10px;
    }
    .text-thai-nick {
      font-family: 'Prompt', 'Kanit', sans-serif;
      font-weight: 700;
      font-size: 20px;
      line-height: 1.1;
      color: #050505;
      text-align: center;
    }
    .text-thai-full {
      font-family: 'Prompt', 'Kanit', sans-serif;
      font-weight: 600;
      font-size: 15px;
      line-height: 1.2;
      color: #050505;
      text-align: center;
      margin-top: 2px;
      white-space: nowrap;
    }
    .barcode-svg-wrap {
      margin-top: 3px;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 185px;
      height: 48px;
    }
    .barcode-svg-wrap svg {
      width: 100%;
      height: 48px;
    }

    .bottom-right-col {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      padding-bottom: 2px;
    }
    .school-crest-img {
      width: 78px;
      height: 98px;
      object-fit: contain;
    }

    /* ACTION BUTTONS */
    .actions {
      margin-top: 20px;
      display: flex;
      gap: 12px;
      justify-content: center;
      width: 100%;
    }
    .btn {
      padding: 12px 24px;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 700;
      border: none;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s;
    }
    .btn-download {
      background: linear-gradient(135deg, #2563eb, #1d4ed8);
      color: #fff;
      box-shadow: 0 4px 14px rgba(37, 99, 235, 0.4);
    }
    .btn-download:hover { transform: translateY(-1px); }
    .btn-print {
      background: #334155;
      color: #f8fafc;
    }

    @media print {
      body { background: transparent; padding: 0; }
      .actions { display: none !important; }
      .id-card { box-shadow: none !important; margin: 0 auto; }
    }
  </style>
</head>
<body>

  <div class="card-wrap">
    <div class="id-card" id="idCard">
      ${cardInnerHtml}
    </div>

    <div class="actions">
      <button class="btn btn-download" id="btnDl" onclick="downloadPNG()">
        📥 บันทึกรูปภาพบัตร (PNG)
      </button>
      <button class="btn btn-print" onclick="window.print()">
        🖨️ พิมพ์บัตร
      </button>
    </div>
  </div>

  <script>
    try {
      JsBarcode("#cardBarcode", "${barcodeValue}", {
        format: "CODE128",
        width: 1.7,
        height: 48,
        displayValue: false,
        margin: 0,
        background: "transparent",
        lineColor: "#050505"
      });
    } catch (e) {}

    async function downloadPNG() {
      const btn = document.getElementById('btnDl');
      const oldText = btn.innerHTML;
      btn.innerHTML = '⏳ กำลังประมวลผล...';
      btn.disabled = true;

      try {
        const card = document.getElementById('idCard');
        const canvas = await html2canvas(card, {
          width: 430,
          height: 680,
          scale: 2, // 2x High-Res
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff'
        });
        const link = document.createElement('a');
        link.download = 'SARAWAT_CARD_${dutyId}_${englishNickname}.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
        btn.innerHTML = '✅ บันทึกสำเร็จ!';
        setTimeout(() => { btn.innerHTML = oldText; btn.disabled = false; }, 2000);
      } catch (err) {
        alert('เกิดข้อผิดพลาด: ' + err.message);
        btn.innerHTML = oldText;
        btn.disabled = false;
      }
    }
  </script>
</body>
</html>`;
}

module.exports = { generateCardHTML, romanizeThaiNickname };
