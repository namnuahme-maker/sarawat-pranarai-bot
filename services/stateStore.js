/**
 * 🗄️ SARAWAT STATE STORE
 * Supabase-backed replacement for the 8 volatile in-memory Maps in bot.js.
 *
 * Problem solved:
 *   Bot restarts on Render (free tier sleeps) wipe all in-memory Maps.
 *   Users mid-flow (photo upload, leave request, lost report) lose their session.
 *
 * Design:
 *   - Wraps a single Supabase table: `bot_sessions`
 *   - TTL is enforced per-namespace so different flows expire correctly
 *   - Local Map cache avoids repeated DB reads within the same process uptime
 *   - Falls back gracefully if Supabase is unavailable (uses local cache only)
 *
 * Usage:
 *   const store = require('./services/stateStore');
 *   store.init(supabase);                              // call once at startup
 *   await store.set('pendingPhotoUploads', userId, { url, name });
 *   const data = await store.get('pendingPhotoUploads', userId);
 *   await store.del('pendingPhotoUploads', userId);
 *
 * SQL migration (run once in Supabase):
 *   See: bot/sql/migration_statestore.sql
 */

/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let _supabase = null;

/** Local write-through cache: namespace -> key -> { value, expiresAt } */
const _cache = new Map();

/**
 * TTL (ms) per namespace — matches the expected maximum session lifetime.
 * shortcut: fixed TTLs; if flows lengthen, increase here only.
 */
const TTL = {
  pendingPhotoUploads:       30 * 60 * 1000,  // 30 min
  pendingPhotoConfirmations: 30 * 60 * 1000,  // 30 min
  pendingAttendanceUploads:  60 * 60 * 1000,  // 60 min — OMR review window
  activeServicePhotoSessions:30 * 60 * 1000,  // 30 min
  pendingPromptMessages:     60 * 60 * 1000,  // 60 min
  pendingLostReports:        24 * 60 * 60 * 1000, // 24 hr — lost item report
  pendingApprovalMessages:   48 * 60 * 60 * 1000, // 48 hr — admin approval queue
  tempAttendanceSheets:       4 * 60 * 60 * 1000, // 4 hr — temp print link
};

const DEFAULT_TTL = 60 * 60 * 1000; // 1 hr fallback

/**
 * Initialise with the shared Supabase client.
 * Call this once at bot startup before any store operations.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseClient
 */
function init(supabaseClient) {
  _supabase = supabaseClient;
  _startEvictionTimer();
}

/**
 * Write a value into a namespace under a key.
 * @param {string} namespace - one of the keys in TTL map above
 * @param {string} key - usually a Discord userId or memberId
 * @param {object} value - JSON-serialisable object
 */
async function set(namespace, key, value) {
  const ttlMs = TTL[namespace] ?? DEFAULT_TTL;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  // 1. Write to local cache immediately (zero-latency reads in same process)
  _cacheSet(namespace, key, value, Date.now() + ttlMs);

  // 2. Persist to Supabase asynchronously (don't block the interaction)
  if (_supabase) {
    try {
      await _supabase.from('bot_sessions').upsert(
        { namespace, key, value, expires_at: expiresAt },
        { onConflict: 'namespace,key' }
      );
    } catch (err) {
      console.warn(`[STATE-STORE] Supabase write failed for ${namespace}:${key} —`, err.message);
      // Local cache still holds the value — flow continues
    }
  }
}

/**
 * Read a value. Checks local cache first, then Supabase.
 * Returns null if not found or expired.
 * @param {string} namespace
 * @param {string} key
 * @returns {Promise<object|null>}
 */
async function get(namespace, key) {
  // 1. Local cache hit
  const cached = _cacheGet(namespace, key);
  if (cached !== undefined) return cached;

  // 2. Supabase fallback (e.g. after restart)
  if (_supabase) {
    try {
      const { data, error } = await _supabase
        .from('bot_sessions')
        .select('value, expires_at')
        .eq('namespace', namespace)
        .eq('key', key)
        .single();

      if (error || !data) return null;
      if (new Date(data.expires_at) <= new Date()) {
        // Expired — clean up and return null
        await del(namespace, key);
        return null;
      }

      // Warm local cache from DB hit
      const ttlRemaining = new Date(data.expires_at).getTime() - Date.now();
      _cacheSet(namespace, key, data.value, Date.now() + ttlRemaining);
      return data.value;
    } catch (err) {
      console.warn(`[STATE-STORE] Supabase read failed for ${namespace}:${key} —`, err.message);
    }
  }

  return null;
}

/**
 * Delete a session entry (e.g. after flow completes or is cancelled).
 * @param {string} namespace
 * @param {string} key
 */
async function del(namespace, key) {
  // Remove from local cache
  const nsCache = _cache.get(namespace);
  if (nsCache) nsCache.delete(key);

  if (_supabase) {
    try {
      await _supabase
        .from('bot_sessions')
        .delete()
        .eq('namespace', namespace)
        .eq('key', key);
    } catch (err) {
      console.warn(`[STATE-STORE] Supabase delete failed for ${namespace}:${key} —`, err.message);
    }
  }
}

/**
 * List all active keys in a namespace (e.g. to show pending approvals).
 * @param {string} namespace
 * @returns {Promise<Array<{key: string, value: object}>>}
 */
async function list(namespace) {
  if (!_supabase) {
    // Fall back to local cache
    const nsCache = _cache.get(namespace);
    if (!nsCache) return [];
    const now = Date.now();
    return [...nsCache.entries()]
      .filter(([, entry]) => entry.expiresAt > now)
      .map(([key, entry]) => ({ key, value: entry.value }));
  }

  try {
    const { data, error } = await _supabase
      .from('bot_sessions')
      .select('key, value')
      .eq('namespace', namespace)
      .gt('expires_at', new Date().toISOString());

    if (error) throw error;
    return data ?? [];
  } catch (err) {
    console.warn(`[STATE-STORE] Supabase list failed for ${namespace} —`, err.message);
    return [];
  }
}

// ─── Local cache helpers ───────────────────────────────────────────────────────

function _cacheSet(namespace, key, value, expiresAt) {
  if (!_cache.has(namespace)) _cache.set(namespace, new Map());
  _cache.get(namespace).set(key, { value, expiresAt });
}

function _cacheGet(namespace, key) {
  const entry = _cache.get(namespace)?.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    _cache.get(namespace).delete(key);
    return undefined;
  }
  return entry.value;
}

/** Evict expired entries from local cache every 5 minutes. */
function _startEvictionTimer() {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [ns, nsCache] of _cache) {
      for (const [key, entry] of nsCache) {
        if (entry.expiresAt <= now) nsCache.delete(key);
      }
      if (nsCache.size === 0) _cache.delete(ns);
    }
  }, 5 * 60 * 1000);
  if (timer.unref) timer.unref(); // don't prevent process exit
}

module.exports = { init, set, get, del, list, TTL };
