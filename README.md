# Industrial IoT Motor Telemetry Dashboard (Next.js Frontend)

A real-time condition-monitoring dashboard for industrial motors. It ingests live telemetry over WebSockets (3-axis vibration + temperature), renders an oscilloscope-style signal viewer and thermal trend, derives ISO 10816 machine-health severity, and surfaces an alert log — all in a single responsive screen.

## Tech Stack

| Technology | Purpose |
|------------|---------|
| Next.js (App Router) | Application framework & routing |
| TypeScript | Type-safe development |
| Tailwind CSS | Styling & layout |
| Shadcn UI | Base UI primitives (buttons, design tokens) |
| Recharts | Line charts (oscilloscope & thermal trend) |
| Lucide Icons | UI icons |

## Key Features

- **Real-time WebSocket stream ingestion** — connects to the backend telemetry channel with automatic reconnection and a live/idle stream-state badge.
- **3-axis vibration oscilloscope** — live X/Y/Z acceleration line chart built on a sliding window buffer.
- **Thermal trend monitoring** — continuous motor temperature chart with per-sample tooltips.
- **Dynamic ISO 10816 machine health severity badges** — maps vibration magnitude to Zones A–D (Good / Warning / Critical Unbalance).
- **Active alert logs** — real-time event table (WARNING / CRITICAL) with timestamp, device, metric, value/threshold, and message.

## Quickstart

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

> The dashboard requires the `iot-backend` service (FastAPI + Redis + Postgres + Celery) to be running and publishing WebSocket frames to `ws://localhost:8000/ws/telemetry`. Without a backend, the dashboard renders a bundled demo dataset so the UI is still explorable.

## Environment Variables

Copy `.env.example` to `.env.local` and adjust as needed.

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_WS_URL` | WebSocket endpoint for the real-time telemetry stream. | `ws://localhost:8000/ws/telemetry` |
| `NEXT_PUBLIC_API_URL` | Base URL for the REST API (reserved for future fetch-based features). | `http://localhost:8000/api/v1` |

Both variables are read at build time and inlined into the client bundle. Variable names beginning with `NEXT_PUBLIC_` are exposed to the browser by Next.js automatically.

## Project Structure

```
app/
  page.tsx        # Main dashboard page (telemetry, charts, alerts)
  globals.css     # Global styles, CSS variables, dashboard theme
  layout.tsx      # Root layout
components/
  ui/             # Shadcn UI primitives
lib/
  utils.ts        # Shared helpers
.env.example      # Environment variable template
```

See `docs/architecture.md` for state & data-flow internals, `docs/developer_guide.md` for component and contribution guides, and `docs/handover_state.md` for the project handover/freeze status.
