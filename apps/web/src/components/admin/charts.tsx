export type Series = { key: string; label: string; color: string };
export type Point = { label: string; values: Record<string, number> };

const WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 44 };

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value) ?? 10;
  return step * magnitude;
}

function shortDay(label: string): string {
  const date = new Date(`${label}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? label : date.toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
}

function Legend({ series }: { series: Series[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
      {series.map((item) => (
        <li key={item.key} className="flex items-center gap-2">
          <span aria-hidden className="size-3 rounded-sm" style={{ background: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function Axes({ max, format, labels, x }: { max: number; format: (value: number) => string; labels: string[]; x: (index: number) => number }) {
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;
  const every = Math.max(1, Math.ceil(labels.length / 7));
  return (
    <g className="text-[11px]" fill="currentColor">
      {[0, 0.5, 1].map((fraction) => {
        const y = PAD.top + innerHeight * (1 - fraction);
        return (
          <g key={fraction}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y} y2={y} stroke="var(--line)" strokeDasharray={fraction ? "3 4" : undefined} />
            <text x={PAD.left - 6} y={y + 4} textAnchor="end" className="fill-muted">{format(max * fraction)}</text>
          </g>
        );
      })}
      {labels.map((label, index) => (index % every === 0 || index === labels.length - 1) && (index === labels.length - 1 || labels.length - 1 - index >= every / 2) ? (
        <text key={label} x={x(index)} y={HEIGHT - 8} textAnchor={index === labels.length - 1 && labels.length > 1 ? "end" : index === 0 && labels.length > 1 ? "start" : "middle"} className="fill-muted">{shortDay(label)}</text>
      ) : null)}
    </g>
  );
}

export function ChartCard({ title, summary, children }: { title: string; summary?: string; children: React.ReactNode }) {
  return (
    <figure className="flex h-full min-w-0 flex-col gap-3 rounded-surface border border-line bg-surface p-5">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-bold text-ink">{title}</span>
        {summary ? <span className="text-sm text-muted">{summary}</span> : null}
      </figcaption>
      {children}
    </figure>
  );
}

export function StackedBarChart({ data, series, format }: { data: Point[]; series: Series[]; format: (value: number) => string }) {
  const max = niceMax(Math.max(0, ...data.map((point) => series.reduce((sum, item) => sum + (point.values[item.key] ?? 0), 0))));
  const innerWidth = WIDTH - PAD.left - PAD.right;
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;
  const slot = innerWidth / Math.max(1, data.length);
  const barWidth = Math.max(2, Math.min(28, slot * 0.7));
  const x = (index: number) => PAD.left + slot * index + slot / 2;
  return (
    <>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full" role="img">
        <Axes max={max} format={format} labels={data.map((point) => point.label)} x={x} />
        {data.map((point, index) => {
          let offset = 0;
          return (
            <g key={point.label}>
              {series.map((item) => {
                const value = point.values[item.key] ?? 0;
                if (!value) return null;
                const height = (value / max) * innerHeight;
                offset += height;
                return (
                  <rect key={item.key} x={x(index) - barWidth / 2} y={PAD.top + innerHeight - offset} width={barWidth} height={height} rx={2} fill={item.color}>
                    <title>{`${shortDay(point.label)} · ${item.label}: ${format(value)}`}</title>
                  </rect>
                );
              })}
            </g>
          );
        })}
      </svg>
      <Legend series={series} />
    </>
  );
}

export function LineChart({ data, series, format }: { data: Point[]; series: Series[]; format: (value: number) => string }) {
  const max = niceMax(Math.max(0, ...data.flatMap((point) => series.map((item) => point.values[item.key] ?? 0))));
  const innerWidth = WIDTH - PAD.left - PAD.right;
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (index: number) => PAD.left + (data.length > 1 ? (innerWidth * index) / (data.length - 1) : innerWidth / 2);
  const y = (value: number) => PAD.top + innerHeight * (1 - value / max);
  return (
    <>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full" role="img">
        <Axes max={max} format={format} labels={data.map((point) => point.label)} x={x} />
        {series.map((item, seriesIndex) => {
          const points = data.map((point, index) => `${x(index)},${y(point.values[item.key] ?? 0)}`);
          return (
            <g key={item.key}>
              {seriesIndex === 0 && data.length > 1 ? (
                <polygon points={`${x(0)},${y(0)} ${points.join(" ")} ${x(data.length - 1)},${y(0)}`} fill={item.color} opacity={0.12} />
              ) : null}
              <polyline points={points.join(" ")} fill="none" stroke={item.color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
              {data.map((point, index) => (
                <circle key={point.label} cx={x(index)} cy={y(point.values[item.key] ?? 0)} r={data.length > 45 ? 0 : 3} fill={item.color}>
                  <title>{`${shortDay(point.label)} · ${item.label}: ${format(point.values[item.key] ?? 0)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      <Legend series={series} />
    </>
  );
}

export function DonutChart({ slices, format, center }: { slices: { label: string; value: number; color: string }[]; format: (value: number) => string; center: string }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 140 140" className="size-36 shrink-0" role="img">
        <circle cx={70} cy={70} r={radius} fill="none" stroke="var(--line)" strokeWidth={18} />
        {total > 0 ? slices.map((slice) => {
          const length = (slice.value / total) * circumference;
          const dash = (
            <circle key={slice.label} cx={70} cy={70} r={radius} fill="none" stroke={slice.color} strokeWidth={18}
              strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} transform="rotate(-90 70 70)">
              <title>{`${slice.label}: ${format(slice.value)}`}</title>
            </circle>
          );
          offset += length;
          return dash;
        }) : null}
        <text x={70} y={68} textAnchor="middle" className="fill-ink text-[20px] font-extrabold">{center}</text>
        <text x={70} y={86} textAnchor="middle" className="fill-muted text-[10px]">total</text>
      </svg>
      <ul className="flex min-w-0 flex-col gap-2 text-sm">
        {slices.map((slice) => (
          <li key={slice.label} className="flex items-center gap-2">
            <span aria-hidden className="size-3 rounded-sm" style={{ background: slice.color }} />
            <span className="text-ink">{slice.label}</span>
            <span className="text-muted">
              {format(slice.value)}{total > 0 ? ` · ${Math.round((slice.value / total) * 100)}%` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BarList({ rows, format, color }: { rows: { label: string; value: number; href?: string }[]; format: (value: number) => string; color: string }) {
  const max = Math.max(0, ...rows.map((row) => row.value)) || 1;
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row, index) => (
        <li key={`${row.href ?? row.label}-${index}`} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
          {row.href ? (
            <a href={row.href} className="truncate font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:text-record">{row.label}</a>
          ) : <span className="truncate font-semibold text-ink">{row.label}</span>}
          <span className="h-3 overflow-hidden rounded-full bg-sunken">
            <span className="block h-full rounded-full" style={{ width: `${Math.max(row.value ? 3 : 0, (row.value / max) * 100)}%`, background: color }} />
          </span>
          <span className="tabular-nums text-muted">{format(row.value)}</span>
        </li>
      ))}
    </ul>
  );
}
