#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  COUNTERBALANCE_CELLS,
  CURRENT_ALLOCATION_STRATEGY_VERSION,
  SPEAKER_PATTERN_BUNDLES,
} from "../functions/api/_counterbalance.js";

const DEFAULT_SESSIONS = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../Results_Pilot/results_20260723/sessions.csv",
);
const DEFAULT_OUTPUT_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../Results_Pilot/taskflow_gapfill_additional_20260806",
);
const DEFAULT_BASE_URL = "https://accentedness-additional.pages.dev/";
const DEFAULT_COHORT = "gapfill_2026_07_microcell_v1";
const DEFAULT_ROUND_ID = "gapfill-additional-20260806-v2";

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  return process.argv[index + 1] || fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function usage() {
  return `Usage:
  node scripts/generate_taskflow_gapfill.mjs [options]

Options:
  --sessions PATH      Authoritative sessions.csv. Default: ${DEFAULT_SESSIONS}
  --output-dir PATH    Private output directory. Default: ${DEFAULT_OUTPUT_DIR}
  --base-url URL       Deployed study URL. Default: ${DEFAULT_BASE_URL}
  --cohort ID          Server-authorized allocation cohort. Default: ${DEFAULT_COHORT}
  --round-id ID        Stable identifier used in slot IDs. Default: ${DEFAULT_ROUND_ID}
  --overwrite          Replace an existing generated output set.
  --help               Show this help.
`;
}

