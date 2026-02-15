import { useMemo } from "react";

interface Point {
  x: number;
  y: number;
}

interface DynoGraphProps {
  whp: number;
  wtq: number;
  rpm: number;
  showHp: boolean;
  showTq: boolean;
}

function toPath(points: Point[]): string {
  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`,
    )
    .join(" ");
}

function toSmoothPath(points: Point[]): string {
  if (points.length < 2) {
    return toPath(points);
  }

  const path = [`M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`];

  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    path.push(
      `C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`,
    );
  }

  return path.join(" ");
}

export default function DynoGraph({ whp, wtq, rpm, showHp, showTq }: DynoGraphProps) {
  const width = 900;
  const height = 430;
  const pad = { top: 24, right: 24, bottom: 44, left: 52 };

  const chart = useMemo(() => {
    const minRpm = 0;
    const maxRpm = Math.max(minRpm + 1200, rpm);
    const yMax = Math.max(900, Math.ceil((Math.max(whp, wtq) + 120) / 50) * 50);
    const steps = 220;

    const xScale = (value: number) =>
      pad.left +
      ((value - minRpm) / (maxRpm - minRpm)) * (width - pad.left - pad.right);
    const yScale = (value: number) =>
      pad.top + (1 - value / yMax) * (height - pad.top - pad.bottom);

    const hpCurve: Point[] = [];
    const tqCurve: Point[] = [];

    const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

    const tqRawSamples: Array<{ rpm: number; tqRaw: number }> = [];
    const hpRawSamples: Array<{ rpm: number; tqValue: number; hpRawValue: number }> = [];
    for (let i = 0; i <= steps; i += 1) {
      const currentRpm = minRpm + (i / steps) * (maxRpm - minRpm);

      const rise = sigmoid((currentRpm - 3600) / 760);
      const fallCenter = minRpm + (maxRpm - minRpm) * 0.84;
      const fall = sigmoid((currentRpm - fallCenter) / 650);
      const tqRaw = 0.34 + 0.86 * rise - 0.34 * fall;

      tqRawSamples.push({ rpm: currentRpm, tqRaw });
    }

    const tqRawPeak = Math.max(...tqRawSamples.map((item) => item.tqRaw));
    const tqScale = wtq / (tqRawPeak || 1);

    for (const item of tqRawSamples) {
      const tqValue = item.tqRaw * tqScale;
      const hpRawValue = (tqValue * item.rpm) / 5252;
      hpRawSamples.push({ rpm: item.rpm, tqValue, hpRawValue });
    }

    const hpRawPeak = Math.max(...hpRawSamples.map((item) => item.hpRawValue));
    const hpScale = whp / (hpRawPeak || 1);

    for (let i = 0; i <= steps; i += 1) {
      const currentRpm = hpRawSamples[i].rpm;
      const tqValue = hpRawSamples[i].tqValue;
      const hpValue = hpRawSamples[i].hpRawValue * hpScale;

      hpCurve.push({ x: xScale(currentRpm), y: yScale(hpValue) });
      tqCurve.push({ x: xScale(currentRpm), y: yScale(tqValue) });
    }

    const xTicks = Array.from({ length: 9 }, (_, index) => {
      const value = minRpm + (index / 8) * (maxRpm - minRpm);
      return Math.round(value / 100) * 100;
    });
    const yTicks = [0, 150, 300, 450, 600, 750, 900, yMax].filter(
      (v, i, arr) => arr.indexOf(v) === i,
    );

    return {
      xTicks,
      yTicks,
      hpPath: toSmoothPath(hpCurve),
      tqPath: toSmoothPath(tqCurve),
      xScale,
      yScale,
    };
  }, [whp, wtq, rpm]);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Dyno horsepower and torque graph">
      <rect x="0" y="0" width={width} height={height} fill="transparent" />

      {chart.yTicks.map((tick) => (
        <line
          key={`y-${tick}`}
          x1={pad.left}
          y1={chart.yScale(tick)}
          x2={width - pad.right}
          y2={chart.yScale(tick)}
          className="grid-line"
        />
      ))}

      {chart.xTicks.map((tick) => (
        <line
          key={`x-${tick}`}
          x1={chart.xScale(tick)}
          y1={pad.top}
          x2={chart.xScale(tick)}
          y2={height - pad.bottom}
          className="grid-line"
        />
      ))}

      <line
        x1={pad.left}
        y1={pad.top}
        x2={pad.left}
        y2={height - pad.bottom}
        className="axis-line"
      />
      <line
        x1={pad.left}
        y1={height - pad.bottom}
        x2={width - pad.right}
        y2={height - pad.bottom}
        className="axis-line"
      />

      {showTq && <path d={chart.tqPath} className="curve curve-tq" />}
      {showHp && <path d={chart.hpPath} className="curve curve-hp" />}

      {chart.xTicks.map((tick) => (
        <text
          key={`xl-${tick}`}
          x={chart.xScale(tick)}
          y={height - 18}
          className="axis-label"
          textAnchor="middle"
        >
          {tick}
        </text>
      ))}

      {chart.yTicks.map((tick) => (
        <text
          key={`yl-${tick}`}
          x={pad.left - 8}
          y={chart.yScale(tick) + 4}
          className="axis-label"
          textAnchor="end"
        >
          {tick}
        </text>
      ))}

      <text x={width / 2} y={height - 2} className="axis-title" textAnchor="middle">
        RPM
      </text>
      <text
        x="18"
        y={height / 2}
        className="axis-title"
        textAnchor="middle"
        transform={`rotate(-90 18 ${height / 2})`}
      >
        Power / Torque
      </text>
    </svg>
  );
}