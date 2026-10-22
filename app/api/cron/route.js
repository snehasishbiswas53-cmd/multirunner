// language: JavaScript (Next.js App Router), file: app/api/cron/route.js
// UptimeRobot HTTP monitor — pings every 5 minutes
// Watches cele:heartbeat; if stale > 90s, fires the next deploy hook
// so when the active Render instance crashes, this automatically wakes the next one.

import { NextResponse } from 'next/server'

const REDIS_URL   = (process.env.UPSTASH_REDIS_REST_URL   || '').replace(/\/$/, '')
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN  || ''
const CRON_SECRET = process.env.CRON_SECRET               || ''   // optional, set in Vercel env

// How many seconds of silence before we declare the primary dead
const STALE_THRESHOLD_S = 90

// Redis keys — must match failover_v3.py
const KEY_HEARTBEAT = 'cele:heartbeat'
const KEY_LOCK      = 'cele:primary_lock'   // which instance is primary
const KEY_HOOKS     = 'cele:next_hooks'     // hash: instance_id -> NEXT deploy hook URL
const KEY_LOG       = 'cele:event_log'
const KEY_WATCHDOG  = 'cele:cron_last_fired' // prevents double-firing
const LOG_MAX       = 50

// ── redis helpers ─────────────────────────────────────────────────────────────

async function redisPipeline(commands) {
  if (!REDIS_URL || !REDIS_TOKEN) return Array(commands.length).fill(null)
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${REDIS_TOKEN}`,
      'Content-Type':  'application/json',
    },
    body:  JSON.stringify(commands),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Redis pipeline HTTP ${res.status}`)
  const data = await res.json()
  return data.map(item =>
    (typeof item === 'object' && item !== null && !item.error)
      ? (item.result ?? null)
      : null
  )
}

async function logEvent(msg) {
  const ts   = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const line = `[${ts}] cron-watchdog: ${msg}`
  console.log('[cron]', msg)
  try {
    await redisPipeline([
      ['LPUSH', KEY_LOG,  line],
      ['LTRIM', KEY_LOG, '0', String(LOG_MAX - 1)],
    ])
  } catch { /* best-effort */ }
}

// ── main handler ──────────────────────────────────────────────────────────────

export async function GET(request) {
  // ── auth: UptimeRobot sends x-cron-secret header
  if (CRON_SECRET) {
    const secret = request.headers.get('x-cron-secret') || ''
    if (secret !== CRON_SECRET) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  if (!REDIS_URL) {
    return NextResponse.json({ error: 'Redis not configured' }, { status: 503 })
  }

  try {
    const now = Date.now() / 1000

    // Fetch heartbeat, lock, and last-fired timestamp in one round-trip
    const [heartbeatRaw, primaryId, lastFiredRaw] = await redisPipeline([
      ['GET', KEY_HEARTBEAT],
      ['GET', KEY_LOCK],
      ['GET', KEY_WATCHDOG],
    ])

    const heartbeatAge = heartbeatRaw
      ? now - parseFloat(heartbeatRaw)
      : Infinity   // key missing → definitely stale

    const lastFiredAge = lastFiredRaw
      ? now - parseFloat(lastFiredRaw)
      : Infinity

    // ── healthy — do nothing ──────────────────────────────────────────────────
    if (heartbeatAge < STALE_THRESHOLD_S) {
      return NextResponse.json({
        ok:            true,
        action:        'noop',
        primary:       primaryId,
        heartbeat_age: parseFloat(heartbeatAge.toFixed(1)),
        message:       'Primary is alive',
      })
    }

    // ── stale heartbeat detected ──────────────────────────────────────────────

    // Guard: don't fire again if we fired in the last 3 minutes
    // (prevents double-fires if monitor overlaps or deploy hook is slow)
    if (lastFiredAge < 180) {
      return NextResponse.json({
        ok:            true,
        action:        'cooldown',
        message:       `Already fired ${Math.floor(lastFiredAge)}s ago — cooling down`,
        heartbeat_age: parseFloat(heartbeatAge.toFixed(1)),
      })
    }

    // No primary recorded — nothing we can do safely
    if (!primaryId) {
      await logEvent(`heartbeat stale (${Math.floor(heartbeatAge)}s) but no primary_lock found — skipping`)
      return NextResponse.json({
        ok:      false,
        action:  'no_lock',
        message: 'Heartbeat stale but no primary_lock in Redis',
      })
    }

    // Look up the next deploy hook for the dead primary
    const [nextHook] = await redisPipeline([
      ['HGET', KEY_HOOKS, primaryId],
    ])

    if (!nextHook) {
      await logEvent(`heartbeat stale — no next hook registered for ${primaryId}`)
      return NextResponse.json({
        ok:      false,
        action:  'no_hook',
        message: `No deploy hook registered for ${primaryId}`,
      })
    }

    // ── fire the next deploy hook ─────────────────────────────────────────────
    await logEvent(`heartbeat stale (${Math.floor(heartbeatAge)}s) — ${primaryId} appears dead — firing next deploy hook`)

    const hookRes = await fetch(nextHook, { method: 'GET', cache: 'no-store' })
    const hookOk  = hookRes.status < 400

    await logEvent(
      hookOk
        ? `deploy hook fired → HTTP ${hookRes.status} — next instance waking up`
        : `deploy hook returned HTTP ${hookRes.status} — may need manual intervention`
    )

    // Record that we just fired so we don't double-fire
    await redisPipeline([
      ['SET', KEY_WATCHDOG, String(now), 'EX', '300'],   // 5-min TTL
    ])

    return NextResponse.json({
      ok:            hookOk,
      action:        'fired',
      dead_primary:  primaryId,
      heartbeat_age: parseFloat(heartbeatAge.toFixed(1)),
      hook_status:   hookRes.status,
    })

  } catch (err) {
    console.error('[cron]', err)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
