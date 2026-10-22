# Cele Failover Dashboard

Monitor your Render failover instances in real-time.

## Stack
- Next.js 14 (App Router)
- Upstash Redis REST API
- Deployed on Vercel (free tier)

## Setup

### 1. Deploy to Vercel
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

### 2. Set Environment Variables in Vercel
| Variable | Value |
|---|---|
| `UPSTASH_REDIS_REST_URL` | Your Upstash Redis URL |
| `UPSTASH_REDIS_REST_TOKEN` | Your Upstash Redis token |
| `CRON_SECRET` | Any random string (optional, secures the cron endpoint) |

### 3. The Vercel Cron
`vercel.json` schedules `/api/cron` every 2 minutes.  
It watches `cele:heartbeat` in Redis — if the primary instance dies, it fires the next Render deploy hook automatically.

## Routes
| Route | Purpose |
|---|---|
| `/` | Live dashboard |
| `/api/status` | Redis data as JSON (polled every 10s by dashboard) |
| `/api/cron` | Watchdog — called by Vercel Cron every 2 min |
