/**
 * 🧠 LOST & FOUND AI VISION SERVICE
 * ใช้ Google Gemini Flash (Cloud AI) วิเคราะห์ภาพสิ่งของที่พบเจอ
 * ประหยัด Token สูงสุด รันเฉพาะเมื่อผู้ใช้กดปุ่มสั่งการ
 */

'use strict';

const candidateModels = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-flash-latest'
];

/**
 * วิเคราะห์ภาพสิ่งของที่พบเจอด้วย Gemini Vision
 * @param {object} params
 * @param {Buffer} params.imageBuffer - ข้อมูลภาพ Buffer
 * @param {string} params.mimeType - MIME Type (image/jpeg, image/png)
 * @param {string} [params.userHint] - ข้อความเบื้องต้นที่ผู้ใช้ระบุ (เช่น 'หมวก')
 * @returns {Promise<{title: string, category: string, characteristics: string, secret_traits: string, tokenUsage?: object}>}
 */
async function analyzeLostItemImage({ imageBuffer, mimeType = 'image/jpeg', userHint = '' }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY ไม่ได้ถูกตั้งค่าในระบบ');
  }

  const prompt = `คุณคือระบบ AI ผู้ช่วยสารวัตรนักเรียนโรงเรียนพระนารายณ์ สำหรับตรวจจำแนกสิ่งของที่พบเจอ (Lost & Found)
ข้อความคำใบ้เบื้องต้นจากผู้พบ: "${userHint || '-'}"

คำสั่ง:
1. วิเคราะห์รูปภาพสิ่งของที่พบในโรงเรียนอย่างแม่นยำ
2. สรุปข้อมูลตอบกลับเป็น JSON เท่านั้น (Strict JSON) โดยมีโครงสร้างดังนี้:
{
  "title": "ชื่อสิ่งของภาษาไทย สั้น ชัดเจน 3-7 คำ (หากมีคำใบ้เดิมให้คงไว้แล้วเติมลักษณะเด่น เช่น 'หมวกแก๊ปสีดำ ลายปัก NY', 'กระเป๋าสตางค์หนังสีน้ำตาล')",
  "category": "เลือกให้ตรงที่สุด 1 หมวดหมู่จาก: กระเป๋า / กระเป๋าสตางค์, อุปกรณ์ไอที / มือถือ, กุญแจ / ยานพาหนะ, เครื่องแต่งกาย / หมวก, เครื่องเขียน / หนังสือ, สิ่งของทั่วไป / อื่นๆ",
  "characteristics": "บรรยายลักษณะเด่นภายนอก 1-2 ประโยค (สี, ยี่ห้อ/ลวดลาย, สภาพ, รอยหรือจุดสังเกตเด่น)",
  "secret_traits": "จุดสังเกตลับสำหรับใช้ถามพิสูจน์ความเป็นเจ้าของจริง (เช่น ลายปักด้านใน, พวงกุญแจย่อย, สติกเกอร์เฉพาะจุด, สิ่งที่บรรจุอยู่ด้านใน)"
}`;

  let parsedResult = null;
  let lastError = null;
  let tokenUsage = null;

  for (const model of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inlineData: { mimeType: mimeType || 'image/jpeg', data: imageBuffer.toString('base64') } }
            ]
          }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2
          }
        }),
        signal: AbortSignal.timeout(16000)
      });

      const data = await res.json();
      if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
        parsedResult = JSON.parse(data.candidates[0].content.parts[0].text);
        tokenUsage = data.usageMetadata;
        console.log(`[LOST-AI-VISION] ✅ วิเคราะห์สำเร็จด้วยโมเดล ${model} (ใช้ ~${tokenUsage?.totalTokenCount || 0} tokens)`);
        break;
      } else if (data.error) {
        console.warn(`[LOST-AI-VISION] Model ${model} error:`, data.error.message);
        lastError = new Error(data.error.message);
      }
    } catch (err) {
      console.warn(`[LOST-AI-VISION] Model ${model} failed:`, err.message);
      lastError = err;
    }
  }

  if (!parsedResult) {
    throw lastError || new Error('ไม่สามารถวิเคราะห์ภาพด้วย AI ได้ในขณะนี้');
  }

  // Fallback defaults if any field missing
  return {
    title: parsedResult.title || userHint || 'สิ่งของที่พบเจอ',
    category: parsedResult.category || 'สิ่งของทั่วไป / อื่นๆ',
    characteristics: parsedResult.characteristics || 'ไม่ระบุลักษณะเด่น',
    secret_traits: parsedResult.secret_traits || 'ไม่มีจุดสังเกตลับ',
    tokenUsage
  };
}

module.exports = {
  analyzeLostItemImage
};
