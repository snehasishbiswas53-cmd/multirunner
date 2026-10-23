// language: JavaScript (Next.js App Router), file: app/api/cron/route.js
// Watchdog: Redis heartbeat check + live Render API polling per instance
// All hooks + API keys live in Vercel env vars — zero Redis hook storage
// On stale heartbeat → fires NEXT instance's deploy hook (circular: 1→2→3→4→1)

import { NextResponse } from 'next/server'

const REDIS_URL   = (process.env.UPSTASH_REDIS_REST_URL   || '').replace(/\/$/, '')
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN  || ''
const CRON_SECRET = process.env.CRON_SECRET               || ''

const STALE_THRESHOLD_S = 90
const COOLDOWN_S        = 180

const KEY_HEARTBEAT = 'cele:heartbeat'
const KEY_LOCK      = 'cele:primary_lock'
const KEY_LOG       = 'cele:event_log'
const KEY_WATCHDOG  = 'cele:cron_last_fired'
const KEY_INST      = 'cele:instance_status'  // hash: id → JSON; dashboard reads this
const LOG_MAX       = 50

// ── Per-instance config ───────────────────────────────────────────────────────
// Set in Vercel dashboard → Environment Variables:
//
//   RENDER_1_API_KEY     = rnd_xxxxxxxxxxxxxxxxxxxxxx
//   RENDER_1_DEPLOY_HOOK = https://api.render.com/deploy/srv-abc?key=xyz
//   RENDER_2_API_KEY     = rnd_xxxxxxxxxxxxxxxxxxxxxx
//   RENDER_2_DEPLOY_HOOK = https://api.render.com/deploy/srv-def?key=xyz
//   RENDER_3_API_KEY     = rnd_xxxxxxxxxxxxxxxxxxxxxx
//   RENDER_3_DEPLOY_HOOK = https://api.render.com/deploy/srv-ghi?key=xyz
//   RENDER_4_API_KEY     = rnd_xxxxxxxxxxxxxxxxxxxxxx
//   RENDER_4_DEPLOY_HOOK = https://api.render.com/deploy/srv-jkl?key=xyz
//
// Service ID is parsed from the hook URL automatically — no extra var needed.

const INSTANCE_IDS = ['render-1', 'render-2', 'render-3', 'render-4']

function loadInstances() {
  return INSTANCE_IDS.map((id, i) => ({
    id,
    apiKey:     process.env[`RENDER_${i + 1}_API_KEY`]     || '',
    deployHook: process.env[`RENDER_${i + 1}_DEPLOY_HOOK`] || '',
  }))
}

// ── Render API: check one service via its API key ────────────────────────────
// Hook URL shape: https://api.render.com/deploy/srv-{serviceId}?key={deployKey}
// We yank the serviceId out of the URL — one env var per instance, not two.

