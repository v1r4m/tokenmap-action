#!/usr/bin/env node
// Reads Claude Code session transcripts from ~/.claude/projects/**/*.jsonl and
// aggregates per-day token usage into data/history.json.
//
// Must run on the machine that has the transcripts — the data is local-only.
//
//   CLAUDE_DIR   override the Claude data directory (default: $CLAUDE_CONFIG_DIR or ~/.claude)
//   TZ           bucket days in this timezone (default: system local time)

import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HISTORY = path.join(ROOT, "data", "history.json");

const CLAUDE_DIR =
  process.env.CLAUDE_DIR || process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), ".claude");

/** Recursively collect *.jsonl transcripts under a directory. */
async function findTranscripts(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await findTranscripts(full)));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(full);
  }
  return out;
}

/** YYYY-MM-DD in the active timezone. `en-CA` formats as ISO by definition. */
function localDay(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA");
}

function emptyDay() {
  return {
    input: 0,
    output: 0,
    cache_read: 0,
    cache_creation: 0,
    total: 0,
    messages: 0,
    sessions: 0,
    models: {},
  };
}

async function readExistingHistory() {
  try {
    return JSON.parse(await readFile(HISTORY, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const files = await findTranscripts(path.join(CLAUDE_DIR, "projects"));
  if (files.length === 0) {
    console.error(`No transcripts found under ${CLAUDE_DIR}/projects`);
    console.error("This script must run on the machine where Claude Code is used.");
    process.exit(1);
  }

  const days = new Map();
  // Assistant turns can be written more than once (retries, resumed sessions).
  // messageId+requestId identifies one billed API response.
  const seen = new Set();
  const sessionsByDay = new Map();
  let turns = 0;

  for (const file of files) {
    const rl = createInterface({
      input: createReadStream(file, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue; // a partially-flushed final line is normal
      }
      if (rec.type !== "assistant") continue;

      const usage = rec.message?.usage;
      if (!usage || !rec.timestamp) continue;

      const dedupeKey = `${rec.messageId ?? rec.message?.id ?? ""}:${rec.requestId ?? ""}`;
      if (dedupeKey !== ":") {
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
      }

      const day = localDay(rec.timestamp);
      if (!day) continue;

      if (!days.has(day)) {
        days.set(day, emptyDay());
        sessionsByDay.set(day, new Set());
      }
      const bucket = days.get(day);

      const input = usage.input_tokens ?? 0;
      const output = usage.output_tokens ?? 0;
      const cacheRead = usage.cache_read_input_tokens ?? 0;
      const cacheCreation = usage.cache_creation_input_tokens ?? 0;

      bucket.input += input;
      bucket.output += output;
      bucket.cache_read += cacheRead;
      bucket.cache_creation += cacheCreation;
      bucket.total += input + output + cacheRead + cacheCreation;
      bucket.messages += 1;

      // "<synthetic>" is Claude Code's placeholder for locally-generated turns
      // (cancellations, injected notices). They carry no real usage.
      const model = rec.message?.model;
      if (model && model !== "<synthetic>") {
        bucket.models[model] = (bucket.models[model] ?? 0) + input + output;
      }

      if (rec.sessionId) sessionsByDay.get(day).add(rec.sessionId);
      turns += 1;
    }
  }

  for (const [day, sessions] of sessionsByDay) days.get(day).sessions = sessions.size;

  // Claude Code prunes old transcripts, so a day that has aged out of
  // ~/.claude would silently vanish from the heatmap. Keep what we recorded
  // before; days present in this scan always win.
  const previous = await readExistingHistory();
  const merged = { ...(previous?.days ?? {}) };
  let recovered = 0;
  for (const day of Object.keys(merged)) if (!days.has(day)) recovered += 1;
  for (const [day, bucket] of days) merged[day] = bucket;

  const sorted = Object.fromEntries(
    Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)),
  );

  await mkdir(path.dirname(HISTORY), { recursive: true });
  await writeFile(
    HISTORY,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        source: "claude-code-transcripts",
        days: sorted,
      },
      null,
      2,
    ) + "\n",
  );

  const totalTokens = Object.values(sorted).reduce((sum, d) => sum + d.total, 0);
  console.log(
    `Scanned ${files.length} transcripts, ${turns} assistant turns ` +
      `→ ${days.size} active days this scan` +
      (recovered ? `, ${recovered} carried over from previous history` : ""),
  );
  console.log(`${Object.keys(sorted).length} days total, ${totalTokens.toLocaleString()} tokens`);
  console.log(`Wrote ${path.relative(ROOT, HISTORY)}`);
}

await main();
