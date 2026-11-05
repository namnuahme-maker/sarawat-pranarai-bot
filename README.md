# 🛡️ SARAWAT PRANARAI - DISCORD BOT

ระบบบอท Discord ศูนย์บัญชาการสารวัตรนักเรียน โรงเรียนพระนารายณ์
รองรับการลงทะเบียนยืนยันตัวตน, จัดผลัดเวรประจำวัน (M, T, W, Ts, F, S), ผลัดเวรพิเศษผสม (MS, TS, WS, TSS, FS), แจ้งเตือนเข้าเวรอัตโนมัติ, ระบบขอลาเวร, และการสร้างบัตรประจำตัว CR80

---

## 🚀 การติดตั้งและรันในเครื่อง (Local Development)

```bash
# 1. ติดตั้ง Dependencies
npm install

# 2. คัดลอกและตั้งค่า Environment Variables
cp .env.example .env

# 3. รันบอท
npm start
```

---

## 🌐 การนำขึ้นใช้งานบน Render.com (Deployment Guide)

### รูปแบบ Service: **Web Service** หรือ **Background Worker**
> **แนะนำ:** เลือกสร้างเป็น **Web Service** บน Render (ฟรี) เพื่อให้มี Health Check Endpoint และ Webhook รองรับ Google Forms

1. **เชื่อมต่อ GitHub:**
   - สร้าง New Web Service บน Render.com และเลือก Repository ของ Bot
2. **ตั้งค่า Build & Start Command:**
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node bot.js`
3. **ตั้งค่า Environment Variables ใน Render:**
   - `DISCORD_TOKEN` = โทเค็นบอทจาก Discord Developer Portal
   - `CLIENT_ID` = Application ID ของบอท
   - `GUILD_ID` = Server ID ของดิสคอร์ดสารวัตร
   - `SUPABASE_URL` = URL ของฐานข้อมูล Supabase
   - `SUPABASE_SERVICE_ROLE_KEY` = Service Role Secret ของ Supabase
   - `PORT` = `10000`
   - `NODE_ENV` = `production`
   - `RENDER_EXTERNAL_URL` = URL ของ Render Web Service ที่ได้มา (เช่น `https://sarawat-bot.onrender.com`)
   - `ATTENDANCE_CHANNEL_ID` = ID ช่องเช็คชื่อ
   - `WEBHOOK_SECRET` = รหัสลับความปลอดภัย Webhook