async function fetchRenderStatus(apiKey, deployHook) {
  if (!apiKey || !deployHook) return { configured: false, reason: 'missing_env' }

  const match = deployHook.match(/\/deploy\/(srv-[^?/]+)/)
  if (!match) return { configured: false, reason: 'bad_hook_url' }
  const serviceId = match[1]

  try {
    const res = await fetch(`https://api.render.com/v1/services/${serviceId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept:        'application/json',
      },
      cache:  'no-store',
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return { configured: true, serviceId, ok: false, reason: `render_api_${res.status}` }

    const svc = await res.json()
    return {
      configured: true,
      ok:         true,
      serviceId,
      name:       svc.name      ?? serviceId,
      suspended:  svc.suspended === 'suspended',
      type:       svc.type      ?? 'unknown',
    }
  } catch (e) {
    return { configured: true, serviceId: match?.[1] ?? null, ok: false, reason: e.message }
  }
}

// ── Redis helpers ─────────────────────────────────────────────────────────────

async function redisPipeline(commands) {
  if (!REDIS_URL || !REDIS_TOKEN) return Array(commands.length).fill(null)
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method:  'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body:  JSON.stringify(commands),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Redis pipeline HTTP ${res.status}`)
  const data = await res.json()
  return data.map(item =>
    typeof item === 'object' && item !== null && !item.error
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
      ['LPUSH', KEY_LOG, line],
      ['LTRIM', KEY_LOG, '0', String(LOG_MAX - 1)],
    ])
  } catch { /* best-effort — log never blocks failover */ }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(request) {
  if (CRON_SECRET) {
    const secret = request.headers.get('x-cron-secret') || ''
    if (secret !== CRON_SECRET)
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  if (!REDIS_URL)
    return NextResponse.json({ error: 'Redis not configured' }, { status: 503 })

  try {
    const instances = loadInstances()
    const now       = Date.now() / 1000

    // ── 1. Redis read + all Render API polls in one parallel shot ─────────────
    const [redisResults, ...renderStatuses] = await Promise.all([
      redisPipeline([
        ['GET', KEY_HEARTBEAT],
        ['GET', KEY_LOCK],
        ['GET', KEY_WATCHDOG],
      ]),
      ...instances.map(inst => fetchRenderStatus(inst.apiKey, inst.deployHook)),
    ])

    const [heartbeatRaw, primaryId, lastFiredRaw] = redisResults

    const heartbeatAge = heartbeatRaw
      ? now - parseFloat(heartbeatRaw)
      : Infinity

    const lastFiredAge = lastFiredRaw
      ? now - parseFloat(lastFiredRaw)
      : Infinity

    // ── 2. Write fresh Render status to Redis so /api/status can show it ─────
    const checkedAt     = Math.floor(now)
    const statusWrites  = instances.flatMap((inst, i) => [
      ['HSET', KEY_INST, inst.id, JSON.stringify({ ...renderStatuses[i], checked_at: checkedAt })],
    ])
    await redisPipeline(statusWrites).catch(() => {})

    const renderSummary = instances.map((inst, i) => ({ id: inst.id, ...renderStatuses[i] }))

    // ── 3. Heartbeat healthy — nothing to do ─────────────────────────────────
    if (heartbeatAge < STALE_THRESHOLD_S) {
      return NextResponse.json({
        ok:            true,
        action:        'noop',
        primary:       primaryId,
        heartbeat_age: parseFloat(heartbeatAge.toFixed(1)),
        render_status: renderSummary,
        message:       'Primary is alive',
      })
    }

    // ── 4. Stale — respect cooldown window ───────────────────────────────────
    if (lastFiredAge < COOLDOWN_S) {
      return NextResponse.json({
        ok:            true,
        action:        'cooldown',
        message:       `Already fired ${Math.floor(lastFiredAge)}s ago — cooling down`,
        heartbeat_age: parseFloat(heartbeatAge.toFixed(1)),
        render_status: renderSummary,
      })
    }

    // ── 5. No lock → can't determine which instance died ─────────────────────
    if (!primaryId) {
      await logEvent(`heartbeat stale (${Math.floor(heartbeatAge)}s) but no primary_lock — skipping`)
      return NextResponse.json({
        ok:      false,
        action:  'no_lock',
        message: 'Heartbeat stale but no primary_lock in Redis',
      })
    }

    // ── 6. Resolve next instance (circular: 1→2→3→4→1) ──────────────────────
    const deadIdx  = instances.findIndex(inst => inst.id === primaryId)
    const nextInst = deadIdx >= 0
      ? instances[(deadIdx + 1) % instances.length]
      : null

    if (!nextInst?.deployHook) {
      await logEvent(`heartbeat stale — no deploy hook configured for next instance after ${primaryId}`)
      return NextResponse.json({
        ok:      false,
        action:  'no_hook',
        message: `Set RENDER_${((deadIdx + 1) % instances.length) + 1}_DEPLOY_HOOK in Vercel env`,
      })
    }

    // ── 7. Fire next instance's deploy hook ───────────────────────────────────
    await logEvent(
      `heartbeat stale (${Math.floor(heartbeatAge)}s) — ${primaryId} dead — firing ${nextInst.id} deploy hook`
    )

    const hookRes = await fetch(nextInst.deployHook, { method: 'GET', cache: 'no-store' })
    const hookOk  = hookRes.status < 400

    await logEvent(
      hookOk
        ? `deploy hook fired → HTTP ${hookRes.status} — ${nextInst.id} waking up`
        : `deploy hook returned HTTP ${hookRes.status} — manual intervention needed`
    )

    // Stamp watchdog so we don't double-fire
    await redisPipeline([
      ['SET', KEY_WATCHDOG, String(now), 'EX', '300'],
    ])

    return NextResponse.json({
      ok:            hookOk,
      action:        'fired',
      dead_primary:  primaryId,
      next_woken:    nextInst.id,
      heartbeat_age: parseFloat(heartbeatAge.toFixed(1)),
      hook_status:   hookRes.status,
      render_status: renderSummary,
    })

  } catch (err) {
    console.error('[cron]', err)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
