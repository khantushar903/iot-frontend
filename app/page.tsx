"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  Cable,
  CheckCircle2,
  Cpu,
  Gauge,
  Radio,
  Thermometer,
  Wifi,
  Zap,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
type Reading = {
  device_id: string;
  accel_x: number;
  accel_y: number;
  accel_z: number;
  temp_c: number;
  created_at: string;
  magnitude?: number;
};
type AlertItem = {
  device_id: string;
  severity: "CRITICAL" | "WARNING" | "RESOLVED";
  metric: string;
  value: number;
  threshold: number;
  message: string;
  created_at: string;
};

const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/ws/telemetry";

// Raw 3-axis magnitude. This still contains gravity (about 9.81 m/s^2 on
// whichever axis the board is mounted on), so it is only meaningful as a
// trend, never compared against an absolute severity threshold.
function magnitude(r: Reading) {
  return Math.sqrt(r.accel_x ** 2 + r.accel_y ** 2 + r.accel_z ** 2);
}

// Resultant acceleration RMS over the buffered readings, mirroring the backend
// method: remove each axis's DC component (which is gravity plus any constant
// bias) and then take the root mean square of the resultant.
//
// This is a coarse client-side estimate over the readings the browser happens
// to hold, not the authoritative metric - the backend analyses a proper
// window at the true device sample rate. It exists so the badge does not sit
// at a constant ~9.81 m/s^2 reading gravity and claim the motor is critical.
function acResultantRms(readings: Reading[]): number {
  if (readings.length === 0) return 0;
  if (readings.length < 2) {
    const r = readings[0];
    return magnitude(r);
  }
  const mean = readings.reduce(
    (acc, r) => ({
      x: acc.x + r.accel_x / readings.length,
      y: acc.y + r.accel_y / readings.length,
      z: acc.z + r.accel_z / readings.length,
    }),
    { x: 0, y: 0, z: 0 },
  );
  const sum =
    readings.reduce((acc, r) => {
      const x = r.accel_x - mean.x;
      const y = r.accel_y - mean.y;
      const z = r.accel_z - mean.z;
      return acc + x * x + y * y + z * z;
    }, 0) / readings.length;
  return Math.sqrt(sum);
}

function toDate(value: string | number): Date {
  if (typeof value === "number") return new Date(value);
  const n = Number(value);
  if (Number.isFinite(n)) return new Date(n);
  return new Date(value);
}
function timeLabel(value: string | number) {
  return toDate(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function fullTimeLabel(value: string | number) {
  return toDate(value).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { dataKey: string; name: string; value: number }[];
  label?: string;
}) {
  if (!active || !payload || !payload.length) return null;
  const ts = label === undefined ? "" : fullTimeLabel(label);
  return (
    <div
      style={{
        background: "var(--tooltip)",
        border: "1px solid var(--border)",
        borderRadius: 2,
        fontSize: 11,
        padding: "8px 10px",
      }}
    >
      <div style={{ color: "var(--muted-foreground)", marginBottom: 5 }}>
        {ts}
      </div>
      {payload.map((p, i) => (
        <div key={i}>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              background:
                p.dataKey === "accel_x"
                  ? "var(--cyan)"
                  : p.dataKey === "accel_y"
                    ? "var(--yellow)"
                    : "var(--magenta)",
              borderRadius: 1,
              marginRight: 6,
            }}
          />
          {p.name}:{" "}
          <strong>{p.value !== undefined ? p.value.toFixed(2) : "—"}</strong>
        </div>
      ))}
    </div>
  );
}
function Panel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`telemetry-panel ${className}`}>{children}</section>
  );
}
function Label({ children }: { children: React.ReactNode }) {
  return <p className="telemetry-label">{children}</p>;
}
function MetricCard({
  icon: Icon,
  title,
  accent,
  children,
  footer,
}: {
  icon: typeof Activity;
  title: string;
  accent: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Panel className="metric-card">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className={`icon-box ${accent}`}>
            <Icon size={17} />
          </span>
          <Label>{title}</Label>
        </div>
        <span className="signal-mark" />
      </div>
      {children}
      {footer && <div className="metric-footer">{footer}</div>}
    </Panel>
  );
}

