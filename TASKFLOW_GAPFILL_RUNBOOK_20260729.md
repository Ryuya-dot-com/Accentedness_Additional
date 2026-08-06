# Additional study: 22-slot Taskflow gap-fill runbook

This runbook targets the isolated `Accentedness_Additional` Pages project and
D1 database. It must not deploy to or mutate the original study service.

This runbook treats
`/Users/tohokusla/Dropbox/Accentedness/Results_Pilot/results_20260723/sessions.csv`
as the authoritative completed-session ledger. It does not modify that file.

## 1. What is being filled

The source contains 202 `status=completed` sessions and 178 distinct
counterbalance cell × speaker-pattern-bundle microcells out of 200. Completing
the full 20 × 10 design therefore requires 22 Taskflow URL slots:

| Cell | Missing bundle(s) | Slots |
|---|---:|---:|
| CDEF-a | B8 | 1 |
| DEFG-a | B2 | 1 |
| EFGH-a | B4 | 1 |
| GHIJ-a | B1, B10 | 2 |
| JABC-a | B9 | 1 |
| BCDE-b | B1 | 1 |
| CDEF-b | B4, B9, B10 | 3 |
| DEFG-b | B6 | 1 |
| EFGH-b | B6, B8 | 2 |
| FGHI-b | B1, B9 | 2 |
| GHIJ-b | B4 | 1 |
| HIJA-b | B4 | 1 |
| IJAB-b | B3, B5, B7 | 3 |
| JABC-b | B2, B7 | 2 |

The collaborator's eight-person list is a marginal cell-total view. It is not
enough to guarantee one completed participant in every cell × bundle
microcell. In particular, the authoritative file has CDEF-a = 10 completed
sessions, not 9, while several cells with a marginal total of 20 or 21 still
have missing bundles because other bundles were duplicated.

## 2. Generated private files

The generator is `scripts/generate_taskflow_gapfill.mjs`. The generated private
directory is:

```text
/Users/tohokusla/Dropbox/Accentedness/Results_Pilot/taskflow_gapfill_additional_20260806
```

- `taskflow_upload.csv`: upload this headerless two-column file to Taskflow.
  Column A is the participant URL and column B is `1`.
- `taskflow_seed.sql`: seed D1 after migration 0016. It contains only SHA-256
  token hashes, not usable URL tokens.
- `taskflow_gap_report.csv`: human-readable cell/bundle list without tokens.
- `taskflow_slot_manifest_PRIVATE.csv`: recovery/audit mapping containing raw
  assignment tokens. Never commit, email, or include it in an OSF package.
- `taskflow_summary.json`: source path, counts, cohort, and bundle summary.

The directory and files are created with owner-only permissions. Regeneration
creates new secrets, so do not use `--overwrite` after the upload or D1 seed has
been adopted unless both sides will be replaced together.

To regenerate intentionally:

```sh
node scripts/generate_taskflow_gapfill.mjs \
  --sessions /Users/tohokusla/Dropbox/Accentedness/Results_Pilot/results_20260723/sessions.csv \
  --output-dir /Users/tohokusla/Dropbox/Accentedness/Results_Pilot/taskflow_gapfill_additional_20260806 \
  --base-url https://accentedness-additional.pages.dev/ \
  --cohort gapfill_2026_07_microcell_v1 \
  --round-id gapfill-additional-20260806-v2 \
  --overwrite
```

The pre-launch v1 URLs were revoked on 2026-08-06 after raw assignment tokens
appeared in a setup screenshot. The production D1 contains only the regenerated
v2 slot hashes. Upload only the current private `taskflow_upload.csv`; every v1
URL is intentionally invalid and must not be restored from screenshots or
browser history.

## 3. Deployment order

Do not upload or publish the Taskflow study until the new code and schema pass
the live readiness check.

1. Record a D1 Time Travel bookmark or export a backup.
2. Apply `db/migrations/0016_taskflow_targeted_allocations.sql` to production
   D1 before deploying code that queries the new table.
3. Deploy platform v0.10.3.
4. Seed the 22 hashed slots from the private `taskflow_seed.sql` file.
5. Create a new Prolific Taskflow study and upload `taskflow_upload.csv`.
6. Set the Taskflow allocation strategy to **deallocated first round robin**.
   Each URL already has allocation `1`, so the study total is 22.
7. Use URL-parameter ID recording. The CSV already includes the exact
   `PROLIFIC_PID`, `STUDY_ID`, and `SESSION_ID` Taskflow placeholders.
8. Leave custom screening off unless the study has a separate, genuine
   screening requirement. The assignment token selects a task; it is not a
   participant screener.
9. Before publishing, add the new Taskflow Study ID and completion path to the
   Cloudflare secrets below, redeploy, and run one authorized staging/live
   check without consuming any of the 22 production tokens.

