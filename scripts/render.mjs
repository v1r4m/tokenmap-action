#!/usr/bin/env node
// Renders data/history.json into assets/heatmap.svg and injects it into README.md.
// Pure function of the committed JSON — safe to run anywhere, including CI.
//
//   METRIC=total|billable|output|messages   heatmap intensity (default: total)
//   WEEKS=53                                columns to render (default: 53)

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HISTORY = path.join(ROOT, "data", "history.json");
const SVG_OUT = path.join(ROOT, "assets", "heatmap.svg");
const README = path.join(ROOT, "README.md");

const START_MARKER = "<!-- CLAUDE-HEATMAP:START -->";
const END_MARKER = "<!-- CLAUDE-HEATMAP:END -->";

const METRIC = process.env.METRIC || "total";
const WEEKS = Number(process.env.WEEKS || 53);

const CELL = 11;
const GAP = 3;
const STEP = CELL + GAP;
const MARGIN_LEFT = 30;
const MARGIN_TOP = 34;
const MARGIN_RIGHT = 8;
const LEGEND_H = 26;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_LABELS = { 1: "Mon", 3: "Wed", 5: "Fri" };

/** Intensity for one day's bucket, per the selected metric. */
function value(day) {
  if (!day) return 0;
  switch (METRIC) {
    case "billable":
      return day.input + day.output + day.cache_creation;
    case "output":
      return day.output;
    case "messages":
      return day.messages;
    default:
      return day.total;
  }
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);

const iso = (d) => d.toLocaleDateString("en-CA");

