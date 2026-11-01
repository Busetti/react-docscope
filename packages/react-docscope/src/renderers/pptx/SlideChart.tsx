import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import type { PptxElement } from './slideModel';

/** Office default accents, used when the deck has no theme colours. */
export const OFFICE_PALETTE = ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47'];

/** Theme accent colours of the current deck. */
export const ChartPaletteContext = createContext<string[]>(OFFICE_PALETTE);

const TEXT = '#595959';
const GRID = '#D9D9D9';
const FONT = 10;

interface Series {
  name: string;
  values: number[];
  color: string;
}

export interface ChartModel {
  kind: 'bar' | 'line' | 'area' | 'pie' | 'scatter' | 'radar';
  horizontal: boolean;
  stacking: 'none' | 'stacked' | 'percent';
  markers: boolean;
  hole: number;
  categories: string[];
  series: Series[];
  /** Per-point colours (pie slices). */
  pointColors: string[];
  /** Scatter only. */
  xs: number[];
  scatterLines: boolean;
}

interface CategorySeries {
  key?: string | number;
  values?: Array<{ x: string | number; y: number }>;
  xlabels?: Record<string, string>;
}

const KINDS: Record<string, ChartModel['kind']> = {
  barChart: 'bar',
  bar3DChart: 'bar',
  lineChart: 'line',
  line3DChart: 'line',
  areaChart: 'area',
  area3DChart: 'area',
  pieChart: 'pie',
  pie3DChart: 'pie',
  doughnutChart: 'pie',
  scatterChart: 'scatter',
  radarChart: 'radar',
};

const finite = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

/** Normalizes pptxtojson chart data. Returns null for unsupported or empty charts. */
export function toChartModel(el: PptxElement, palette: string[]): ChartModel | null {
  const kind = KINDS[el.chartType ?? ''];
  if (!kind || !Array.isArray(el.data) || el.data.length === 0) return null;
  const colors = (el as { colors?: Array<string | null> }).colors ?? [];
  const valid = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
  const pick = (i: number) => {
    const c = colors[i];
    return valid(c) ? c : (palette[i % palette.length] ?? OFFICE_PALETTE[0]!);
  };
  const extra = el as {
    barDir?: string;
    grouping?: string;
    marker?: boolean;
    holeSize?: string;
    style?: string;
  };

  const base = {
    kind,
    horizontal: kind === 'bar' && extra.barDir === 'bar',
    stacking:
      extra.grouping === 'percentStacked'
        ? ('percent' as const)
        : extra.grouping === 'stacked'
          ? ('stacked' as const)
          : ('none' as const),
    markers: kind === 'line' ? extra.marker !== false : kind === 'radar',
    hole:
      el.chartType === 'doughnutChart'
        ? Math.min(90, Math.max(10, Number(extra.holeSize) || 50)) / 100
        : 0,
    xs: [] as number[],
    scatterLines: false,
    pointColors: palette,
  };

  if (kind === 'scatter') {
    const [xs, ...ys] = el.data as number[][];
    if (!Array.isArray(xs) || ys.length === 0) return null;
    return {
      ...base,
      xs: xs.map(finite),
      categories: [],
      series: ys.map((values, i) => ({
        name: `Series ${i + 1}`,
        values: (values ?? []).map(finite),
        color: pick(i),
      })),
      scatterLines: /line/i.test(extra.style ?? ''),
    };
  }

  const raw = el.data as CategorySeries[];
  const labels = raw[0]?.xlabels ?? {};
  const count = Math.max(
    Object.keys(labels).length,
    ...raw.map((s) => Math.max(-1, ...(s.values ?? []).map((v) => Number(v.x))) + 1),
  );
  if (count <= 0) return null;
  const categories = Array.from({ length: count }, (_, i) => String(labels[i] ?? i + 1));
  const series = raw.map((s, i) => {
    const values = new Array<number>(count).fill(0);
    for (const v of s.values ?? []) {
      const x = Number(v.x);
      if (x >= 0 && x < count) values[x] = finite(v.y);
    }
    return { name: String(s.key ?? `Series ${i + 1}`), values, color: pick(i) };
  });
  return { ...base, categories, series };
}

/** "Nice" axis bounds and ticks. */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (min === max) {
    max = min === 0 ? 1 : min + Math.abs(min);
    if (min > 0) min = 0;
  }
  const span = max - min;
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  const count = Math.round((hi - lo) / step);
  // toPrecision strips float noise (0.6000000000000001 → 0.6).
  for (let i = 0; i <= count; i += 1) ticks.push(Number((lo + i * step).toPrecision(12)));
  return ticks;
}

