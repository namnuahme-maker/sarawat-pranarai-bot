const { EmbedBuilder } = require('discord.js');

let discordClient = null;
let supabaseClient = null;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || '1570100273043738646';

/**
 * กำหนด Client สำหรับระบบบันทึก Log
 */
function initLogger({ client, supabase }) {
  discordClient = client;
  supabaseClient = supabase;
}

/**
 * บันทึก Error เข้าทั้ง Supabase และ Discord ช่อง #log
 */
async function logError(title, error, metadata = {}) {
  const errMsg = error?.message || String(error);
  const errStack = error?.stack ? error.stack.slice(0, 1500) : null;
  console.error(`[SERVER ERROR] ${title}:`, errMsg);

  // 1. บันทึกลงตาราง Supabase (system_logs)
  if (supabaseClient) {
    try {
      await supabaseClient.from('system_logs').insert({
        level: 'ERROR',
        source: 'BOT',
        title: title || 'Error',
        message: errMsg,
        stack: errStack,
        metadata: metadata || {}
      });
    } catch (sErr) {
      // ป้องกันการ crash หากยังไม่ได้รัน migration สร้างตาราง
    }
  }

  // 2. ส่งการ์ดแจ้งเตือนเข้า Discord ช่อง #log
  if (discordClient && discordClient.isReady()) {
    try {
      const ch = await discordClient.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
      if (ch && ch.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle(`🚨 [ERROR] ${String(title).slice(0, 200)}`)
          .setDescription(`**ข้อความ:** \`${errMsg.slice(0, 500)}\``)
          .setColor('#E74C3C')
          .setTimestamp();

        if (errStack) {
          embed.addFields({
            name: '📍 Stack Trace',
            value: `\`\`\`javascript\n${errStack.slice(0, 900)}\n\`\`\``
          });
        }

        if (metadata && Object.keys(metadata).length > 0) {
          try {
            const metaStr = JSON.stringify(metadata, null, 2);
            embed.addFields({
              name: '🔍 ข้อมูลบริบท (Context)',
              value: `\`\`\`json\n${metaStr.slice(0, 900)}\n\`\`\``
            });
          } catch (e) {}
        }

        await ch.send({ embeds: [embed] }).catch(() => {});
      }
    } catch (dErr) {
      console.warn('[LOGGER DISCORD NOTICE]:', dErr.message);
    }
  }
}

/**
 * บันทึก Warning เข้าทั้ง Supabase และ Discord ช่อง #log
 */
async function logWarn(title, message, metadata = {}) {
  const warnMsg = typeof message === 'string' ? message : (message?.message || String(message));
  console.warn(`[SERVER WARN] ${title}:`, warnMsg);

  if (supabaseClient) {
    try {
      await supabaseClient.from('system_logs').insert({
        level: 'WARN',
        source: 'BOT',
        title: title || 'Warning',
        message: warnMsg,
        metadata: metadata || {}
      });
    } catch (e) {}
  }

  if (discordClient && discordClient.isReady()) {
    try {
      const ch = await discordClient.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
      if (ch && ch.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle(`⚠️ [WARN] ${String(title).slice(0, 200)}`)
          .setDescription(String(warnMsg).slice(0, 1000))
          .setColor('#F39C12')
          .setTimestamp();
        await ch.send({ embeds: [embed] }).catch(() => {});
      }
    } catch (e) {}
  }
}

module.exports = {
  initLogger,
  logError,
  logWarn
};
