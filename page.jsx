'use client'
// language: React (Next.js App Router), file: app/page.jsx
// client component — polls /api/status every 10s and renders the dashboard

import { useEffect, useState, useCallback } from 'react'

// ── gmail labels — update these to match your actual accounts ─────────────────
const GMAIL_LABELS = {
  'render-1': 'Snehasishbiswas53@gmail.com',
  'render-2': 'shayandasbiswas09@gmail.com',
  'render-3': 'galaxycelestial362@gmail.com',
  'render-4': 'snehasish59biswas@gmail.com',
}

// ── colours ───────────────────────────────────────────────────────────────────
const C = {
  bg:         '#0d1117',
  surface:    '#161b22',
  surfaceAlt: '#1c2128',
  border:     '#30363d',
  borderAlt:  '#21262d',
  text:       '#e6edf3',
  textMuted:  '#8b949e',
  textDim:    '#484f58',
  primary:    '#3fb950',   // green — primary instance
  standby:    '#d29922',   // yellow — standby
  offline:    '#f85149',   // red — offline/dead
  accent:     '#58a6ff',   // blue — links / accents
  barBg:      '#21262d',
  barFill:    '#3fb950',
  barWarn:    '#d29922',   // warn at 80%
  barDanger:  '#f85149',   // danger at 95%
}

// ── helpers ───────────────────────────────────────────────────────────────────
function statusColor(status) {
  if (status === 'primary') return C.primary
  if (status === 'offline')  return C.offline
  return C.standby
}

function barColor(pct) {
  if (pct >= 95) return C.barDanger
  if (pct >= 80) return C.barWarn
  return C.barFill
}

function heartbeatLabel(age) {
  if (age === null) return { text: 'no data', color: C.offline }
  if (age < 15)     return { text: `${age.toFixed(1)}s ago`, color: C.primary }
  if (age < 40)     return { text: `${age.toFixed(1)}s ago`, color: C.standby }
  return { text: `${age.toFixed(1)}s ago (STALE)`, color: C.offline }
}

// ── sub-components ───────────────────────────────────────────────────────────

function Badge({ status }) {
  const color = statusColor(status)
  return (
    <span style={{
      display:      'inline-flex',
      alignItems:   'center',
      gap:          6,
      fontSize:     11,
      fontWeight:   700,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color,
    }}>
      <span style={{
        width: 7, height: 7,
        borderRadius: '50%',
        background: color,
        boxShadow: status === 'primary' ? `0 0 6px ${color}` : 'none',
        display: 'inline-block',
        animation: status === 'primary' ? 'pulse 2s infinite' : 'none',
      }} />
      {status}
    </span>
  )
}

function ProgressBar({ pct }) {
  const fill = barColor(pct)
  return (
    <div style={{
      width: '100%', height: 6,
      background: C.barBg,
      borderRadius: 3, overflow: 'hidden',
    }}>
      <div style={{
        width:        `${pct}%`,
        height:       '100%',
        background:   fill,
        borderRadius: 3,
        transition:   'width 0.5s ease',
      }} />
    </div>
  )
}