const fmt = (n: number) =>
  Math.abs(n) >= 1e6
    ? `${+(n / 1e6).toFixed(1)}M`
    : Math.abs(n) >= 1e4
      ? `${+(n / 1e3).toFixed(1)}k`
      : String(+n.toFixed(2));

function Legend({
  items,
  width,
  y,
}: {
  items: Array<{ name: string; color: string }>;
  width: number;
  y: number;
}) {
  const widths = items.map((it) => 14 + Math.min(it.name.length, 18) * FONT * 0.55 + 12);
  const total = widths.reduce((a, b) => a + b, 0);
  let x = Math.max(4, (width - total) / 2);
  return (
    <g className="dsc-chart-legend">
      {items.map((it, i) => {
        const at = x;
        x += widths[i]!;
        return (
          <g key={i} transform={`translate(${at},${y})`}>
            <rect width={9} height={9} y={-8} fill={it.color} />
            <text x={13} fontSize={FONT} fill={TEXT}>
              {it.name.length > 18 ? `${it.name.slice(0, 17)}…` : it.name}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function PieChart({ m, w, h }: { m: ChartModel; w: number; h: number }) {
  const values = (m.series[0]?.values ?? []).map((v) => Math.max(0, v));
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const legendH = 22;
  const r = Math.max(4, Math.min(w, h - legendH) / 2 - 8);
  const cx = w / 2;
  const cy = (h - legendH) / 2;
  const colorAt = (i: number) => m.pointColors[i % m.pointColors.length] ?? OFFICE_PALETTE[0]!;
  let angle = -Math.PI / 2;
  const slices: ReactNode[] = [];
  values.forEach((v, i) => {
    const a = (v / total) * Math.PI * 2;
    const color = colorAt(i);
    if (a >= Math.PI * 2 - 1e-6) {
      slices.push(<circle key={i} cx={cx} cy={cy} r={r} fill={color} />);
    } else if (a > 0) {
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(angle + a);
      const y2 = cy + r * Math.sin(angle + a);
      slices.push(
        <path
          key={i}
          d={`M${cx},${cy}L${x1},${y1}A${r},${r} 0 ${a > Math.PI ? 1 : 0} 1 ${x2},${y2}Z`}
          fill={color}
          stroke="#fff"
          strokeWidth={1}
        >
          <title>{`${m.categories[i]}: ${fmt(v)} (${Math.round((v / total) * 100)}%)`}</title>
        </path>,
      );
    }
    angle += a;
  });
  return (
    <>
      {slices}
      {m.hole > 0 && <circle cx={cx} cy={cy} r={r * m.hole} fill="#fff" />}
      <Legend
        items={m.categories.map((name, i) => ({ name, color: colorAt(i) }))}
        width={w}
        y={h - 6}
      />
    </>
  );
}

function RadarChart({ m, w, h }: { m: ChartModel; w: number; h: number }) {
  const legendH = m.series.length > 1 ? 22 : 0;
  const r = Math.max(4, Math.min(w, h - legendH) / 2 - 22);
  const cx = w / 2;
  const cy = (h - legendH) / 2;
  const n = m.categories.length;
  const max = Math.max(...niceTicks(0, Math.max(0, ...m.series.flatMap((s) => s.values))));
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const rr = (Math.max(0, v) / (max || 1)) * r;
    return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)] as const;
  };
  return (
    <>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon
          key={f}
          points={m.categories.map((_, i) => pt(i, f * max).join(',')).join(' ')}
          fill="none"
          stroke={GRID}
        />
      ))}
      {m.categories.map((c, i) => {
        const [x, y] = pt(i, max * 1.12);
        return (
          <text key={i} x={x} y={y + 3} fontSize={FONT} fill={TEXT} textAnchor="middle">
            {c}
          </text>
        );
      })}
      {m.series.map((s, si) => (
        <g key={si}>
          <polygon
            points={s.values.map((v, i) => pt(i, v).join(',')).join(' ')}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
          />
          {s.values.map((v, i) => {
            const [x, y] = pt(i, v);
            return <circle key={i} cx={x} cy={y} r={2.5} fill={s.color} />;
          })}
        </g>
      ))}
      {legendH > 0 && <Legend items={m.series} width={w} y={h - 6} />}
    </>
  );
}

