# Duplicate Prevention & Business Identity — NPL MIS Portal

This document explains the business-identity rules behind the Excel-import
duplicate-prevention system: what makes two records "the same shipment",
how duplicates are detected at every layer, and how the system behaves under
concurrency. The implementation lives in `src/lib/services/business-key.ts`
and the import pipeline (`src/app/api/import/*`, `src/lib/excel/import.ts`).

> **Status: implemented and tested.** 46 unit checks
> (`bun run test`) + 50 end-to-end import scenarios (`bun run test:import`).
> Do not change these rules without evidence — they encode the operational
> reality of NPL's logistics data.

---

## 1. The identity model

Every MIS record carries two computed, normalized identity fields:

| Field | Composition | Purpose |
|---|---|---|
| **businessKey** | `LR No.` + `Invoice Number` + `Party Name` (normalized) | *Shipment identity* — which physical shipment this row describes |
| **lineKey** | `Material Details` + `Bucket` + `Total Quantity (Ltrs)` (normalized) | *Line discriminator* — which line of a multi-line (PTL) shipment |

The database enforces `UNIQUE (businessKey, lineKey)` on `MisRecord`.

**Why a pair?** PTL shipments legitimately carry **multiple lines under one
business key** — the same LR + Invoice + Party split across different
materials or quantities (44 such groups exist in the production baseline).
The business key alone would falsely call those lines duplicates; the line
key alone would merge unrelated shipments. Only the *pair* is unique.

**Incomplete identity.** A row missing ANY of LR No. / Invoice Number /
Party Name gets `businessKey = NULL`. SQL NULLs are distinct under UNIQUE
constraints, so such records are **exempt from duplicate detection** — they
are legacy/portal-made rows whose identity cannot be established. They are
never deleted or merged by imports.

## 2. Normalization rules

Normalization happens in `src/lib/services/business-key.ts` and is applied
identically on import, on portal edits, and in the seed:

| Input | Rule | Example |
|---|---|---|
| Whitespace | collapse runs → single space, trim | `" SONGOG  26 "` → `"SONGOG 26"` |
| Case | uppercased for comparison only (stored values keep original formatting) | `"acme industries"` → `"ACME INDUSTRIES"` |
| Numeric strings | canonical integer form | `1301`, `"1301"`, `" 1301 "` → `1301` |
| Excel numeric cells | numbers and their string forms resolve identically | invoice `543965` (number) ≡ `"543965"` (text) |
| Empty / blank | becomes NULL (never a zero-length identity part) | `"   "` → missing part → NULL businessKey |
| Leading zeros | **not** preserved for identity (LR is stored INTEGER) | `"01301"` ≡ `1301` |

Deliberate non-goals: no fuzzy matching, no legal-suffix stripping
(`ABC INDUSTRIES LTD.` ≠ `ABC INDUSTRIES`), no phonetic matching. Two
similar-but-different parties are two parties.

## 3. Detection layers (in order)

1. **In-file duplicates** — while parsing, rows are grouped by
   `(businessKey, lineKey)` in memory. Identical rows collapse with a
   duplicate report (row numbers listed); rows with the same key but
   different values are flagged "differ" and the FIRST occurrence wins.
2. **Database duplicates (preview)** — the preview step matches incoming
   keys against stored, non-soft-deleted records and classifies each row
   `NEW` / `UNCHANGED` / `UPDATED` **before anything is written**.
3. **Database uniqueness (apply)** — the `UNIQUE(businessKey, lineKey)`
   constraint is the last line of defense. The apply step runs inside
   SAVEPOINTs; a key inserted between preview and apply (a race) is caught
   by the constraint, counted as a duplicate, and **never crashes the
   import** (PostgreSQL transaction semantics preserved).
4. **Concurrent imports** — two simultaneous imports of overlapping files
   cannot create the same row twice: the constraint admits exactly one.

## 4. Update vs. identity (what may change)

On `UPDATED` classification (same key, changed operational fields):

* **Preserved:** record id, `createdAt`, `createdBy`, identity fields.
* **Updated:** operational fields (status, dates, charges, remarks …) —
  e.g. `DELIVERY STATUS: Pending → Delivered`.
* Records missing from an import file are **NEVER deleted** (red line).

## 5. Soft delete interaction

Soft-deleted records (`deletedAt` set) keep their keys, preventing immediate
re-creation of junk. When a soft-deleted record is **purged** (hard delete),
its identity is released and a re-import of the same row legitimately
creates a NEW record. Soft-delete + re-import of the same key while
soft-deleted = no duplicate error, no resurrection — the row stays deleted.

## 6. Test fixtures & scenarios

Static fixtures (regenerate with `bun scripts/make-import-fixtures.ts` into
`tests/fixtures/`, git-ignored):

| Fixture | Scenario | Expected outcome |
|---|---|---|
| `01-valid.xlsx` | clean baseline | 3 × NEW |
| `02-exact-duplicate.xlsx` | re-import of 01 | 3 × UNCHANGED |
| `03-same-businesskey-different-linekey.xlsx` | PTL multi-line | NEW (independent lines) |
| `04-normalized-duplicate.xlsx` | case/whitespace/numeric-string variants | UNCHANGED (same keys) |
| `05-incomplete-identity.xlsx` | missing LR / invoice / party | NULL businessKey, exempt |
| `06-soft-deleted-key.xlsx` | key previously soft-deleted | stays deleted / recreated after purge |
| `07-changed-operational.xlsx` | status change on 01's keys | UPDATED, id preserved |
| `08-malformed.xlsx` | garbage bytes | rejected with a clear error |
| `09-empty.xlsx` | no MIS sheet | rejected with a clear error |

Live scenarios (need a running server + database — `bun run test:import`,
50 checks): re-import UNCHANGED, in-file duplicate + "differ" reporting,
same LR different invoice, same invoice different LR, whitespace/case
variants, **concurrent import race (S9)**, bad rows don't block good rows,
1,000-row performance, missing rows never deleted, soft-delete identity
release, database uniqueness under parallel creates.

## 7. Concurrency guarantees (summary)

| Situation | Behaviour |
|---|---|
| Stale version on edit (`version` mismatch) | HTTP 409, no write |
| Concurrent updates to one record | last-writer-wins only after 409 retry; version increments |
| Concurrent import of the same file | exactly one wins each key; loser counts duplicates |
| Record inserted after preview | SAVEPOINT catches P2002 → counted as duplicate |
| 4 parallel creates of the same key | exactly one 201, three 409s |

## 8. Red lines

* `SR. NO.`, `Vehicle`, `Party` alone, or `Destination` are **never** part
  of the business key (generated or non-identifying columns).
* Imports **never delete** records absent from the file.
* Normalization rules change only with production-data evidence.
* No fuzzy matching — ever.