Apply and seed, after reviewing the exact project/database names:

```sh
npx wrangler d1 execute accentedness-additional --remote \
  --file=./db/migrations/0016_taskflow_targeted_allocations.sql

npx wrangler d1 execute accentedness-additional --remote \
  --file=/Users/tohokusla/Dropbox/Accentedness/Results_Pilot/taskflow_gapfill_additional_20260806/taskflow_seed.sql
```

The required study-to-cohort secret authorizes only the new Taskflow study in
this isolated deployment. Example shape only:

```json
{
  "TASKFLOW_STUDY_ID": "gapfill_2026_07_microcell_v1"
}
```

Store it with:

```sh
npx wrangler pages secret put COUNTERBALANCE_COHORTS_JSON \
  --project-name accentedness-additional
```

Configure only the new study's completion path here. A value may be a code
string or an object containing `code` and/or a full `url`:

```json
{
  "TASKFLOW_STUDY_ID": {"code": "TASKFLOW_CODE"}
}
```

Store it with:

```sh
npx wrangler pages secret put PROLIFIC_COMPLETION_BY_STUDY_JSON \
  --project-name accentedness-additional
```

Do not copy the original study's completion code into this deployment. The
per-study map prevents accidental return to the original study's completion
path.

## 4. Claim, return, timeout, and replacement behavior

Each Taskflow URL contains one random opaque assignment token. On first valid
start, the server hashes it, atomically claims the matching slot, and fixes the
session to the exact cell and speaker-pattern bundle. The raw token is not
written to D1, session event logs, or exports, and the client removes it from
the address bar after a successful session start.

- Reload/reconnect by the same `PROLIFIC_PID + STUDY_ID + SESSION_ID` resumes
  the same session and does not consume another slot.
- If Prolific releases a URL because the submission was returned, timed out, or
  rejected, a replacement receives the same Taskflow URL. When that new
  Prolific identity starts, the server closes the prior unfinished session as
  `incomplete_dropout` or `abandoned`, revokes its session token, and transfers
  the target slot atomically.
- Prolific does not call this application when it releases a slot. During the
  interval before a replacement starts, the old external session can still be
  resumed if the participant kept its direct URL. The replacement start is the
  event that revokes the old session; use the participant-scoped admin/consent
  procedure when immediate closure is required.
- A completed target slot is locked and refuses reuse.
- `Finalize stale sessions` also reopens claimed slots whose sessions have
  become non-active and reconciles completed slots.
- Prolific guarantees that the same participant is not allocated the same URL
  twice. The application additionally prevents one Taskflow URL from producing
  two simultaneously usable study sessions.

A participant's explicit withdrawal of consent is different from a Taskflow
return. Taskflow can release the URL, but it cannot delete data in D1. Follow
the ethics/data-management plan: identify and delete or irreversibly anonymize
the external study data, record the action, and only then decide whether the
scientific microcell should be reopened for replacement. Take a backup and use
a reviewed, participant-scoped procedure; do not run an unscoped deletion.

## 5. Reconnection/resume contract

Platform v0.10.3 shows a dedicated resume screen before returning to the task.
The screen states how many main responses are saved and names the next step.

- If Questions 1–49 are saved, it displays **49 saved responses**, identifies
  **Question 50** as next, and the resume button goes directly to Question 50.
  The five practice items are not repeated.
- If at least one main response is saved, practice is never replayed.
- If zero main responses are saved and the next step is Question 1, the screen
  explicitly explains that the five practice items will be shown before
  Question 1.
- If all ratings are saved, resume routes to the pending distractor, word
  familiarity checklist, or completion state as applicable.

The button is intentional: it provides the browser user gesture needed for
reliable audio playback while still making the resume state explicit. Responses
remain server-saved trial by trial; the existing assignment order is not
reshuffled.

Partial payment is a Prolific researcher action and is not automated by this
application. For a technical interruption, make the payment through Prolific's
bonus/partial-payment workflow against the correct submission and retain the
message/payment record.

## 6. Monitoring and closeout

- `/api/admin/summary` reports open, claimed, and completed targeted slots.
- `/api/admin/export/targeted-slots` exports the slot ledger without token
  hashes.
- `sessions.csv`, `analysis.csv`, `counterbalance.csv`, and
  `word-familiarity.csv` now include `targeted_allocation_slot_id` for joins.
- Compare completed targeted slots with Prolific's demographic export `URL`
  column before closing recruitment.
- Stop only when all 22 target slots are `completed` and the refreshed
  `sessions.csv` shows all 200 cell × bundle microcells represented.

Do not use participant-facing preview links containing any of the 22 production
tokens. Use a separately generated staging slot and staging D1 for preview and
reconnection testing.
