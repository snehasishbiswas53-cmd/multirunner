// language: JavaScript (Next.js App Router), file: app/api/status/route.js
// target: Vercel serverless — reads Upstash Redis REST API server-side
// token never reaches the browser

import { NextResponse } from 'next/server'

const REDIS_URL   = (process.env.UPSTASH_REDIS_REST_URL   || '').replace(/\/$/, '')
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN  || ''

// Redis key names — must match failover_v2.py
const KEYS = {
  LOCK:      'cele:primary_lock',
  HEARTBEAT: 'cele:heartbeat',
  STATE:     'cele:watchdog_state',
  INSTANCES: 'cele:instances',
  UPTIME:    'cele:uptime',
  LOG:       'cele:event_log',
  PREFERRED: 'cele:preferred_next',
}

const FREE_HOURS = 750

async function redisPipeline(commands) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    return Array(commands.length).fill(null)
  }
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${REDIS_TOKEN}`,
      'Content-Type':  'application/json',
    },
    body:  JSON.stringify(commands),
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Redis pipeline HTTP ${res.status}: ${text.slice(0, 120)}`)
  }
  const data = await res.json()
  return data.map(item =>
    (typeof item === 'object' && item !== null)
      ? (item.result ?? null)
      : item
  )
}

function parseHash(raw) {
  // Upstash HGETALL returns a flat array [k1, v1, k2, v2, ...]
  if (!Array.isArray(raw) || raw.length % 2 !== 0) return {}
  const out = {}
  for (let i = 0; i < raw.length; i += 2) {
    const key = raw[i]
    try { out[key] = JSON.parse(raw[i + 1]) }
    catch { out[key] = { raw: raw[i + 1] } }
  }
  return out
}

function timeAgo(ts) {
  if (!ts) return null
  const diff = Date.now() / 1000 - parseFloat(ts)
  if (diff < 60)    return `${Math.floor(diff)}s ago`
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export async function GET() {
  if (!REDIS_URL) {
    return NextResponse.json(
      { error: 'UPSTASH_REDIS_REST_URL not configured' },
      { status: 503 }
    )
  }

  try {
    const [
      lock,
      heartbeat,
      stateBlob,
      instancesRaw,
      uptimeRaw,
      eventsRaw,
      preferred,
    ] = await redisPipeline([
      ['GET',    KEYS.LOCK],
      ['GET',    KEYS.HEARTBEAT],
      ['GET',    KEYS.STATE],
      ['HGETALL', KEYS.INSTANCES],
      ['HGETALL', KEYS.UPTIME],
      ['LRANGE', KEYS.LOG, '0', '49'],
      ['GET',    KEYS.PREFERRED],
    ])

    // ── instances ────────────────────────────────────────────────────────────
    const instances = parseHash(instancesRaw)

    // ── uptime per instance ───────────────────────────────────────────────────
    const uptime = parseHash(uptimeRaw)

    // ── merge uptime into instance cards ─────────────────────────────────────
    const CYCLE = ['render-1', 'render-2', 'render-3', 'render-4']
    const cards = CYCLE.map(id => {
      const inst  = instances[id] || {}
      const up    = uptime[id]    || { seconds: 0 }
      const secs  = parseFloat(up.seconds || 0)
      const hours = secs / 3600
      const pct   = Math.min((hours / FREE_HOURS) * 100, 100)
      const isPrimary  = lock === id
      const isOffline  = !inst.last_seen
        || (Date.now() / 1000 - parseFloat(inst.last_seen)) > 60

      return {
        id,
        status:      isPrimary ? 'primary' : isOffline ? 'offline' : 'standby',
        last_seen:   inst.last_seen   ?? null,
        last_seen_label: timeAgo(inst.last_seen),
        hours_used:  parseFloat(hours.toFixed(2)),
        hours_total: FREE_HOURS,
        pct:         parseFloat(pct.toFixed(1)),
        month:       up.month ?? null,
      }
    })

    // ── heartbeat ────────────────────────────────────────────────────────────
    const heartbeatAge = heartbeat
      ? parseFloat((Date.now() / 1000 - parseFloat(heartbeat)).toFixed(1))
      : null

    // ── bot state ─────────────────────────────────────────────────────────────
    let botState = null
    if (stateBlob) {
      try {
        const raw = JSON.parse(stateBlob)
        botState = {
          saved_at:       raw.saved_at ?? null,
          saved_ago:      timeAgo(raw.saved_at),
          task:           raw.task ?? raw.current_task ?? 'unknown',
          extra:          raw,
        }
      } catch {}
    }

    return NextResponse.json({
      ok:             true,
      primary:        lock,
      preferred_next: preferred,
      heartbeat_age:  heartbeatAge,
      cards,
      bot_state:      botState,
      events:         Array.isArray(eventsRaw) ? eventsRaw : [],
      timestamp:      Date.now(),
    })
  } catch (err) {
    console.error('[api/status]', err)
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    )
  }
}