function clean(value) {
  return String(value ?? "").trim();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const source = String(text || "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (quoted) {
      if (character === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (character !== "\r") {
      cell += character;
    }
  }
  row.push(cell);
  if (row.some((value) => clean(value))) rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0].map((header) => clean(header).replace(/^\uFEFF/, ""));
  return rows
    .slice(1)
    .filter((values) => values.some((value) => clean(value)))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvRows(rows, columns, includeHeader = true) {
  const lines = rows.map((row) => columns.map((column) => csvCell(row[column])).join(","));
  if (includeHeader) lines.unshift(columns.join(","));
  return `${lines.join("\n")}\n`;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function validateIdentifier(name, value) {
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(value)) {
    throw new Error(`${name} must contain only A-Z, a-z, 0-9, dot, underscore, colon, or hyphen (maximum 80 characters).`);
  }
}

function externalUrl(baseUrl, token) {
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}assignment_token=${token}` +
    "&PROLIFIC_PID={{%PROLIFIC_PID%}}" +
    "&STUDY_ID={{%STUDY_ID%}}" +
    "&SESSION_ID={{%SESSION_ID%}}";
}

function writePrivate(filePath, contents) {
  fs.writeFileSync(filePath, contents, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    console.log(usage());
    return;
  }

  const sessionsPath = path.resolve(argValue("--sessions", DEFAULT_SESSIONS));
  const outputDir = path.resolve(argValue("--output-dir", DEFAULT_OUTPUT_DIR));
  const baseUrl = new URL(argValue("--base-url", DEFAULT_BASE_URL)).toString();
  const cohort = clean(argValue("--cohort", DEFAULT_COHORT));
  const roundId = clean(argValue("--round-id", DEFAULT_ROUND_ID));
  validateIdentifier("cohort", cohort);
  validateIdentifier("round-id", roundId);

  if (!fs.existsSync(sessionsPath)) throw new Error(`sessions.csv was not found: ${sessionsPath}`);
  if (fs.existsSync(outputDir) && !hasFlag("--overwrite")) {
    throw new Error(`Output directory already exists: ${outputDir}. Use --overwrite to replace the generated files.`);
  }
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(outputDir, 0o700);

  const sessions = parseCsv(fs.readFileSync(sessionsPath, "utf8"));
  const completed = sessions.filter((row) => clean(row.status) === "completed");
  if (!completed.length) throw new Error("sessions.csv contains no completed sessions.");
  const invalidCompleted = completed.filter((row) => {
    const cellId = Number(row.counterbalance_cell);
    const bundleId = Number(row.speaker_pattern_bundle);
    return !Number.isInteger(cellId) || cellId < 1 || cellId > 20 ||
      !Number.isInteger(bundleId) || bundleId < 1 || bundleId > 10 ||
      clean(row.allocation_strategy_version) !== CURRENT_ALLOCATION_STRATEGY_VERSION;
  });
  if (invalidCompleted.length) {
    throw new Error(`${invalidCompleted.length} completed session(s) do not have a valid current cell/bundle allocation.`);
  }

  const completedCounts = new Map();
  completed.forEach((row) => {
    const key = `${Number(row.counterbalance_cell)}:${Number(row.speaker_pattern_bundle)}`;
    completedCounts.set(key, (completedCounts.get(key) || 0) + 1);
  });

  const cellById = new Map(COUNTERBALANCE_CELLS.map((cell) => [cell.cell_id, cell]));
  const bundleById = new Map(
    SPEAKER_PATTERN_BUNDLES.map((bundle) => [bundle.speaker_pattern_bundle, bundle]),
  );
  const missing = [];
  for (const cell of COUNTERBALANCE_CELLS) {
    for (const bundle of SPEAKER_PATTERN_BUNDLES) {
      const key = `${cell.cell_id}:${bundle.speaker_pattern_bundle}`;
      if ((completedCounts.get(key) || 0) === 0) {
        missing.push({
          cell_id: cell.cell_id,
          list_comb: cell.list_comb,
          pronunciation_style: cell.pronunciation_style,
          speaker_pattern_bundle: bundle.speaker_pattern_bundle,
          speaker_pattern_indexes: bundle.patterns.join("-"),
        });
      }
    }
  }

  const generatedAt = new Date().toISOString();
  const slots = missing.map((gap) => {
    const token = crypto.randomBytes(32).toString("base64url");
    const slotId = `${roundId}-c${String(gap.cell_id).padStart(2, "0")}-b${String(gap.speaker_pattern_bundle).padStart(2, "0")}`;
    return {
      ...gap,
      slot_id: slotId,
      allocation_cohort: cohort,
      allocation_strategy_version: CURRENT_ALLOCATION_STRATEGY_VERSION,
      assignment_token: token,
      token_hash: sha256Hex(token),
      external_url: externalUrl(baseUrl, token),
      total_allocation: 1,
    };
  });

  const uploadRows = slots.map((slot) => ({
    external_url: slot.external_url,
    total_allocation: slot.total_allocation,
  }));
  writePrivate(
    path.join(outputDir, "taskflow_upload.csv"),
    csvRows(uploadRows, ["external_url", "total_allocation"], false),
  );
  writePrivate(
    path.join(outputDir, "taskflow_slot_manifest_PRIVATE.csv"),
    csvRows(slots, [
      "slot_id",
      "cell_id",
      "list_comb",
      "pronunciation_style",
      "speaker_pattern_bundle",
      "speaker_pattern_indexes",
      "allocation_cohort",
      "allocation_strategy_version",
      "assignment_token",
      "external_url",
      "total_allocation",
    ]),
  );
  writePrivate(
    path.join(outputDir, "taskflow_gap_report.csv"),
    csvRows(slots, [
      "slot_id",
      "cell_id",
      "list_comb",
      "pronunciation_style",
      "speaker_pattern_bundle",
      "speaker_pattern_indexes",
    ]),
  );

  const insertValues = slots.map((slot) =>
    `  (${[
      slot.slot_id,
      slot.token_hash,
      slot.allocation_cohort,
      slot.allocation_strategy_version,
      slot.cell_id,
      slot.speaker_pattern_bundle,
      generatedAt,
      generatedAt,
    ].map(sqlString).join(", ")})`,
  );
  const seedSql = [
    "-- Generated from the authoritative sessions.csv.",
    `-- Source: ${sessionsPath}`,
    `-- Completed sessions: ${completed.length}; missing cell x bundle microcells: ${slots.length}`,
    "-- Raw assignment tokens are intentionally absent from this SQL file.",
    "INSERT INTO targeted_allocation_slots (",
    "  slot_id, token_hash, allocation_cohort, allocation_strategy_version,",
    "  cell_id, speaker_pattern_bundle, created_at, updated_at",
    ") VALUES",
    `${insertValues.join(",\n")};`,
    "",
  ].join("\n");
  writePrivate(path.join(outputDir, "taskflow_seed.sql"), seedSql);

  const byCell = [...new Set(slots.map((slot) => slot.cell_id))]
    .sort((left, right) => left - right)
    .map((cellId) => {
      const cell = cellById.get(cellId);
      const gaps = slots.filter((slot) => slot.cell_id === cellId);
      return {
        cell_id: cellId,
        list_comb: cell.list_comb,
        pronunciation_style: cell.pronunciation_style,
        missing_bundles: gaps.map((gap) => gap.speaker_pattern_bundle),
      };
    });
  const bundleTotals = Object.fromEntries(
    [...bundleById.keys()].map((bundleId) => [
      `B${bundleId}`,
      completed.filter((row) => Number(row.speaker_pattern_bundle) === bundleId).length,
    ]),
  );
  writePrivate(
    path.join(outputDir, "taskflow_summary.json"),
    `${JSON.stringify({
      generated_at: generatedAt,
      sessions_source: sessionsPath,
      completed_sessions: completed.length,
      completed_unique_microcells: completedCounts.size,
      missing_microcells: slots.length,
      allocation_cohort: cohort,
      allocation_strategy_version: CURRENT_ALLOCATION_STRATEGY_VERSION,
      round_id: roundId,
      missing_by_cell: byCell,
      completed_bundle_totals: bundleTotals,
    }, null, 2)}\n`,
  );

  console.log(`sessions source: ${sessionsPath}`);
  console.log(`completed sessions: ${completed.length}`);
  console.log(`unique completed cell x bundle microcells: ${completedCounts.size}/200`);
  console.log(`Taskflow URL slots generated: ${slots.length}`);
  console.log(`private output: ${outputDir}`);
}

main();
