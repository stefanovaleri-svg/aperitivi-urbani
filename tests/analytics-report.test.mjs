import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  rowsToCsv,
  writeReport,
} from "../scripts/analytics-report.mjs";

test("serializes stable UTF-8 CSV and neutralizes spreadsheet formulas", () => {
  const csv = rowsToCsv(
    [
      {
        nome: '=HYPERLINK("https://example.test")',
        tipo: ["Aperitivo", "Cena"],
        visits: 12,
      },
      { nome: "\n+SUM(1,1)", tipo: [], visits: 0 },
      { nome: "Virgola, virgolette \" e\nnewline", tipo: [], visits: 0 },
    ],
    ["nome", "tipo", "visits"],
  );

  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"\'=HYPERLINK(""https://example.test"")"'));
  assert.ok(csv.includes('"Aperitivo | Cena",12'));
  assert.ok(csv.includes('"\'\n+SUM(1,1)","",0'));
  assert.ok(csv.includes('"Virgola, virgolette "" e\nnewline","",0'));
  assert.ok(csv.endsWith("\r\n"));
});

test("writes JSON and one CSV for each analytics table", async (t) => {
  const outDir = await mkdtemp(path.join(tmpdir(), "au-analytics-"));
  t.after(() => rm(outDir, { recursive: true, force: true }));

  const report = {
    sito: "aperitivi-urbani",
    range: {
      since: "2026-07-01T00:00:00.000Z",
      until: "2026-07-02T00:00:00.000Z",
      giorni: 1,
    },
    traffico_giornaliero: [
      { date: "2026-07-01", count: 20, visits: 15 },
    ],
    top_pagine: [
      {
        requestPath: "/locali/esempio",
        count: 12,
        visits: 9,
        slug: "esempio",
        nome: "Esempio",
        tipo: ["Aperitivo"],
        zona: "Centro",
        tipo_pagina: "locale",
      },
    ],
    provenienza: [
      { refererHost: "@SUM(1+1)", count: 4, visits: 3 },
    ],
    slug_orfani: [],
  };

  const outputPaths = await writeReport(
    "aperitivi-urbani",
    report,
    outDir,
  );
  assert.deepEqual(
    outputPaths.map((outputPath) => path.basename(outputPath)).sort(),
    [
      "aperitivi-urbani.json",
      "aperitivi-urbani.provenienza.csv",
      "aperitivi-urbani.top-pagine.csv",
      "aperitivi-urbani.traffico-giornaliero.csv",
    ],
  );

  assert.deepEqual(
    JSON.parse(await readFile(path.join(outDir, "aperitivi-urbani.json"))),
    report,
  );
  assert.ok(
    (
      await readFile(
        path.join(outDir, "aperitivi-urbani.traffico-giornaliero.csv"),
        "utf8",
      )
    ).includes('"2026-07-01",20,15'),
  );
  assert.ok(
    (
      await readFile(
        path.join(outDir, "aperitivi-urbani.top-pagine.csv"),
        "utf8",
      )
    ).includes('"/locali/esempio",12,9'),
  );
  assert.ok(
    (
      await readFile(
        path.join(outDir, "aperitivi-urbani.provenienza.csv"),
        "utf8",
      )
    ).includes('"\'@SUM(1+1)",4,3'),
  );
});
