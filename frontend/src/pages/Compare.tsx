/**
 * Snapshot comparison + Top-N movement.
 *
 * Two pages merged, because they answer one question — what moved between two
 * periods — and they were both driven by the same pair of snapshot codes.
 *
 * NOTHING NAMES A QUARTER. The table headers, the chart series names and the
 * page title all come from the resolved period. Load a
 * Q3 register and this page compares Q2 with Q3 the moment the picker changes.
 */

import { Fragment, useMemo, useState } from "react";

import {
  fmt, useCompare, useTop,
  type CompareRow, type TopBasis, type TopBU,
} from "../api";
import { PageHead } from "../App";
import { Bars, SlopeChart, StatusLegend } from "../charts";
import {
  Empty, Kpi, Loading, Panel, PrintSection, Problem, Select, WhenReady,
  usePeriod, type CompareMode,
} from "../ui";

export default function ComparePage() {
  return <WhenReady><Body /></WhenReady>;
}

const METRICS = [
  { key: "total", label: "Initiatives" },
  { key: "in_execution", label: "In execution" },
  { key: "prioritized", label: "Prioritized" },
  { key: "value_musd", label: "Value ($M)" },
] as const;

/* Counts and $M can't share an axis -- the movement chart splits them. */
const COUNT_SERIES = METRICS.filter((m) => m.key !== "value_musd").map((m) => ({ key: m.label }));
const VALUE_SERIES = METRICS.filter((m) => m.key === "value_musd").map((m) => ({ key: m.label }));
const signedInt = (v: number) => `${v > 0 ? "+" : ""}${fmt.int(v)}`;
const signedMusd = (v: number) => fmt.delta(v, "M");

/* What the Top-N ranks and sums: CY target, or CY realized. */
const BASIS_LABEL: Record<TopBasis, string> = { target: "Target", actual: "Actual" };
const BASIS_OPTIONS = (Object.keys(BASIS_LABEL) as TopBasis[])
  .map((value) => ({ value, label: BASIS_LABEL[value] }));

const MODE_LABEL: Record<CompareMode, string> = {
  sequential: "Sequential", yoy: "Year-over-year", plan: "Vs. plan", custom: "Custom",
};
const MODE_OPTIONS = (Object.keys(MODE_LABEL) as CompareMode[])
  .map((value) => ({ value, label: MODE_LABEL[value] }));

function periodKeyOf(fy: number, pt: string, ord: number | null): string {
  if (pt === "FY") return `${fy}-FY`;
  if (pt === "M") return `${fy}-M${String(ord ?? 0).padStart(2, "0")}`;
  return `${fy}-${pt}${ord ?? ""}`;
}

/** Names the period a resolved-but-empty baseline would have needed, per mode. */
function missingBaselineHint(mode: CompareMode, snapshotId: string | undefined,
                             options: ReturnType<typeof usePeriod>["options"]): string {
  const target = options?.snapshots.find((s) => s.id === snapshotId);
  if (!target) return "Pick a baseline to compare against.";
  if (mode === "yoy") {
    const key = periodKeyOf(target.fiscal_year - 1, target.period_type, target.period_ordinal);
    return `No ${key} snapshot to compare against.`;
  }
  if (mode === "sequential") {
    return `No earlier ${target.period_type} snapshot to compare against.`;
  }
  if (mode === "plan") {
    return `No plan baseline pinned for fiscal year ${target.fiscal_year}.`;
  }
  return "Pick a baseline to compare against.";
}