function compact(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

/**
 * Quartile thresholds over the non-empty values, so the scale adapts to the
 * data instead of to an arbitrary constant. Returns 4 ascending cutoffs.
 */
function thresholds(values) {
  const nonzero = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (nonzero.length === 0) return [1, 2, 3, 4];
  const at = (q) => nonzero[Math.min(nonzero.length - 1, Math.floor(nonzero.length * q))];
  return [at(0.25), at(0.5), at(0.75), at(0.9)];
}

function level(v, cuts) {
  if (v <= 0) return 0;
  if (v <= cuts[0]) return 1;
  if (v <= cuts[1]) return 2;
  if (v <= cuts[2]) return 3;
  return 4;
}

function buildSvg(history) {
  const days = history.days ?? {};

  // A rolling window ending today, aligned so each column is one Sun–Sat week.
  // Snap to the current week's Sunday first so the window is exactly WEEKS wide;
  // going back N days and *then* snapping would overflow into an extra column.
  const end = new Date();
  end.setHours(12, 0, 0, 0);
  const start = new Date(end);
  start.setDate(end.getDate() - end.getDay() - (WEEKS - 1) * 7);

  const cells = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const key = iso(cursor);
    cells.push({ key, day: days[key], date: new Date(cursor) });
    cursor.setDate(cursor.getDate() + 1);
  }

  const cuts = thresholds(cells.map((c) => value(c.day)));
  const cols = Math.ceil(cells.length / 7);

  const gridW = cols * STEP - GAP;
  const width = MARGIN_LEFT + gridW + MARGIN_RIGHT;
  const height = MARGIN_TOP + 7 * STEP - GAP + LEGEND_H;

  const parts = [];

  // Month labels — drawn at the first column whose week introduces a new month.
  let lastMonth = -1;
  for (let col = 0; col < cols; col++) {
    const cell = cells[col * 7];
    if (!cell) continue;
    const m = cell.date.getMonth();
    if (m !== lastMonth) {
      lastMonth = m;
      const x = MARGIN_LEFT + col * STEP;
      if (x + 24 <= MARGIN_LEFT + gridW) {
        parts.push(`<text class="lbl" x="${x}" y="${MARGIN_TOP - 6}">${MONTHS[m]}</text>`);
      }
    }
  }

  for (const [row, label] of Object.entries(DAY_LABELS)) {
    const y = MARGIN_TOP + Number(row) * STEP + CELL - 2;
    parts.push(`<text class="lbl" x="0" y="${y}">${label}</text>`);
  }

  cells.forEach((cell, i) => {
    const col = Math.floor(i / 7);
    const row = i % 7;
    const x = MARGIN_LEFT + col * STEP;
    const y = MARGIN_TOP + row * STEP;
    const v = value(cell.day);
    const lv = level(v, cuts);
    const tip = v > 0 ? `${compact(v)} on ${cell.key}` : `No activity on ${cell.key}`;
    parts.push(
      `<rect class="c${lv}" x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2">` +
        `<title>${esc(tip)}</title></rect>`,
    );
  });

  // Legend, right-aligned under the grid.
  const legendY = MARGIN_TOP + 7 * STEP - GAP + 14;
  const legendW = 5 * STEP - GAP;
  const legendX = MARGIN_LEFT + gridW - legendW - 34;
  parts.push(`<text class="lbl" x="${legendX - 30}" y="${legendY + CELL - 2}">Less</text>`);
  for (let l = 0; l <= 4; l++) {
    parts.push(
      `<rect class="c${l}" x="${legendX + l * STEP}" y="${legendY}" width="${CELL}" height="${CELL}" rx="2"/>`,
    );
  }
  parts.push(`<text class="lbl" x="${legendX + legendW + 6}" y="${legendY + CELL - 2}">More</text>`);

  const windowTotal = cells.reduce((sum, c) => sum + value(c.day), 0);
  const activeDays = cells.filter((c) => value(c.day) > 0).length;
  const unit = METRIC === "messages" ? "messages" : "tokens";
  const title = `${compact(windowTotal)} ${unit} across ${activeDays} active days`;
  parts.unshift(`<text class="title" x="0" y="14">${esc(title)}</text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">
<style>
  :root {
    --fg: #57606a; --title: #1f2328;
    --c0: #ebedf0; --c1: #9be9a8; --c2: #40c463; --c3: #30a14e; --c4: #216e39;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --fg: #8b949e; --title: #e6edf3;
      --c0: #161b22; --c1: #0e4429; --c2: #006d32; --c3: #26a641; --c4: #39d353;
    }
  }
  .lbl { font: 9px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; fill: var(--fg); }
  .title { font: 600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; fill: var(--title); }
  .c0 { fill: var(--c0); } .c1 { fill: var(--c1); } .c2 { fill: var(--c2); }
  .c3 { fill: var(--c3); } .c4 { fill: var(--c4); }
</style>
${parts.join("\n")}
</svg>
`;
}

function badge(history) {
  const when = new Date(history.generated_at);
  const tz = history.timezone || "UTC";
  const stamp = when
    .toLocaleString("sv-SE", { timeZone: tz, dateStyle: "short", timeStyle: "short" })
    .replace(" ", " ");
  const label = encodeURIComponent(`${stamp}`).replace(/-/g, "--").replace(/_/g, "__");
  return `![Updated](https://img.shields.io/badge/updated-${label}-2ea043?style=flat-square)`;
}

async function main() {
  let history;
  try {
    history = JSON.parse(await readFile(HISTORY, "utf8"));
  } catch {
    console.error(`Missing or unreadable ${path.relative(ROOT, HISTORY)} — run scripts/sync.mjs first.`);
    process.exit(1);
  }

  const svg = buildSvg(history);
  await mkdir(path.dirname(SVG_OUT), { recursive: true });
  await writeFile(SVG_OUT, svg);

  const section = [
    START_MARKER,
    "",
    badge(history),
    "",
    `<img src="assets/heatmap.svg" alt="Claude Code usage heatmap" width="100%">`,
    "",
    END_MARKER,
  ].join("\n");

  const readme = await readFile(README, "utf8");
  const startAt = readme.indexOf(START_MARKER);
  const endAt = readme.indexOf(END_MARKER);
  if (startAt === -1 || endAt === -1) {
    console.error(`README.md is missing ${START_MARKER} / ${END_MARKER} markers.`);
    process.exit(1);
  }
  const next = readme.slice(0, startAt) + section + readme.slice(endAt + END_MARKER.length);
  await writeFile(README, next);

  console.log(`Wrote ${path.relative(ROOT, SVG_OUT)} (metric=${METRIC}, ${WEEKS} weeks)`);
  console.log("Updated README.md");
}

await main();