function CartesianChart({ m, w, h }: { m: ChartModel; w: number; h: number }) {
  const legendH = m.series.length > 1 ? 22 : 0;
  const scatter = m.kind === 'scatter';
  const stacked = m.stacking !== 'none' && m.kind !== 'scatter';
  const n = scatter ? m.xs.length : m.categories.length;

  // Values actually plotted (cumulative for stacked charts, % for percent-stacked).
  const plotted: number[][] = m.series.map((s) => s.values.slice());
  if (stacked) {
    for (let i = 0; i < n; i += 1) {
      const sum = m.series.reduce((a, s) => a + Math.abs(s.values[i] ?? 0), 0) || 1;
      let acc = 0;
      plotted.forEach((row, si) => {
        const v = m.series[si]!.values[i] ?? 0;
        acc += m.stacking === 'percent' ? (Math.abs(v) / sum) * 100 : v;
        row[i] = acc;
      });
    }
  }
  const all = plotted.flat();
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
  const vMin = ticks[0]!;
  const vMax = ticks[ticks.length - 1]!;
  const xTicks = scatter ? niceTicks(Math.min(...m.xs), Math.max(...m.xs)) : [];

  const valueLabelW = Math.max(...ticks.map((t) => fmt(t).length)) * FONT * 0.6 + 8;
  const catLabelW = m.horizontal
    ? Math.min(w * 0.3, Math.max(...m.categories.map((c) => c.length)) * FONT * 0.58 + 8)
    : 0;
  const left = m.horizontal ? catLabelW : valueLabelW;
  const top = 10;
  const right = 12;
  const bottom = 20 + legendH;
  const pw = Math.max(10, w - left - right);
  const ph = Math.max(10, h - top - bottom);

  const valuePos = (v: number) =>
    m.horizontal
      ? left + ((v - vMin) / (vMax - vMin || 1)) * pw
      : top + ph - ((v - vMin) / (vMax - vMin || 1)) * ph;
  const xMin = xTicks[0] ?? 0;
  const xMax = xTicks[xTicks.length - 1] ?? 1;
  const xPos = (x: number) => left + ((x - xMin) / (xMax - xMin || 1)) * pw;
  const band = (m.horizontal ? ph : pw) / Math.max(1, n);
  // Lines and areas put points at band centres (bars too), like Office does for line charts.
  // Office draws horizontal bar charts with the first category at the bottom.
  const slot = (i: number) => (m.horizontal ? n - 1 - i : i);
  const catPos = (i: number) => (m.horizontal ? top : left) + band * (slot(i) + 0.5);
  const zero = valuePos(Math.max(vMin, Math.min(vMax, 0)));

  const grid = ticks.map((t) => {
    const p = valuePos(t);
    return m.horizontal ? (
      <g key={t}>
        <line x1={p} x2={p} y1={top} y2={top + ph} stroke={GRID} />
        <text x={p} y={top + ph + 14} fontSize={FONT} fill={TEXT} textAnchor="middle">
          {fmt(t)}
          {m.stacking === 'percent' ? '%' : ''}
        </text>
      </g>
    ) : (
      <g key={t}>
        <line x1={left} x2={left + pw} y1={p} y2={p} stroke={GRID} />
        <text x={left - 6} y={p + 3} fontSize={FONT} fill={TEXT} textAnchor="end">
          {fmt(t)}
          {m.stacking === 'percent' ? '%' : ''}
        </text>
      </g>
    );
  });

  // Skip category labels when they would overlap.
  const maxLabels = Math.max(1, Math.floor(m.horizontal ? ph / (FONT + 4) : pw / 36));
  const every = Math.ceil(n / maxLabels);
  const catLabels = scatter
    ? xTicks.map((t) => (
        <text key={t} x={xPos(t)} y={top + ph + 14} fontSize={FONT} fill={TEXT} textAnchor="middle">
          {fmt(t)}
        </text>
      ))
    : m.categories.map((c, i) =>
        i % every !== 0 ? null : m.horizontal ? (
          <text key={i} x={left - 6} y={catPos(i) + 3} fontSize={FONT} fill={TEXT} textAnchor="end">
            {c}
          </text>
        ) : (
          <text
            key={i}
            x={catPos(i)}
            y={top + ph + 14}
            fontSize={FONT}
            fill={TEXT}
            textAnchor="middle"
          >
            {c}
          </text>
        ),
      );

  let marks: ReactNode;
  if (m.kind === 'bar') {
    const groups = stacked ? 1 : m.series.length;
    const inner = band * 0.7;
    const barW = inner / groups;
    marks = m.series.map((s, si) => (
      <g key={si} fill={s.color}>
        {s.values.map((v, i) => {
          const end = valuePos(plotted[si]![i]!);
          const start = stacked && si > 0 ? valuePos(plotted[si - 1]![i]!) : zero;
          const offset =
            (m.horizontal ? top : left) +
            band * slot(i) +
            (band - inner) / 2 +
            (stacked ? 0 : si * barW);
          const a = Math.min(start, end);
          const len = Math.abs(end - start);
          return (
            <rect
              key={i}
              {...(m.horizontal
                ? { x: a, y: offset, width: len, height: barW * 0.92 }
                : { x: offset, y: a, width: barW * 0.92, height: len })}
            >
              <title>{`${s.name} · ${m.categories[i]}: ${fmt(v)}`}</title>
            </rect>
          );
        })}
      </g>
    ));
  } else {
    const pointsOf = (si: number) =>
      plotted[si]!.map((v, i) => [scatter ? xPos(m.xs[i] ?? 0) : catPos(i), valuePos(v)] as const);
    marks = m.series.map((s, si) => {
      const pts = pointsOf(si);
      const line = pts.map(([x, y]) => `${x},${y}`).join(' ');
      const below =
        stacked && si > 0
          ? pointsOf(si - 1)
              .slice()
              .reverse()
          : [
              [pts[pts.length - 1]?.[0] ?? left, zero],
              [pts[0]?.[0] ?? left, zero],
            ];
      return (
        <g key={si}>
          {m.kind === 'area' && (
            <polygon
              points={`${line} ${below.map(([x, y]) => `${x},${y}`).join(' ')}`}
              fill={s.color}
              fillOpacity={stacked ? 0.9 : 0.6}
            />
          )}
          {(m.kind === 'line' || (scatter && m.scatterLines)) && (
            <polyline
              points={line}
              fill="none"
              stroke={s.color}
              strokeWidth={2.25}
              strokeLinejoin="round"
            />
          )}
          {(m.markers || scatter) &&
            pts.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={3} fill={s.color}>
                <title>{`${s.name}: ${fmt(s.values[i] ?? 0)}`}</title>
              </circle>
            ))}
        </g>
      );
    });
  }

  return (
    <>
      {grid}
      {m.horizontal ? (
        <line x1={zero} x2={zero} y1={top} y2={top + ph} stroke="#BFBFBF" />
      ) : (
        <line x1={left} x2={left + pw} y1={zero} y2={zero} stroke="#BFBFBF" />
      )}
      {marks}
      {catLabels}
      {legendH > 0 && <Legend items={m.series} width={w} y={h - 6} />}
    </>
  );
}