function InstanceCard({ card, preferred }) {
  const isPreferred = preferred === card.id
  const borderColor = card.status === 'primary'
    ? C.primary
    : card.status === 'offline'
      ? `${C.offline}44`
      : C.border

  return (
    <div style={{
      background:   C.surface,
      border:       `1px solid ${borderColor}`,
      borderRadius: 10,
      padding:      '18px 20px',
      display:      'flex',
      flexDirection: 'column',
      gap:          12,
      boxShadow: card.status === 'primary'
        ? `0 0 18px ${C.primary}22`
        : 'none',
      transition: 'box-shadow 0.3s',
      opacity: card.status === 'offline' ? 0.6 : 1,
    }}>
      {/* header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 2 }}>
            {card.id}
            {isPreferred && (
              <span style={{
                marginLeft: 8,
                fontSize: 10,
                color: C.accent,
                background: `${C.accent}22`,
                padding: '1px 6px',
                borderRadius: 4,
                fontWeight: 600,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
              }}>
                NEXT
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: C.textMuted }}>
            {GMAIL_LABELS[card.id] || '—'}
          </div>
        </div>
        <Badge status={card.status} />
      </div>

      {/* hours progress */}
      <div>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          marginBottom: 5, fontSize: 12,
        }}>
          <span style={{ color: C.textMuted }}>hours this month</span>
          <span style={{
            color: barColor(card.pct),
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 600,
          }}>
            {card.hours_used.toFixed(1)} / {card.hours_total}h
          </span>
        </div>
        <ProgressBar pct={card.pct} />
        <div style={{ textAlign: 'right', marginTop: 4, fontSize: 11, color: C.textDim }}>
          {card.pct.toFixed(1)}% used
        </div>
      </div>

      {/* last seen */}
      <div style={{ fontSize: 12, color: C.textMuted }}>
        last seen:{' '}
        <span style={{ color: card.status === 'offline' ? C.offline : C.textMuted }}>
          {card.last_seen_label ?? 'never'}
        </span>
      </div>
    </div>
  )
}

function EventLog({ events }) {
  return (
    <div style={{
      background:   C.surface,
      border:       `1px solid ${C.border}`,
      borderRadius: 10,
      overflow:     'hidden',
    }}>
      <div style={{
        padding:      '12px 18px',
        borderBottom: `1px solid ${C.borderAlt}`,
        fontSize:     12,
        fontWeight:   700,
        color:        C.textMuted,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}>
        Event Log
      </div>
      <div style={{
        maxHeight:  220,
        overflowY:  'auto',
        fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
        fontSize:   12,
        lineHeight: 1.7,
        color:      C.textMuted,
        padding:    '10px 18px',
      }}>
        {events.length === 0 ? (
          <div style={{ color: C.textDim, fontStyle: 'italic' }}>no events yet</div>
        ) : events.map((e, i) => (
          <div key={i} style={{ color: i === 0 ? C.text : C.textMuted }}>
            {e}
          </div>
        ))}
      </div>
    </div>
  )
}

function BotState({ botState }) {
  if (!botState) return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 10,
      padding: '18px 20px',
      fontSize: 13,
      color: C.textMuted,
    }}>
      No bot state saved yet.
    </div>
  )

  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 10,
      padding: '18px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>
          {botState.task || 'idle'}
        </span>
        <span style={{ fontSize: 12, color: C.textMuted }}>
          saved {botState.saved_ago ?? '—'}
        </span>
      </div>
      <details style={{ fontSize: 12, color: C.textMuted }}>
        <summary style={{ cursor: 'pointer', userSelect: 'none' }}>raw state</summary>
        <pre style={{
          marginTop: 8,
          padding: '10px 12px',
          background: C.bg,
          borderRadius: 6,
          overflow: 'auto',
          fontSize: 11,
          color: C.textMuted,
          maxHeight: 160,
        }}>
          {JSON.stringify(botState.extra, null, 2)}
        </pre>
      </details>
    </div>
  )
}

