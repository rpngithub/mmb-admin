import { useEffect, useMemo, useRef, useState } from 'react';
import { Typography } from 'antd';
import dayjs from 'dayjs';
import { OTHER_COLOR, SERIES_COLORS, fmtNum, toNum } from '../../lib/dashboard';

/**
 * Small dependency-free SVG charts for the dashboard widgets (the repo has no
 * chart library). Thin marks, rounded data-ends on the baseline, a 2px surface
 * gap between stacked fills, recessive grid, and a hover tooltip on every plot.
 * Colours are passed in per entity so a series keeps its colour across views.
 */

const { Text } = Typography;

const INK = 'rgba(0,0,0,0.88)';
const INK_MUTED = 'rgba(0,0,0,0.45)';
const GRID = 'rgba(5,5,5,0.08)';
const SURFACE = '#ffffff';

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Round a max up to 1/2/2.5/5 × 10^n so the gridlines land on clean values. */
function niceMax(v) {
  if (!(v > 0)) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return step * exp;
}

/** A bar whose top corners are rounded (the data-end) and base is square. */
function topRoundedRect(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return [
    `M${x},${y + h}`,
    `V${y + rr}`,
    `Q${x},${y} ${x + rr},${y}`,
    `H${x + w - rr}`,
    `Q${x + w},${y} ${x + w},${y + rr}`,
    `V${y + h}`,
    'Z',
  ].join(' ');
}

const bucketLabel = (date, granularity) => {
  const d = dayjs(date);
  if (!d.isValid()) return String(date ?? '');
  if (granularity === 'month') return d.format('MMM YY');
  return d.format('D MMM');
};

const bucketTitle = (date, granularity) => {
  const d = dayjs(date);
  if (!d.isValid()) return String(date ?? '');
  if (granularity === 'month') return d.format('MMMM YYYY');
  if (granularity === 'week') return `Week of ${d.format('D MMM YYYY')}`;
  return d.format('ddd, D MMM YYYY');
};

/**
 * Time series as a line or a column chart.
 *   series: [{ key, label, color, value: (point) => number }]
 *   mode 'column' with several series stacks them; mode 'line' draws one line each.
 */