export default function Page() {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastAlert, setLastAlert] = useState<AlertItem | null>(null);
  const [streamLive, setStreamLive] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  const reconnect = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markLive = () => {
    setStreamLive(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setStreamLive(false), 3000);
  };

  useEffect(() => {
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const connect = () => {
      if (!alive) return;
      try {
        const ws = new WebSocket(WS_URL);
        socket.current = ws;
        ws.onopen = () => setConnected(true);
        ws.onclose = () => {
          setConnected(false);
          reconnect.current = setTimeout(connect, 3000);
        };
        ws.onerror = () => ws.close();
        ws.onmessage = (event) => {
          try {
            const frame = JSON.parse(event.data);
            if (frame.type === "telemetry") {
              markLive();
              setReadings((prev) =>
                [
                  ...prev,
                  { ...frame.data, magnitude: magnitude(frame.data) },
                ].slice(-30),
              );
            }
            if (frame.type === "snapshot")
              setReadings(
                frame.data
                  .map((r: Reading) => ({ ...r, magnitude: magnitude(r) }))
                  .slice(-30),
              );
            if (frame.type === "alert") {
              const item = {
                ...frame.data,
                device_id: frame.data.device_id ?? "esp32_node",
              };
              setAlerts((prev) => [item, ...prev].slice(0, 12));
              setLastAlert(item);
            }
          } catch {
            /* ignore malformed frames */
          }
        };
      } catch {
        setConnected(false);
        reconnect.current = setTimeout(connect, 3000);
      }
    };
    connect();
    return () => {
      alive = false;
      if (reconnect.current) clearTimeout(reconnect.current);
      socket.current?.close();
    };
  }, []);

  const current = readings[readings.length - 1];
  const chartData = readings.map((r) => ({
    ...r,
    rawTime: r.created_at,
    magnitude: r.magnitude ?? magnitude(r),
  }));
  const peak = useMemo(() => {
    if (readings.length < 3) return "0.00";
    let bestPeriod = 0,
      bestScore = 0;
    for (let period = 2; period <= 8; period++) {
      let score = 0;
      for (let i = period; i < readings.length; i++)
        score += Math.abs(
          (readings[i].magnitude ?? magnitude(readings[i])) -
            (readings[i - period].magnitude ?? magnitude(readings[i - period])),
        );
      if (score > bestScore) {
        bestScore = score;
        bestPeriod = period;
      }
    }
    return bestPeriod ? (10 / bestPeriod).toFixed(2) : "0.00";
  }, [readings]);
  // Gravity-removed RMS drives severity. `vibMag` (raw magnitude) does not:
  // it sits at roughly 9.81 m/s^2 whenever the motor is stationary, so
  // thresholding it marks an idle motor as critical.
  const vibRms = useMemo(() => acResultantRms(readings), [readings]);
  const vibMag = current ? magnitude(current) : 0;
  const WARNING_RMS = 2.0;
  const CRITICAL_RMS = 5.0;
  const health =
    vibRms >= CRITICAL_RMS
      ? ["Critical Vibration", "health-critical"]
      : vibRms >= WARNING_RMS
        ? ["Warning", "health-warning"]
        : ["Normal", "health-good"];
  const maxTemp = current?.temp_c ?? 0;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-icon">
            <Activity size={20} />
          </div>
          <div>
            <h1>
              Industrial Motor Health <span>&amp; Telemetry</span>
            </h1>
          </div>
        </div>
        <div className="header-status">
          <div className={`stream-chip ${streamLive ? "live" : "idle"}`}>
            <span className="stream-dot" />
            {streamLive ? "STREAM: LIVE" : "STREAM: IDLE (SNAPSHOT DATA)"}
          </div>
          <div className="device-chip">
            <Cpu size={15} />
            <span>ACTIVE DEVICE</span>
            <strong>{current?.device_id ?? "esp32_node"}</strong>
          </div>
          <div className={`connection-chip ${connected ? "is-connected" : ""}`}>
            <span className="status-dot" />
            {connected ? "CONNECTED" : "DISCONNECTED"}
            <Wifi size={14} />
          </div>
        </div>
      </header>
      <div className="dashboard-shell">
        <div className="overview-row">
          <div>
            <Label>LIVE SYSTEM OVERVIEW</Label>
            <p className="overview-copy">
              Motor 01 <span>/</span> Interval: 1 Hz
            </p>
          </div>
          <div className={`health-badge ${health[1]}`}>
            <span className="health-dot" />
            STATUS: <strong>{health[0]}</strong>
          </div>
        </div>
        {lastAlert && (
          <div
            className={`alert-banner ${lastAlert.severity === "CRITICAL" ? "critical" : ""} ${lastAlert.severity === "RESOLVED" ? "resolved" : ""}`}
          >
            {lastAlert.severity === "RESOLVED" ? (
              <CheckCircle2 size={20} />
            ) : (
              <AlertTriangle size={20} />
            )}
            <div>
              <Label>
                {lastAlert.severity === "RESOLVED"
                  ? "CONDITION RESOLVED"
                  : `${lastAlert.severity} EVENT DETECTED`}
              </Label>
              <p>{lastAlert.message}</p>
            </div>
            <button
              onClick={() => setLastAlert(null)}
              aria-label="Dismiss alert"
            >
              DISMISS
            </button>
          </div>
        )}
        <div className="metrics-grid">
          <MetricCard
            icon={Gauge}
            title="VIBRATION ACCELERATION RMS"
            accent="cyan"
