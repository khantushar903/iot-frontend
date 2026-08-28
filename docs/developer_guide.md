# Developer Guide

Practical guidance for working on the `iot-frontend` dashboard.

## Component Breakdown

The dashboard is implemented as a single page (`app/page.tsx`) with a set of small, reusable local components plus a shared style system in `app/globals.css`.

### Layout components

| Component | Purpose |
|-----------|---------|
| `Panel` | A bordered container card (`telemetry-panel`). |
| `Label` | The tiny uppercase monospace section label (`telemetry-label`). |
| `MetricCard` | A KPI card wrapper: icon + title header, body children, and an optional `footer`. Configurable accent color (`cyan` / `orange` / `yellow` / `magenta`).

### Rendering/utility helpers

| Helper | Purpose |
|--------|---------|
| `magnitude(r)` | Computes `√(x² + y² + z²)` for a reading. |
| `toDate(value)` | Parses ISO strings and Unix timestamps into `Date`. |
| `timeLabel(value)` | Formats a timestamp as `HH:mm` for chart axes. |
| `fullTimeLabel(value)` | Formats a timestamp as a full human-readable date. |
| `ChartTooltip` | A custom Recharts tooltip rendering the full timestamp and colored per-series values. |

### Page sections (`app/page.tsx`)

1. **Header** — brand lockup, live/idle stream badge, active device chip, connection status.
2. **Overview row** — "LIVE SYSTEM OVERVIEW" label, interval copy, and the ISO 10816 health badge.
3. **Alert banner** — dismissible banner for the most recent alert.
4. **Metrics grid** — four `MetricCard` KPIs: Total Vibration Acceleration, Motor Temperature, Peak Vibration Frequency, Active System Alerts.
5. **Charts grid** — the 3-axis acceleration oscilloscope and the temperature trend, both Recharts `LineChart`s.
6. **Alerts panel** — a table of warning/critical events.
7. **Footer** — last-sample timestamp and socket link status.

Styling lives in `app/globals.css` as CSS variables (colors, grids, tooltip) plus BEM-ish classes. Theme colors are defined in the `:root` block using named variables such as `--cyan`, `--magenta`, `--yellow`, `--orange`, `--green`, `--red`.

## How to Add a Metric

There are two common additions: a new **KPI card** in the metrics grid, and a new **Recharts series** on an existing chart.

### 1. Adding a new KPI card

Pick a value derived from `readings` (computed after `current` / `peak` / `maxTemp`), then add a `MetricCard`:

```tsx
const rms = current ? magnitude(current) : 0;
// or any other derived value, e.g. const xRms = current?.accel_x ?? 0;

<MetricCard
  icon={Zap}
  title="MY NEW METRIC"
  accent="yellow"
  footer={
    <>
      <span>DESCRIPTION</span>
      <strong>{rms.toFixed(2)}</strong>
    </>
  }
>
  <div className="metric-number">
    {rms.toFixed(2)} <small>units</small>
  </div>
</MetricCard>
```

Steps:
1. Choose a Lucide icon and import it.
2. Derive the value from `current`/`readings` (optionally inside a `useMemo` if it is expensive).
3. Add a `<MetricCard ...>` inside the `metrics-grid`.
4. Pick a CSS accent class (`cyan`, `orange`, `yellow`, `magenta`) and add a matching `.icon-box.SOMENAME` rule in `globals.css`.

### 2. Adding a new Recharts series

To plot an extra line (e.g., RMS velocity or a derived axis) on the oscilloscope:

```tsx
// ensure a value is computed in chartData
const chartData = readings.map((r) => ({
  ...r,
  rawTime: r.created_at,
  magnitude: r.magnitude ?? magnitude(r),
  xrms: r.accel_x, // <-- example derived series
}));

// inside the <LineChart>
<Line
  type="monotone"
  dataKey="xrms"
  name="X RMS"
  stroke="var(--green)"
  dot={false}
  strokeWidth={2}
/>
```

Steps:
1. Add the derived field to the `chartData` map in the `Page` component.
2. Add a `<Line>` child to the relevant `<LineChart>` with a valid `stroke` color variable.
3. `name` is what shows in the custom tooltip.
4. If there are now more than three series, extend `ChartTooltip`'s color mapping for the new `dataKey`.

## Local Development & Debugging

### Inspecting incoming WebSocket frames in DevTools

1. Run the backend and `npm run dev`, then open the dashboard.
2. Open DevTools → **Network** tab.
3. Select the **WS** filter (WebSocket frames).
4. Find the connection to `ws://localhost:8000/ws/telemetry` and open it.
5. Use the **Messages** pane to watch `snapshot`, `telemetry`, and `alert` frames arrive in real time.

You can also test the stream from the browser console:

```js
const ws = new WebSocket("ws://localhost:8000/ws/telemetry");
ws.onmessage = (e) => console.log(JSON.parse(e.data));
```

### Mocking the data stream for UI testing

When the backend is unavailable, the page seeds `readings` with a bundled `demo` dataset so the UI renders. To drive a synthetic live stream manually:

1. Open the browser console.
2. Manually dispatch frames through the DevTools console to the page's socket — or simpler, run a tiny local WebSocket stub:

```js
// Node snippet — mock backend publishing telemetry every 1s
const { WebSocketServer } = require("ws");
const wss = new WebSocketServer({ port: 8000, path: "/ws/telemetry" });
setInterval(() => {
  const payload = {
    type: "telemetry",
    data: {
      device_id: "esp32_node",
      accel_x: (Math.random() * 0.2 - 0.1).toFixed(4),
      accel_y: (Math.random() * 0.2 - 0.1).toFixed(4),
      accel_z: (9.7 + Math.random() * 0.1).toFixed(4),
      temp_c: (31 + Math.random() * 2).toFixed(2),
      created_at: new Date().toISOString(),
    },
  };
  wss.clients.forEach((c) => c.readyState === 1 && c.send(JSON.stringify(payload)));
}, 1000);
```

Save as `mock-ws.js` and run with `node mock-ws.js` (requires the `ws` package) to exercise the live-stream path, the live/idle badge, and the charts end-to-end.

### Common gotchas

- **Recharts x-axis ordering** — the chart uses `dataKey="rawTime"` (a sortable ISO/Unix timestamp) with a `tickFormatter` for display. Do not use the pre-formatted `HH:mm` string as the data key, or Recharts may mis-order points.
- **Client-side env vars** — only `NEXT_PUBLIC_*` variables are available in the browser bundle. Restart the dev server after editing `.env.local`.
- **Type checking** — run `npx tsc --noEmit` before committing; there is no lint script configured.
