# Frontend State Architecture

This document describes the internal state design and data flow of the dashboard, implemented in `app/page.tsx`.

## Frontend State Architecture

### Core state

The component holds five pieces of state:

| State | Type | Purpose |
|-------|------|---------|
| `readings` | `Reading[]` | The sliding window of telemetry samples used for charts and the "current" value. |
| `alerts` | `AlertItem[]` | The active alert log (most recent first, capped at 12). |
| `connected` | `boolean` | Whether the WebSocket transport is currently open. |
| `lastAlert` | `AlertItem \| null` | The most recent alert, shown as a dismissible banner. |
| `streamLive` | `boolean` | Whether a live `telemetry` frame arrived within the last 3 seconds. |

Refs are used for values that must not trigger re-renders:

| Ref | Purpose |
|-----|---------|
| `socket` | The active `WebSocket` instance. |
| `reconnect` | Handle for the scheduled reconnection timeout. |
| `idleTimer` | Handle for the 3-second live/idle detection timeout. |
| `lastFrame` | Timestamp (`Date.now()`) of the most recent telemetry frame. |

### The 30-reading sliding window buffer

Charts stay performant by rendering a bounded window rather than an unbounded history.

- Live frames are **appended** to the end of the buffer:

  ```ts
  setReadings((prev) => [...prev, next].slice(-30));
  ```

- Snapshot frames **replace** the buffer entirely:

  ```ts
  setReadings(frame.data.map(normalize).slice(-30));
  ```

- The `.slice(-30)` bound keeps at most 30 samples in memory and render, so Recharts never redraws a growing list. At a 1 Hz interval this represents ~30 seconds of history — the analysis window for the peak-frequency derivation.

### Derived (memoized) values

- `current` — the newest reading (`readings[readings.length - 1]`); drives all KPI cards.
- `chartData` — `readings` mapped into chart-ready objects, adding `rawTime` (the raw timestamp used as the x-axis key) and a guaranteed `magnitude`.
- `peak` (`useMemo`) — a lightweight spectral estimate. It scans candidate periods (2–8 samples), scores each by the summed deltas between samples one period apart, and returns `10 / bestPeriod` Hz. Recomputed only when `readings` changes.
- `health` — the ISO 10816 severity tuple (`[label, cssClass]`).
- `maxTemp` — current temperature used for the temperature card.

## WebSocket Contract Lifecycle

The dashboard expects JSON frames from the backend with a `type` discriminator.

### Frame types

| `type` | Meaning | Frontend handling |
|--------|---------|-------------------|
| `snapshot` | Initial/backfill batch of historical samples (`frame.data: Reading[]`). | Clears the buffer, maps + computes `magnitude`, keeps last 30. |
| `telemetry` | A single new live sample (`frame.data: Reading`). | Computes `magnitude`, appends to buffer (kept ≤ 30), marks the stream live. |
| `alert` | A new warning/critical event. | Prepends to the alert log (capped at 12) and shows the banner. |

### Connection lifecycle

1. **Open** — on mount, a `WebSocket` is created against `WS_URL`. `onopen` sets `connected = true`.
2. **Malformed frame guard** — each message is parsed inside a `try/catch`; malformed payloads are silently ignored so a bad frame never crashes the UI.
3. **Idle / live detection** — every received `telemetry` frame calls `markLive()`, which starts a 3-second countdown. If a frame arrives before the countdown ends, the timer resets; if not, `streamLive` flips to `false` and the header badge switches to `STREAM: IDLE (SNAPSHOT DATA)`.
4. **Disconnect & reconnect** — `onclose` clears `connected` and schedules a reconnect after 3 seconds. `onerror` closes the socket (which triggers `onclose` → reconnect). The effect cleanup closes the socket and clears pending timeouts on unmount, and an `alive` guard prevents reconnect timers from firing after unmount.

## Data Normalization

### Timestamp parsing

Incoming `created_at` values may arrive in two forms:

- **ISO 8601 string**, e.g. `2026-08-28T15:45:00.000Z`.
- **Unix timestamp** (numeric value or numeric string).

The `toDate()` helper handles both:

```ts
function toDate(value: string | number): Date {
  if (typeof value === "number") return new Date(value);
  const n = Number(value);
  if (Number.isFinite(n)) return new Date(n);
  return new Date(value);
}
```

Formatting:

| Context | Function | Format |
|---------|----------|--------|
| Chart x-axis | `timeLabel` | `HH:mm` (e.g., `23:43`) |
| Chart tooltips / footer / alert log | `fullTimeLabel` | `Aug 27, 2026, 11:43 PM` |

### ISO 10816 threshold mapping

Machine health is derived from the total vibration magnitude (RMS vector `√(x² + y² + z²)`):

| Magnitude threshold | Zone | Severity label | CSS class |
|---------------------|------|----------------|-----------|
| `> 11` m/s² | D | `Zone D: Critical Unbalance` | `health-critical` |
| `> 10` m/s² | C | `Zone C: Warning` | `health-warning` |
| `≤ 10` m/s² | A | `Zone A: Good` | `health-good` |

The magnitude is recomputed on every ingested frame via `magnitude(r)` (`√(accel_x² + accel_y² + accel_z²)`), so the health badge always reflects the most recent sample.