function Body() {
  const { snapshot, baseline, label, mode, setMode, options } = usePeriod();
  const [limit, setLimit] = useState(10);
  const [basis, setBasis] = useState<TopBasis>("target");

  const compare = useCompare(baseline, snapshot);
  const top = useTop(baseline, snapshot, limit, basis);

  // Computed before any early return: hooks may not be conditional.
  const movementData = useMemo(() =>
    (compare.data?.rows ?? []).map((r) => ({
      bu: r.bu_label,
      Initiatives: r.delta.total,
      "In execution": r.delta.in_execution,
      Prioritized: r.delta.prioritized,
      "Value ($M)": r.delta.value_musd,
    })), [compare.data]);

  const modePicker = (
    <Select label="Mode" value={mode} onChange={(v) => setMode(v as CompareMode)}
      options={MODE_OPTIONS} />
  );

  if (!baseline) {
    return (
      <>
        <PageHead title="Comparison" compare>{modePicker}</PageHead>
        <Empty>{missingBaselineHint(mode, snapshot, options)}</Empty>
      </>
    );
  }
  if (compare.error) return <Problem error={compare.error} />;

  const a = baseline;
  const b = snapshot!;
  const t = compare.data?.totals;
  const basisWord = basis === "actual" ? "realized" : "target";

  return (
    <>
      <PageHead title={`${label(a)} vs ${label(b)} · ${MODE_LABEL[mode]}`} compare
        blurb={`${label(a)} compared with ${label(b)}.`}>
        {modePicker}
      </PageHead>

      <PrintSection id="cmp-kpis" label="Headline deltas">
        <div className="kpirow">
          {METRICS.map((m) => {
            const av = t ? (t.a as any)[m.key] : null;
            const bv = t ? (t.b as any)[m.key] : null;
            const dv = t ? (t.delta as any)[m.key] : null;
            return (
              <Kpi key={m.key} label={m.label}
                value={m.key === "value_musd" ? fmt.musd(bv) : fmt.int(bv)}
                tone={dv > 0 ? "good" : dv < 0 ? "bad" : undefined}
                sub={`${label(a)}: ${m.key === "value_musd" ? fmt.musd(av) : fmt.int(av)} · Δ ${fmt.delta(dv)}`} />
            );
          })}
        </div>
      </PrintSection>

      <PrintSection id="cmp-table" label={`${label(a)} vs ${label(b)} by BU`}>
        <Panel title="By business unit">
          {!compare.data ? <Loading what="the comparison" /> : (
            <div className="tablewrap">
              <table className="grid compare">
                <thead>
                  <tr>
                    <th rowSpan={2}>Business unit</th>
                    {METRICS.map((m) => <th key={m.key} colSpan={3}>{m.label}</th>)}
                  </tr>
                  <tr>
                    {METRICS.map((m) => (
                      <Fragment key={m.key}>
                        <th className="sub">{label(a)}</th>
                        <th className="sub">{label(b)}</th>
                        <th className="sub">Δ</th>
                      </Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {compare.data.rows.map((r) => (
                    <Row key={r.bu_code} row={r} />
                  ))}
                </tbody>
                <tfoot>
                  <Row row={compare.data.totals} />
                </tfoot>
              </table>
              {compare.data.unmatched_count > 0 && (
                <p className="muted sm">
                  {compare.data.unmatched_count} business unit(s) unmatched across
                  periods and excluded from the delta.
                </p>
              )}
            </div>
          )}
        </Panel>
      </PrintSection>

      <div className="grid2">
        <PrintSection id="cmp-bars-count" label="Count movement by BU">
          <Panel title={`Initiative count change, ${label(a)} → ${label(b)}`}>
            <Bars data={movementData} xKey="bu" series={COUNT_SERIES}
              valueFormat={signedInt} signed />
          </Panel>
        </PrintSection>
        <PrintSection id="cmp-bars-value" label="Value movement by BU">
          <Panel title={`Value change ($M), ${label(a)} → ${label(b)}`}>
            <Bars data={movementData} xKey="bu" series={VALUE_SERIES}
              valueFormat={signedMusd} signed />
          </Panel>
        </PrintSection>
      </div>

      <PrintSection id="cmp-top" label={`Top-${limit} movement`}>
        <Panel title={`Top-${limit} movement by BU · ${BASIS_LABEL[basis]} vs ${BASIS_LABEL[basis]}`}
          actions={
            <>
              <Select label="Basis" value={basis}
                onChange={(v) => setBasis(v as TopBasis)} options={BASIS_OPTIONS} />
              <Select label="Top N" value={String(limit)}
                onChange={(v) => setLimit(Number(v))}
                options={[5, 10, 15, 20].map((n) => ({ value: String(n), label: `Top ${n}` }))} />
            </>
          }>
          {!top.data ? <Loading what="movement" /> : (
            <>
              <div className="kpirow tight">
                <Kpi label={`${label(a)} top-${limit} ${basisWord} value`} value={fmt.musd(top.data.totals.a_total_musd)} />
                <Kpi label={`${label(b)} top-${limit} ${basisWord} value`} value={fmt.musd(top.data.totals.b_total_musd)}
                  tone={top.data.totals.delta_musd >= 0 ? "good" : "bad"}
                  sub={`Δ ${fmt.delta(top.data.totals.delta_musd, "M")}`} />
                <Kpi label="Carried" value={fmt.int(top.data.totals.carried)} />
                <Kpi label="New" value={fmt.int(top.data.totals.new)} tone="good" />
                <Kpi label="Fell out" value={fmt.int(top.data.totals.fell_out)} tone="warn" />
                <Kpi label="Discontinued" value={fmt.int(top.data.totals.discontinued)} tone="bad" />
              </div>
              <StatusLegend />
              {/* One slope panel per row: endpoint labels need the full width. */}
              <div className="slope-rows">
                {top.data.business_units.map((bu) => (
                  <BuSlope key={bu.bu_code} bu={bu} a={label(a)} b={label(b)} />
                ))}
              </div>
            </>
          )}
        </Panel>
      </PrintSection>
    </>
  );
}

function Row({ row }: { row: CompareRow }) {
  const cell = (v: number, key: string) =>
    key === "value_musd" ? fmt.musd(v) : fmt.int(v);
  const unmatched = !(row.a_present && row.b_present);
  const status = unmatched ? (row.a_present ? "fell_out" : "new") : null;

  return (
    <tr className={row.bu_code === "TOTAL" ? "total" : undefined}>
      <th>
        {row.bu_label}
        {status && (
          <i className={`pill sm ${status === "new" ? "good" : "warn"}`}
            title="Not present on both sides">
            {status === "new" ? "new" : "unmatched"}
          </i>
        )}
      </th>
      {METRICS.map((m) => (
        <Fragment key={m.key}>
          <td>{row.a_present ? cell((row.a as any)[m.key], m.key) : "—"}</td>
          <td>{row.b_present ? cell((row.b as any)[m.key], m.key) : "—"}</td>
          {unmatched ? <td className="muted">—</td> : (
            <td className={(row.delta as any)[m.key] > 0 ? "good"
              : (row.delta as any)[m.key] < 0 ? "bad" : "muted"}>
              {fmt.delta((row.delta as any)[m.key])}
            </td>
          )}
        </Fragment>
      ))}
    </tr>
  );
}

function BuSlope({ bu, a, b }: { bu: TopBU; a: string; b: string }) {
  const counts: { key: string; label: string; tone: string }[] = [
    { key: "carried", label: "carried", tone: "accent" },
    { key: "new", label: "new", tone: "good" },
    { key: "fell_out", label: "fell out", tone: "warn" },
    { key: "discontinued", label: "discontinued", tone: "bad" },
  ];
  return (
    <Panel className="slope wide"
      title={<>{bu.bu_label}{" "}
        <span className="muted sm">
          {fmt.musd(bu.a_total_musd)} → {fmt.musd(bu.b_total_musd)}{" "}
          ({fmt.delta(bu.delta_musd, "M")})
        </span></>}>
      <p className="muted sm">
        {counts.filter((c) => bu.counts[c.key]).map((c, i) => (
          <Fragment key={c.key}>
            {i > 0 && " · "}
            <b className={c.tone}>{fmt.int(bu.counts[c.key])} {c.label}</b>
          </Fragment>
        ))}
      </p>
      {bu.a_items.length || bu.b_items.length
        ? (
          <div className="slopewrap">
            <SlopeChart aItems={bu.a_items} bItems={bu.b_items}
              movements={bu.movements} labelA={a} labelB={b} />
          </div>
        )
        : <Empty>No ranked initiatives.</Empty>}
      {bu.note && <p className="muted sm">{bu.note}</p>}
    </Panel>
  );
}