export function TrendChart({
  points = [],
  series = [],
  mode = 'line',
  granularity = 'day',
  formatValue = fmtNum,
  formatAxis = formatValue,
  height = 220,
}) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);

  const M = { top: 12, right: 12, bottom: 26, left: 60 };
  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = height - M.top - M.bottom;
  const n = points.length;
  const stacked = mode === 'column' && series.length > 1;

  const values = useMemo(
    () => points.map((p) => series.map((s) => Math.max(0, toNum(s.value(p)) ?? 0))),
    [points, series],
  );
  const yMax = useMemo(() => {
    let m = 0;
    for (const row of values) {
      m = Math.max(m, stacked ? row.reduce((a, b) => a + b, 0) : Math.max(0, ...row));
    }
    return niceMax(m);
  }, [values, stacked]);

  if (n === 0) {
    return (
      <div ref={ref} style={{ height, display: 'grid', placeItems: 'center' }}>
        <Text type="secondary">No data in this range</Text>
      </div>
    );
  }

  const band = innerW / n;
  const y = (v) => M.top + innerH - (v / yMax) * innerH;
  const cx = (i) => M.left + band * i + band / 2;
  const barW = Math.max(1, Math.min(28, band * 0.7));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * yMax);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(innerW / 64))));

  const tip = hover !== null ? { point: points[hover], row: values[hover], i: hover } : null;
  const tipLeft = tip ? cx(tip.i) : 0;
  const flip = tip && tipLeft > width * 0.6;

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" style={{ display: 'block' }}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke={GRID} />
              <text
                x={M.left - 8}
                y={y(t)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={11}
                fill={INK_MUTED}
              >
                {formatAxis(t)}
              </text>
            </g>
          ))}

          {points.map((p, i) =>
            i % labelEvery === 0 ? (
              <text
                key={`x${i}`}
                x={cx(i)}
                y={height - 8}
                textAnchor="middle"
                fontSize={11}
                fill={INK_MUTED}
              >
                {bucketLabel(p.date, granularity)}
              </text>
            ) : null,
          )}

          {hover !== null && mode === 'column' && (
            <rect
              x={M.left + band * hover}
              y={M.top}
              width={band}
              height={innerH}
              fill="rgba(0,0,0,0.04)"
            />
          )}

          {mode === 'column' &&
            values.map((row, i) => {
              let base = 0;
              const last = row.reduce((acc, v, si) => (v > 0 ? si : acc), -1);
              return (
                <g key={`c${i}`}>
                  {row.map((v, si) => {
                    if (v <= 0) return null;
                    const below = stacked ? base : 0;
                    const y0 = y(below);
                    const y1 = y(below + v);
                    if (stacked) base += v;
                    // 2px surface gap where a segment sits on another segment.
                    const h = Math.max(0, y0 - y1 - (below > 0 ? 2 : 0));
                    const x = cx(i) - barW / 2;
                    return si === last || !stacked ? (
                      <path
                        key={series[si].key}
                        d={topRoundedRect(x, y1, barW, h, 4)}
                        fill={series[si].color}
                      />
                    ) : (
                      <rect
                        key={series[si].key}
                        x={x}
                        y={y1}
                        width={barW}
                        height={h}
                        fill={series[si].color}
                      />
                    );
                  })}
                </g>
              );
            })}

          {mode === 'line' &&
            series.map((s, si) => {
              const d = values
                .map((row, i) => `${i === 0 ? 'M' : 'L'}${cx(i)},${y(row[si])}`)
                .join(' ');
              return (
                <g key={s.key}>
                  <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
                  {n === 1 && <circle cx={cx(0)} cy={y(values[0][si])} r={4} fill={s.color} />}
                </g>
              );
            })}

          {hover !== null && mode === 'line' && (
            <g>
              <line
                x1={cx(hover)}
                x2={cx(hover)}
                y1={M.top}
                y2={M.top + innerH}
                stroke={INK_MUTED}
                strokeDasharray="3 3"
              />
              {series.map((s, si) => (
                <circle
                  key={s.key}
                  cx={cx(hover)}
                  cy={y(values[hover][si])}
                  r={4}
                  fill={s.color}
                  stroke={SURFACE}
                  strokeWidth={2}
                />
              ))}
            </g>
          )}

          <line
            x1={M.left}
            x2={width - M.right}
            y1={M.top + innerH}
            y2={M.top + innerH}
            stroke="rgba(5,5,5,0.25)"
          />

          {/* Hit targets: whole column bands, wider than any mark. */}
          {points.map((_p, i) => (
            <rect
              key={`h${i}`}
              x={M.left + band * i}
              y={M.top}
              width={band}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? null : h))}
            />
          ))}
        </svg>
      )}

      {tip && (
        <div
          style={{
            position: 'absolute',
            top: M.top,
            left: flip ? undefined : tipLeft + 12,
            right: flip ? width - tipLeft + 12 : undefined,
            background: SURFACE,
            border: '1px solid rgba(5,5,5,0.12)',
            borderRadius: 6,
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            padding: '6px 10px',
            fontSize: 12,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 2,
          }}
        >
          <div style={{ color: INK, fontWeight: 600, marginBottom: 2 }}>
            {bucketTitle(tip.point.date, granularity)}
          </div>
          {series.map((s, si) => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
              <span style={{ color: INK_MUTED }}>{s.label}</span>
              <span style={{ color: INK, marginLeft: 'auto', paddingLeft: 12 }}>
                {formatValue(tip.row[si])}
              </span>
            </div>
          ))}
          {series.length > 1 && (
            <div style={{ display: 'flex', borderTop: `1px solid ${GRID}`, marginTop: 4, paddingTop: 4 }}>
              <span style={{ color: INK_MUTED }}>Total</span>
              <span style={{ color: INK, marginLeft: 'auto', paddingLeft: 12, fontWeight: 600 }}>
                {formatValue(tip.row.reduce((a, b) => a + b, 0))}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Legend for ≥ 2 series (a single series is named by the card title). */
export function Legend({ items }) {
  if (!items || items.length < 2) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 12 }}>
      {items.map((it) => (
        <span key={it.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: it.color }} />
          <span style={{ color: INK_MUTED }}>{it.label}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * Donut with a legend table beside it (the legend doubles as the table view).
 *   items: [{ key, label, value, color? }] — entries past the palette fold into "Other".
 */
export function Donut({ items = [], size = 150, thickness = 22, centerLabel = 'Total', formatValue = fmtNum }) {
  const [active, setActive] = useState(null);

  const slices = useMemo(() => {
    const clean = items
      .map((it) => ({ ...it, value: Math.max(0, toNum(it.value) ?? 0) }))
      .filter((it) => it.value > 0 || it.keep);
    const head = clean.slice(0, SERIES_COLORS.length);
    const tail = clean.slice(SERIES_COLORS.length);
    const out = head.map((it, i) => ({ ...it, color: it.color || SERIES_COLORS[i] }));
    if (tail.length) {
      out.push({
        key: '__other',
        label: `Other (${tail.length})`,
        value: tail.reduce((a, b) => a + b.value, 0),
        color: OTHER_COLOR,
      });
    }
    return out;
  }, [items]);

  const total = slices.reduce((a, b) => a + b.value, 0);
  const r = size / 2 - 2;
  const ri = r - thickness;
  const c = size / 2;

  const arcs = [];
  let angle = -Math.PI / 2;
  for (const s of slices) {
    if (total <= 0 || s.value <= 0) continue;
    const sweep = (s.value / total) * Math.PI * 2;
    const a0 = angle;
    const a1 = angle + sweep;
    angle = a1;
    if (sweep >= Math.PI * 2 - 1e-6) {
      arcs.push({ s, full: true });
      continue;
    }
    const large = sweep > Math.PI ? 1 : 0;
    const p = (rad, a) => `${c + rad * Math.cos(a)},${c + rad * Math.sin(a)}`;
    arcs.push({
      s,
      d: `M${p(r, a0)} A${r},${r} 0 ${large} 1 ${p(r, a1)} L${p(ri, a1)} A${ri},${ri} 0 ${large} 0 ${p(ri, a0)} Z`,
    });
  }

  const shown = active ? slices.find((s) => s.key === active) : null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
      <svg width={size} height={size} role="img" style={{ flex: 'none' }}>
        {total <= 0 ? (
          <circle cx={c} cy={c} r={(r + ri) / 2} fill="none" stroke={GRID} strokeWidth={thickness} />
        ) : (
          arcs.map(({ s, d, full }) =>
            full ? (
              <circle
                key={s.key}
                cx={c}
                cy={c}
                r={(r + ri) / 2}
                fill="none"
                stroke={s.color}
                strokeWidth={thickness}
                onMouseEnter={() => setActive(s.key)}
                onMouseLeave={() => setActive(null)}
              />
            ) : (
              <path
                key={s.key}
                d={d}
                fill={s.color}
                stroke={SURFACE}
                strokeWidth={2}
                opacity={active && active !== s.key ? 0.45 : 1}
                onMouseEnter={() => setActive(s.key)}
                onMouseLeave={() => setActive(null)}
              />
            ),
          )
        )}
        <text x={c} y={c - 6} textAnchor="middle" fontSize={18} fontWeight={600} fill={INK}>
          {formatValue(shown ? shown.value : total)}
        </text>
        <text x={c} y={c + 14} textAnchor="middle" fontSize={11} fill={INK_MUTED}>
          {shown ? shown.label : centerLabel}
        </text>
      </svg>

      <div style={{ flex: 1, minWidth: 160, fontSize: 13 }}>
        {slices.length === 0 && <Text type="secondary">No data</Text>}
        {slices.map((s) => (
          <div
            key={s.key}
            onMouseEnter={() => setActive(s.key)}
            onMouseLeave={() => setActive(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '3px 4px',
              borderRadius: 4,
              background: active === s.key ? 'rgba(0,0,0,0.04)' : undefined,
            }}
          >
            <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flex: 'none' }} />
            <span style={{ color: INK }}>{s.label}</span>
            <span style={{ marginLeft: 'auto', color: INK }}>{formatValue(s.value)}</span>
            <span style={{ width: 48, textAlign: 'right', color: INK_MUTED }}>
              {total > 0 ? `${Math.round((s.value / total) * 100)}%` : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Horizontal bars, one row per item, scaled to the largest value.
 *   rows: [{ key, label, value, extra? (node, right-aligned), danger? }]
 */
export function HBars({ rows = [], formatValue = fmtNum, color = SERIES_COLORS[0], labelWidth = 120 }) {
  const max = Math.max(0, ...rows.map((r) => toNum(r.value) ?? 0));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((r) => {
        const v = toNum(r.value) ?? 0;
        const pct = max > 0 ? (v / max) * 100 : 0;
        return (
          <div
            key={r.key}
            title={`${r.label}: ${formatValue(r.value)}`}
            style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}
          >
            <span
              style={{
                width: labelWidth,
                flex: 'none',
                color: INK,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {r.label}
            </span>
            <div style={{ flex: 1, height: 14, background: 'rgba(0,0,0,0.04)', borderRadius: 4 }}>
              <div
                style={{
                  width: `${pct}%`,
                  minWidth: v > 0 ? 2 : 0,
                  height: '100%',
                  background: r.color || color,
                  borderRadius: 4,
                }}
              />
            </div>
            <span style={{ width: 56, textAlign: 'right', color: INK }}>{formatValue(r.value)}</span>
            {r.extra !== undefined && (
              <span style={{ minWidth: 64, textAlign: 'right', color: INK_MUTED, fontSize: 12 }}>
                {r.extra}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