const TYPE_NAMES: Record<ChartModel['kind'], string> = {
  bar: 'Bar chart',
  line: 'Line chart',
  area: 'Area chart',
  pie: 'Pie chart',
  scatter: 'Scatter chart',
  radar: 'Radar chart',
};

/** SVG rendering of a slide chart from its cached values (read-only). */
export function SlideChart({ el, style }: { el: PptxElement; style: CSSProperties }) {
  const palette = useContext(ChartPaletteContext);
  const m = toChartModel(el, palette.length ? palette : OFFICE_PALETTE);
  if (!m) {
    return (
      <div className="dsc-slide-el dsc-slide-placeholder" style={style}>
        Chart ({el.chartType ?? 'chart'}) — not rendered in preview
      </div>
    );
  }
  const w = Math.max(20, el.width);
  const h = Math.max(20, el.height);
  const label = `${TYPE_NAMES[m.kind]}: ${(m.kind === 'pie' ? m.categories : m.series.map((s) => s.name)).join(', ')}`;
  return (
    <svg
      className="dsc-slide-el dsc-slide-chart"
      style={style}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={label}
      fontFamily="Calibri, Carlito, Arial, sans-serif"
    >
      {m.kind === 'pie' ? (
        <PieChart m={m} w={w} h={h} />
      ) : m.kind === 'radar' ? (
        <RadarChart m={m} w={w} h={h} />
      ) : (
        <CartesianChart m={m} w={w} h={h} />
      )}
    </svg>
  );
}