footer={
  <>
    <span>RAW MAGNITUDE (INCL. GRAVITY)</span>
    <strong>{vibMag.toFixed(2)} m/s²</strong>
  </>
}
>
  <div className="metric-number">
    {vibRms.toFixed(2)} <small>m/s²</small>
  </div>
            <p className="metric-note">
              RMS over the last {readings.length} samples, gravity removed. Raw
              3-axis magnitude is {vibMag.toFixed(2)} m/s².
            </p>
            <div className="axis-values">
              <span>
                X <b>{current?.accel_x.toFixed(2)}</b>
              </span>
              <span>
                Y <b>{current?.accel_y.toFixed(2)}</b>
              </span>
              <span>
                Z <b>{current?.accel_z.toFixed(2)}</b>
              </span>
            </div>
          </MetricCard>
          <MetricCard
            icon={Thermometer}
            title="MPU6050 INTERNAL TEMP"
            accent="orange"
            footer={
              <>
                <span>LIMIT</span>
                <strong>45.0 °C</strong>
              </>
            }
          >
            <div className={`metric-number ${maxTemp > 45 ? "hot" : ""}`}>
              {maxTemp.toFixed(1)} <small>°C</small>
            </div>
            <div className="progress-track">
              <span
                style={{ width: `${Math.min((maxTemp / 60) * 100, 100)}%` }}
              />
            </div>
          </MetricCard>
          <MetricCard
            icon={Zap}
            title="PEAK VIBRATION FREQUENCY"
            accent="yellow"
            footer={
              <>
                <span>ANALYSIS WINDOW</span>
                <strong>30 READINGS</strong>
              </>
            }
          >
            <div className="metric-number">
              {peak} <small>Hz</small>
            </div>
            <p className="metric-note">
              Derived spectral estimate <span>↗ LIVE</span>
            </p>
          </MetricCard>
          <MetricCard
            icon={Bell}
            title="ACTIVE SYSTEM ALERTS"
            accent="magenta"
            footer={
              <>
                <span>UNACKNOWLEDGED EVENTS</span>
                <strong>REAL-TIME</strong>
              </>
            }
          >
            <div className="metric-number">
              {alerts.length.toString().padStart(2, "0")}
            </div>
            <p className="metric-note">
              Warning + critical events{" "}
              <span className={alerts.length ? "warn" : ""}>
                {alerts.length ? "REVIEW REQUIRED" : "ALL CLEAR"}
              </span>
            </p>
          </MetricCard>
        </div>
        <div className="charts-grid">
          <Panel className="chart-panel acceleration">
            <div className="panel-heading">
              <div>
                <Label>REAL-TIME OSCILLOSCOPE</Label>
                <h2>Three-axis acceleration</h2>
              </div>
              <div className="legend">
                <span className="legend-cyan">X AXIS</span>
                <span className="legend-yellow">Y AXIS</span>
                <span className="legend-magenta">Z AXIS</span>
              </div>
            </div>
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid stroke="var(--grid)" vertical={false} />
                  <XAxis
                    dataKey="rawTime"
                    tickFormatter={(v) => timeLabel(v)}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="accel_x"
                    name="X Axis"
                    stroke="var(--cyan)"
                    dot={false}
                    strokeWidth={2}
                  />
                  <Line
                    type="monotone"
                    dataKey="accel_y"
                    name="Y Axis"
                    stroke="var(--yellow)"
                    dot={false}
                    strokeWidth={2}
                  />
                  <Line
                    type="monotone"
                    dataKey="accel_z"
                    name="Z Axis"
                    stroke="var(--magenta)"
                    dot={false}
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel className="chart-panel temperature">
            <div className="panel-heading">
              <div>
                <Label>THERMAL TREND</Label>
                <h2>Motor temperature</h2>
              </div>
              <div className="live-tag">
                <span className="status-dot" /> LIVE
              </div>
            </div>
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid stroke="var(--grid)" vertical={false} />
                  <XAxis
                    dataKey="rawTime"
                    tickFormatter={(v) => timeLabel(v)}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="temp_c"
                    name="Temperature"
                    stroke="var(--orange)"
                    dot={false}
                    strokeWidth={2.5}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>
        <Panel className="alerts-panel">
          <div className="panel-heading">
            <div>
              <Label>EVENT STREAM</Label>
              <h2>System event &amp; alarm log</h2>
            </div>
            <div className="log-status">
              <Radio size={14} /> STREAM ACTIVE
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Device ID</th>
                  <th>Metric</th>
                  <th>Severity</th>
                  <th>Value / Threshold</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {alerts.length ? (
                  alerts.map((a, i) => (
                    <tr key={`${a.created_at}-${i}`}>
                      <td>{fullTimeLabel(a.created_at)}</td>
                      <td>{a.device_id ?? "esp32_node"}</td>
                      <td>{a.metric}</td>
                      <td>
                        <span
                          className={`severity ${a.severity.toLowerCase()}`}
                        >
                          {a.severity}
                        </span>
                      </td>
                      <td>
                        {a.value.toFixed(2)} / {a.threshold.toFixed(2)}
                      </td>
                      <td>{a.message}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6}>
                      <div className="empty-state">
                        <Cable size={18} />
                        <span>
                          No active alerts detected. Machine operating within
                          normal parameters.
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
        <footer>
          <span>
            LAST SAMPLE{" "}
            <strong>{current ? fullTimeLabel(current.created_at) : "—"}</strong>
          </span>
          <span className="footer-connection">
            <span className="status-dot" />{" "}
            {connected ? "SOCKET LINK NOMINAL" : "AWAITING SOCKET LINK"}
          </span>
        </footer>
      </div>
    </main>
  );
}
