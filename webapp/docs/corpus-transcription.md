# Audio / Video Transcription (M7)

Engineering reference for the OCI Speech-powered transcription pipeline
that turns audio and video artifacts into searchable chunks alongside
PDFs, reports, and uploads.

## One-minute summary

1. User uploads / the app downloads an `audio` or `video` artifact.
2. `ingest.ts` stores the blob, inserts the `artifacts` row with
   `transcription_status = 'pending'`, and fires a non-blocking
   `enqueueTranscription(id)`.
3. `enqueueTranscription` submits an **OCI Speech** (Whisper) job
   pointing at the blob in Object Storage and flips the row to
   `transcribing` with the returned job OCID.
4. A single in-process `setInterval` poller in `transcribe.ts` wakes
   every 30 s (`CORPUS_TRANSCRIBE_POLL_MS`), fetches the lifecycle state
   of every `transcribing` row, and:
   - on `SUCCEEDED` → pulls the JSON output from Object Storage, chunks
     the transcript, embeds the chunks, inserts them into
     `artifact_chunks`, flips the row to `done`.
   - on `FAILED` / `CANCELED` → copies the lifecycle detail into
     `transcription_error` and flips the row to `failed`.
5. The Library page shows a `⏳ running → ✓ done` badge per row.
   Users can click the row to see a detail panel with a `Retry`
   button when things fail.

Transcribed chunks flow through the existing vector-search +
chat pipelines with **zero other changes** — they're just rows in
`artifact_chunks` like any other text.

## Cost model (quick reference)

- **$0.50 / transcription hour**, **5 free hours per tenancy per month**.
  Personal research usage comfortably fits under the free cap.
- Whisper medium (default) costs the same as Oracle models.
- A 30-minute podcast → 0.5 hr; a 40-minute NotebookLM video → 0.67 hr.
  Ten podcasts / month ≈ 5 hrs ≈ still free.
- Empty / failed jobs are **not** billed (no completed seconds).

## Configuration

All knobs are optional. Sensible defaults cover the personal-use case.

| Env var                          | Default                                 | Purpose |
|----------------------------------|-----------------------------------------|---------|
| `OCI_SPEECH_ENABLED`             | `true` (when corpus enabled)            | Master gate. `false`/`0`/`off` disables. |
| `OCI_SPEECH_REGION`              | `OCI_GENAI_REGION` → `OCI_REGION`       | Speech may not live in every region. |
| `OCI_SPEECH_LANGUAGE`            | `auto`                                  | Whisper language. `zh`, `en`, `ja` etc. |
| `OCI_SPEECH_OUTPUT_PREFIX`       | `transcripts/`                          | Object Storage prefix for job output JSON. |
| `CORPUS_MAX_TRANSCRIBE_MINUTES`  | `120`                                   | Defensive cap; 2 h ≈ $1. |
| `CORPUS_TRANSCRIBE_POLL_MS`      | `30000` (floor 5000)                    | Poller tick. |

### IAM / policy requirements

