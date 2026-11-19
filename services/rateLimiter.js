/**
 * 🛡️ SARAWAT RATE LIMITER
 * Guard all Discord interactions against spam/flooding.
 * Uses in-memory Map (per process) — intentionally lightweight.
 * Not shared across restarts; that's acceptable for a cooldown guard.
 *
 * Usage:
 *   const { checkRateLimit } = require('./services/rateLimiter');
 *   if (!checkRateLimit(interaction)) return; // already replied with ephemeral warning
 */

/** @type {Map<string, number>} userId -> timestamp of last allowed interaction */
const _cooldowns = new Map();

/**
 * Default cooldowns (ms) per interaction bucket.
 * Tune these without touching bot.js.
 */
const LIMITS = {
  default:        2_000,  // 2 s — catch double-clicks
  button:         1_500,  // button presses slightly faster ok
  modal:          3_000,  // modals take longer to fill
  slash:          2_000,  // slash commands
  select:         1_500,  // select menus
  leave_request:  5_000,  // leave flow — heavier DB op
  photo_upload:  10_000,  // photo sessions — Supabase upload
  attendance:     8_000,  // OMR scan — Gemini API call
};

/**
 * Classify the interaction to pick the right cooldown bucket.
 * @param {import('discord.js').Interaction} interaction
 * @returns {string} bucket name
 */
function _bucket(interaction) {
  if (interaction.isButton()) {
    const id = interaction.customId || '';
    if (id.startsWith('btn_request_leave') || id.startsWith('btn_dm_quick_leave')) return 'leave_request';
    if (id.startsWith('btn_start_attendance') || id.startsWith('btn_request_attendance')) return 'attendance';
    if (id.includes('photo') || id.includes('service_submit')) return 'photo_upload';
    return 'button';
  }
  if (interaction.isModalSubmit()) return 'modal';
  if (interaction.isChatInputCommand()) return 'slash';
  if (interaction.isStringSelectMenu() || interaction.isUserSelectMenu()) return 'select';
  return 'default';
}

/**
 * Check if the interaction is within rate limit.
 * If over limit, replies with an ephemeral warning and returns false.
 * If under limit, records the timestamp and returns true.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {number} [overrideCooldownMs] - optional custom cooldown for this call
 * @returns {boolean} true = allowed, false = blocked (already replied)
 */
function checkRateLimit(interaction, overrideCooldownMs) {
  if (interaction.isAutocomplete && interaction.isAutocomplete()) return true;
  const userId = interaction.user?.id;
  if (!userId) return true; // system interactions pass through

  const bucket = _bucket(interaction);
  const cooldownMs = overrideCooldownMs ?? LIMITS[bucket] ?? LIMITS.default;
  const key = `${userId}:${bucket}`;
  const now = Date.now();
  const last = _cooldowns.get(key) ?? 0;
  const remaining = cooldownMs - (now - last);

  if (remaining > 0) {
    const secs = (remaining / 1000).toFixed(1);
    // Reply ephemerally if the interaction hasn't been replied to yet
    _safeReply(interaction, `⏳ กรุณารอ **${secs} วินาที** ก่อนใช้คำสั่งนี้อีกครั้ง`);
    return false;
  }

  _cooldowns.set(key, now);
  _evict(); // keep Map small
  return true;
}

/**
 * Manually reset the cooldown for a user+bucket (e.g. after an error so they can retry).
 * @param {string} userId
 * @param {string} [bucket='default']
 */
function resetCooldown(userId, bucket = 'default') {
  _cooldowns.delete(`${userId}:${bucket}`);
}

// ─── internals ────────────────────────────────────────────────────────────────

async function _safeReply(interaction, message) {
  try {
    const payload = { content: message, flags: 64 }; // 64 = EPHEMERAL
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch {
    // Interaction already expired — silently swallow
  }
}

/** Remove entries older than the longest possible cooldown to prevent unbounded growth. */
const MAX_AGE_MS = Math.max(...Object.values(LIMITS)) * 2;
function _evict() {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const [key, ts] of _cooldowns) {
    if (ts < cutoff) _cooldowns.delete(key);
  }
}

module.exports = { checkRateLimit, resetCooldown, LIMITS };
