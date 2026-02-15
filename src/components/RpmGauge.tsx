interface RpmGaugeProps {
  rpm: number;
  minRpm?: number;
  maxRpm?: number;
  redline?: number;
}

export default function RpmGauge({ rpm, minRpm = 0, maxRpm = 9000, redline = 8500 }: RpmGaugeProps) {
  const clamped = Math.max(minRpm, Math.min(maxRpm, rpm));
  const ratio = (clamped - minRpm) / (maxRpm - minRpm || 1);
  const segments = 18;
  const activeCount = Math.round(ratio * segments);
  const redlineRatio =
    (Math.max(minRpm, Math.min(maxRpm, redline)) - minRpm) /
    (maxRpm - minRpm || 1);

  return (
    <aside className="rpm-gauge" aria-label="Peak RPM gauge">
      <p className="rpm-gauge-title">MAX RPM</p>
      <div className="rpm-gauge-track-wrap">
        <div className="rpm-gauge-track">
          {Array.from({ length: segments }, (_, index) => (
            <span
              key={`rpm-segment-${index}`}
              className={index >= segments - activeCount ? "segment active" : "segment"}
            />
          ))}
        </div>
        <span className="rpm-redline" style={{ bottom: `${redlineRatio * 100}%` }} />
      </div>
      <p className="rpm-gauge-value">{rpm}</p>
      <p className="rpm-gauge-range">
        {minRpm} - {maxRpm}
      </p>
    </aside>
  );
}