OCI Speech runs under **delegated user auth** — the job reads/writes
Object Storage using the *submitter's* identity, not a separate
service principal. Per the
[official Speech policies doc](https://docs.oracle.com/en-us/iaas/Content/speech/using/policies.htm),
the only statements needed are on your API-key user's group. Two
lines, both scoped to the corpus compartment:

```text
# Submit / poll / cancel Speech jobs.
Allow group research-corpus-admins to manage ai-service-speech-family in compartment research-corpus

# Read input audio + write transcript JSON back to the same bucket.
# (Already present as part of the base corpus setup.)
Allow group research-corpus-admins to manage object-family in compartment research-corpus
```

The same `nblm-corpus-app` user / API key used for Storage + GenAI
signs Speech calls. **Do not** add a `where request.principal.type=
'aiservicespeechtranscriptionjob'` grant — there is no such service
principal in Speech's published auth model; such a statement is a
harmless no-op that just clutters your policy and misleads future
debugging sessions.

If you see `INPUT_LIST_READ_ERROR: Unable to read the batch list`
after a job is submitted, it is **not** a missing-policy symptom — see
the Troubleshooting section below. The real cause is almost always a
region mismatch between Speech and the bucket.

## State machine

```
              (kind=audio|video, ingest commit)
    NULL ──────────────────────► pending
                                   │
                                   │  enqueueTranscription()
                                   │  submit OCI Speech job
                                   ▼
                              transcribing
                                /    \
                      SUCCEEDED/      \ FAILED / CANCELED
                              /        \
                             ▼          ▼
                           done        failed ─── user clicks Retry ───►
                                                  (reset to pending)   │
                                                                       │
                                                                       ▼
                                                                     pending

Special terminal: skipped  (non-audio/video kind, speech disabled,
                            or file exceeds duration cap)
```

`pending` is the brief window between insert and job submit. `done`
and `failed` are the only long-lived non-`null` states.

## Schema

Four nullable columns on `artifacts`, plus one filter index:

```sql
transcription_status    VARCHAR2(20)   -- null|pending|transcribing|done|failed|skipped
transcription_job_ocid  VARCHAR2(255)  -- job OCID for polling + debugging
transcribed_at          TIMESTAMP      -- when the transcript was finalised
transcription_error     VARCHAR2(2000) -- last failure message
```

See `webapp/server/corpus/schema.alter-transcription.sql` for the
idempotent migration (safe to re-run). `schema.sql` has been updated
so fresh installs get the columns without a separate migration.

The index `ix_artifacts_trx_status` makes the poller's hot-path scan
(`WHERE transcription_status = 'transcribing'`) cheap regardless of
table size.

## Files

```
webapp/server/corpus/
  oci/speech.ts                      SDK wrapper (submit, poll, cancel, fetch)
  transcribe.ts                      orchestrator + poller
  transcribe-backfill.ts             one-shot CLI for existing rows
  ingest.ts                          fires enqueueTranscription after commit
  schema.alter-transcription.sql     idempotent migration
  schema.sql                         now includes the M7 columns

webapp/server/routes/corpus.ts       GET /artifacts returns TRANSCRIPTION_* cols
                                     POST /artifacts/:id/transcribe (retry)

webapp/server/index.ts               startTranscriptionPoller(cfg) on boot

webapp/client/src/lib/corpus.ts      TranscriptionStatus, transcribeArtifact()
webapp/client/src/pages/
  CorpusLibraryPage.tsx              TranscriptionBadge + detail panel
```

## Output parsing

OCI Speech writes a per-input JSON at an **observed layout** like:

```
<speechOutputPrefix>job-<ocidTail>/<namespace>_<bucket>_<inputDir>/<inputBasename>.json
```

where `<ocidTail>` is everything after the last `.` in the job OCID,
and each `/` in the input object name becomes a folder level under
the `job-<ocidTail>/` prefix. This scheme is **not contractual** —
it has changed across Speech model versions — so we deliberately
don't try to predict the exact filename at submit time.

Instead, at finalise time `findTranscriptObjectName(cfg, jobOcid)`
in `speech.ts`:

1. Builds the prefix `<speechOutputPrefix>job-<ocidTail>/`.
2. Calls `listObjects` with that prefix and **no `delimiter`** so the
   listing is recursive.
3. Returns the first object whose name ends with `.json` —
   unambiguous, since each job submits exactly one input.

If nothing is found (Speech reported `SUCCEEDED` but the output
object is missing — write-permission issue or an upstream race),
the row is marked `failed` with `output object not found under
transcripts/job-<ocid>/` so the source of the problem is obvious.

Once the JSON is located, `fetchTranscriptText` extracts
`transcriptions[0].transcription` (the model's own punctuated join)
and falls back to `tokens[].token` if that's missing. The finalise
log line includes the resolved object path so you can correlate with
the bucket contents at a glance:

```text
[transcribe] finalised artifact=01KQ... chunks=4 source=transcripts/job-amaaaaaa.../...mp4.json
```

Diarisation / per-token timing is preserved in the JSON blob but
deliberately ignored here — we only need clean text for chunking.

## Poller design

- Single `setInterval` per process, `intervalMs = cfg.transcribePollMs`.
- Global `tickInFlight` guard — if a tick is still running when the
  next one fires, the new tick is skipped (no duplicate finalisations).
- Bounded concurrency (`FINALISE_CONCURRENCY = 3`) on finalisation so
  a bulk completion spike doesn't burn the embedding budget in one go.
- Interval is `.unref()`'d so it doesn't block graceful shutdown.
- An early tick fires 2 s after boot so a server restart doesn't wait
  a full interval before reconciling jobs submitted before the crash.

Multi-replica safety is **not** implemented — this is a personal-use
webapp. If we ever horizontally scale, add
`SELECT ... FOR UPDATE SKIP LOCKED` to the poller's pending scan.

## Error handling

| Failure                                            | Outcome |
|----------------------------------------------------|---------|
| `OCI_SPEECH_ENABLED=false`                         | New rows → `skipped`. Existing `transcribing` rows stay put (poller no-ops). |
| Region doesn't host Speech                         | Submit fails → row → `failed`, error surfaced in UI. |
| File too long / quota hit                          | Job `FAILED` from Speech → row → `failed` with lifecycle detail. |
| Submit fails (IAM, 400, network)                   | Caught in `enqueueTranscription`; row → `failed`, error stored. |
| `OCI_SPEECH_REGION` ≠ `OCI_REGION` (bucket region) | Submit succeeds + returns OCID; job immediately flips to `FAILED` with `INPUT_LIST_READ_ERROR: Unable to read the batch list`. Object Storage is regional — Speech in region A cannot read a bucket in region B. See Troubleshooting. Boot-time warning in `config.ts` now flags this loudly. |
| Invalid `displayName` (any char outside `[a-zA-Z0-9_-]`) | Submit fails at OCI API level. Not reachable from normal code paths — `sanitiseDisplayName()` in `speech.ts` strips bad chars first. |
| Output object missing after SUCCEEDED              | `findTranscriptObjectName` returns null → row → `failed` with `output object not found under transcripts/job-<ocid>/`. |
| Chunk / embed / insert fails after fetch           | Row → `failed`, error stored. Chunks are NOT half-inserted (we wipe first in a tx). |
| Poller can't reach OCI Speech for a single row     | That row → `failed` with `poll: <msg>`. Other rows on the tick are unaffected. |
| Server restart mid-finalise                        | Row stays `transcribing`. Next boot reconciles within 30 s; if Speech says `SUCCEEDED` we re-run finalise (idempotent — chunks are wiped first). |

## Client UX

- Library table gains a **Transcript** column:
  - `—` (light) for non-audio/video
  - `— ` (grey, tooltip = reason) for `skipped` / never-run
  - pulsing amber dot + `queued` / `running` for `pending` / `transcribing`
  - green `✓` for `done`
  - rose `✗` for `failed` (tooltip = error message)
- **Auto-refresh**: while any visible row has an in-flight status,
  the page re-fetches every 15 s so state changes land within a few
  polls without the user touching anything.
- Detail panel gets a **Transcription** sub-card with the status label,
  finished timestamp, inline error text, and a `Transcribe` /
  `Re-transcribe` button (hidden during in-flight).

Retrying `done` rows is allowed and simply replaces the existing
chunks — useful when Whisper mis-detects the language on first pass.

## Health check

`GET /api/corpus/health` returns a new `transcription` field:

```json
{
  "transcription": {
    "enabled": true,
    "ok": true,
    "region": "ap-osaka-1",
    "language": "auto"
  }
}
```

`ok: false` with `enabled: true` means the Speech probe (`ListTranscriptionJobs limit=1`) failed — check IAM or region.

## Backfill

For artifacts that predate M7 (or were ingested with Speech disabled):

```powershell
cd webapp
npx tsx server/corpus/transcribe-backfill.ts                           # dry-run: shows targets
npx tsx server/corpus/transcribe-backfill.ts --apply                   # submit new Speech jobs
npx tsx server/corpus/transcribe-backfill.ts --apply --include-failed  # also retry previously-failed rows
npx tsx server/corpus/transcribe-backfill.ts --apply --refetch         # re-run finalise only (no Speech resubmit)
```

### Modes

| Mode | Targets | What it does | When to use |
|---|---|---|---|
| *(default)*        | `status IS NULL OR IN ('skipped','pending')`                    | `enqueueTranscription` — fresh submit. | First run on a freshly-enabled Speech setup. |
| `--include-failed` | Default set + `status='failed'`                                 | `retryTranscription` — reset + new submit. Burns a fresh Whisper job for each row. | Whisper actually failed (bad audio, quota, language hiccup) and you want another attempt. |
| `--refetch`        | `status='failed' AND transcription_job_ocid IS NOT NULL`        | `refetchTranscription` — verify Speech says `SUCCEEDED`, then re-run finalise against the existing OCID. No Speech resubmit. | Speech succeeded but *our* finaliser tripped (output-filename resolution bug, DB transient, embed outage). Saves \$\$ and 5+ minutes per row. |

`--refetch` and `--include-failed` are **mutually exclusive** — they
target overlapping row sets with different semantics; the CLI
refuses if both are passed.

The script walks oldest-first and is safe to re-run — all three
paths are idempotent (row-level UPDATE guards + `DELETE FROM
artifact_chunks WHERE artifact_id = :aid` inside the insert tx).

## Rollback

Fully reversible:

1. `OCI_SPEECH_ENABLED=false` — new ingests mark `skipped`, no new
   jobs, poller self-disables.
2. Optional: `UPDATE artifacts SET transcription_status = NULL` to
   forget state.
3. Optional:
   ```sql
   ALTER TABLE artifacts DROP (
     transcription_status, transcription_job_ocid,
     transcribed_at, transcription_error
   );
   ```
   Existing chunks / blobs are untouched — only the transcript-column
   data is lost.

## Troubleshooting

Real failure modes we've hit in production, in order of frequency.
Each entry gives the symptom (what you see), the root cause, and the
fix. All of these wasted significant debugging time the first time
around — writing them down so the next-time investigation is minutes,
not hours.

### `INPUT_LIST_READ_ERROR: Unable to read the batch list for job <ocid>`

**Symptom.** Submit succeeds and returns a valid job OCID. The
poller's first tick on the job sees `lifecycleState=FAILED` with this
message. Row lands at `failed`. Every new submit does the same thing.

**Root cause.** `OCI_SPEECH_REGION` doesn't match the bucket region
(`OCI_REGION`). Object Storage is a regional service — a Speech job
running in Osaka cannot read a bucket in Tokyo, period. The Speech
service reports this as a generic "batch list unreadable" rather than
something obvious like "wrong region", which is what makes it painful.

**Fix.** Set `OCI_SPEECH_REGION` to the bucket's region. On boot,
`config.ts` now prints a loud `⚠️` warning when these two differ —
don't ignore it.

**What it is *not*.** Missing IAM policy on a Speech service principal.
There is no such service principal — Speech uses delegated user auth.
Any policy statement with `where request.principal.type=
'aiservicespeechtranscriptionjob'` is a no-op and can be deleted.

### Job submit fails at 400 with a `displayName` validation error

**Symptom.** `enqueueTranscription` throws during the submit call;
row goes straight to `failed` with an OCI 400 about invalid characters
in `displayName`. Most common with non-ASCII video titles (Chinese
comma `：`, full-width parens, emoji).

**Root cause.** OCI Speech's `displayName` only accepts
`[a-zA-Z0-9_-]`. We use the artifact title as the basis of the name.

**Fix.** Already handled — `sanitiseDisplayName()` in `speech.ts`
strips disallowed chars before submit, so this shouldn't be reachable
from normal code paths. If you see it, check that callers of
`submitTranscriptionJob` aren't bypassing the helper.

### `empty transcript (model returned no text)` on a row you know succeeded

**Symptom.** Terminal log from `--refetch` says `chunks=N source=...`
with a real object path. Library UI shows the row as `failed` with
this error. Feels like a race.

**Root cause.** Two finalisers ran concurrently on the same row —
typically because `node --watch` on Windows didn't fully reload the
poller module after a code change, so the webapp-side poller is
running *old* code while the CLI is running *new* code. The old
poller hits its old output-filename guess, 404s, marks failed. Races
the new code's successful write. Last UPDATE wins; sometimes old wins.

**Fix.** Hard-restart the dev server (`Ctrl-C` the whole `npm run
webapp:dev`, then rerun). If even that doesn't clear it:
`Get-Process node | Stop-Process -Force`, then rerun.

**Prevention going forward.** In principle we could guard finalise
with a `WHERE transcription_status='transcribing' AND
transcription_job_ocid=:expected` on the UPDATE so only the first
writer wins. Not implemented yet — the hard-restart remediation is
cheap enough that adding complexity hasn't earned its keep.

### Library row shows `CHUNKS=0` and `Transcription failed` but search/chat work

**Symptom.** `/corpus` search returns hits from the transcribed video
with real transcript text. Yet the Library page's row shows red `✗`
and CHUNKS=0 for that same artifact.

**Root cause.** Stale client-side cache. The Library's per-row data
and the detail-drawer's per-id data were fetched before the retry /
refetch completed; React's query cache is still serving the old
response. The underlying DB row is `done` and the chunks are indexed
(hence why search can find them).

**Fix.** Hard-refresh the Library page (`Ctrl+F5`). If that doesn't
clear it, `curl http://localhost:7860/api/corpus/artifacts/<id>` to
see ground truth; if the API says `done` and the UI says `failed`,
it's purely a client-cache issue. A proper fix (cache invalidation
on status change) is on the [Future work](#future-work) list.

## Known limitations

- **Transcript may be truncated on long videos.** Observed: a ~30 min
  video produced ~4,300 characters of transcript (~4 chunks), when
  linear speech at that length would normally yield 15,000–25,000
  characters. Likely cause is a per-job duration cap on the
  `WHISPER_MEDIUM` tier in OCI Speech — not documented in a single
  obvious place, and the output JSON gives no truncation signal.
  Search and chat still work on whatever content *was* transcribed,
  but long-form sources aren't fully covered. Workarounds under
  investigation:
  1. Upgrade to `WHISPER_LARGE_V2` (request-only access from Oracle).
  2. Pre-chunk audio with ffmpeg into 10-minute segments and submit
     one Speech job per segment, merging transcripts in our finaliser.
  3. Set `OCI_SPEECH_LANGUAGE` explicitly instead of `auto` — mixed-
     language videos might confuse the detector and trigger early
     giving-up.
- **Multi-replica safety not implemented.** Single-process assumption
  throughout the poller. Scaling out needs `SELECT ... FOR UPDATE
  SKIP LOCKED` on the `transcribing` scan; flagged but not built.
- **Windows `node --watch` + tsx reload flakiness.** See the stale-
  cache troubleshooting entry above. Not ours to fix; just be aware.

## Future work

- **Monthly usage meter** in the UI (count of transcription minutes
  this calendar month) so users can see how close to the free cap
  they are.
- **Auto-language switch** on retry — if Whisper's auto detection
  looks wrong, offer a dropdown before re-submitting.
- **SRT output** alongside plain text for video subtitle workflows.
- **Per-chunk timestamps** — the JSON has per-token start/end times;
  we could store them in `artifact_chunks.metadata` and render
  "jump to 3:42" deeplinks in chat citations.
- **Multi-replica safety** via `SELECT ... FOR UPDATE SKIP LOCKED`
  in the poller if we ever scale out.