// ── main dashboard ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [data,        setData]        = useState(null)
  const [error,       setError]       = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [live,        setLive]        = useState(true)

  const fetchStatus = useCallback(async () => {
    try {
      const res  = await fetch('/api/status', { cache: 'no-store' })
      const json = await res.json()
      if (!json.ok && json.error) {
        setError(json.error)
        setData(null)
      } else {
        setData(json)
        setError(null)
      }
      setLastUpdated(new Date())
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    if (!live) return
    const id = setInterval(fetchStatus, 10_000)
    return () => clearInterval(id)
  }, [fetchStatus, live])

  const hb = data ? heartbeatLabel(data.heartbeat_age) : null

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, padding: '32px 24px' }}>

      {/* css keyframes */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
        details summary::-webkit-details-marker { color: ${C.textDim}; }
      `}</style>

      {/* ── header ──────────────────────────────────────────────────────────── */}
      <div style={{
        display:        'flex',
        justifyContent: 'space-between',
        alignItems:     'flex-start',
        marginBottom:   28,
        flexWrap:       'wrap',
        gap:            12,
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.text, letterSpacing: '-0.02em' }}>
            Cele Failover
          </h1>
          <div style={{ fontSize: 13, color: C.textMuted, marginTop: 4 }}>
            {data?.primary ? (
              <>
                primary:{' '}
                <span style={{ color: C.primary, fontWeight: 600 }}>{data.primary}</span>
                {data.preferred_next && (
                  <>
                    {' '}·{' '}
                    <span style={{ color: C.textMuted }}>next: </span>
                    <span style={{ color: C.accent }}>{data.preferred_next}</span>
                  </>
                )}
                {hb && (
                  <>
                    {' '}·{' '}
                    <span style={{ color: hb.color }}>♥ {hb.text}</span>
                  </>
                )}
              </>
            ) : (
              <span style={{ color: C.offline }}>no primary detected</span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          {/* live toggle */}
          <button
            onClick={() => setLive(l => !l)}
            style={{
              padding:      '5px 12px',
              borderRadius: 6,
              border:       `1px solid ${live ? C.primary : C.border}`,
              background:   live ? `${C.primary}18` : 'transparent',
              color:        live ? C.primary : C.textMuted,
              fontSize:     12,
              fontWeight:   600,
              cursor:       'pointer',
              display:      'flex',
              alignItems:   'center',
              gap:          6,
            }}
          >
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: live ? C.primary : C.textDim,
              display: 'inline-block',
              animation: live ? 'pulse 2s infinite' : 'none',
            }} />
            {live ? 'LIVE' : 'PAUSED'}
          </button>

          {lastUpdated && (
            <div style={{ fontSize: 11, color: C.textDim }}>
              refreshed {lastUpdated.toLocaleTimeString()}
            </div>
          )}
        </div>
      </div>

      {/* ── error banner ──────────────────────────────────────────────────────── */}
      {error && (
        <div style={{
          background:   `${C.offline}18`,
          border:       `1px solid ${C.offline}55`,
          borderRadius: 8,
          padding:      '12px 16px',
          marginBottom: 24,
          fontSize:     13,
          color:        C.offline,
        }}>
          ⚠ {error}
        </div>
      )}

      {/* ── instance cards grid ───────────────────────────────────────────────── */}
      <div style={{
        display:             'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap:                 16,
        marginBottom:        24,
      }}>
        {data?.cards
          ? data.cards.map(c => (
              <InstanceCard key={c.id} card={c} preferred={data.preferred_next} />
            ))
          : ['render-1','render-2','render-3','render-4'].map(id => (
              <div key={id} style={{
                background: C.surface,
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                padding: '18px 20px',
                color: C.textDim,
                fontSize: 13,
              }}>
                {id}
              </div>
            ))
        }
      </div>

      {/* ── bot state + event log ─────────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.8fr)',
        gap: 16,
        alignItems: 'start',
      }}>
        {/* bot state */}
        <div>
          <div style={{
            fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.08em', color: C.textMuted, marginBottom: 10,
          }}>
            Bot State
          </div>
          <BotState botState={data?.bot_state} />
        </div>

        {/* event log */}
        <div>
          <div style={{
            fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.08em', color: C.textMuted, marginBottom: 10,
          }}>
            {data?.events?.length ? `${data.events.length} events` : 'Events'}
          </div>
          <EventLog events={data?.events ?? []} />
        </div>
      </div>

      {/* ── footer ──────────────────────────────────────────────────────────── */}
      <div style={{
        marginTop: 32,
        paddingTop: 20,
        borderTop: `1px solid ${C.borderAlt}`,
        fontSize: 11,
        color: C.textDim,
        display: 'flex',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 8,
      }}>
        <span>Made by LILBIG4DEV · Cele Selfbot Failover v2</span>
        <span>refreshes every 10s · Upstash Redis + Render free tier</span>
      </div>

    </div>
  )
}
