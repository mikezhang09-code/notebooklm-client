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

IAM / policy requirements (in addition to the base corpus set). **Two
statements are required** — the user-group one lets *you* submit jobs,
the service-principal one lets the Speech service actually *read* your
audio from Object Storage and write the transcript JSON back. Missing
the second statement is a silent failure: `CreateTranscriptionJob`
returns a job OCID (success path 1), but the job then flips to
`FAILED` during pre-processing with the message
`INPUT_LIST_READ_ERROR: Unable to read the batch list for job <ocid>`.

```text
# Lets your API-key user group submit / poll / cancel jobs.
Allow group research-corpus-admins to manage ai-service-speech-family in compartment research-corpus

# Lets the Speech service (as its own service principal) read the input
# audio and write the transcript JSON back to the same bucket.
# `manage object-family` because we need GET (input), PUT (output), and
# bucket-level metadata calls. Scoping by `target.bucket.name` looks
# tempting but BREAKS bucket-level ops (BUCKET_READ, LIST_OBJECTS) where
# that variable is null at evaluation time, so Speech can't even find
# the bucket → INPUT_LIST_READ_ERROR. Compartment scope is the correct
# granularity here; use a dedicated compartment for the corpus bucket
# to keep the grant tight.
Allow any-user to manage object-family in compartment research-corpus where request.principal.type='aiservicespeechtranscriptionjob'
```

The same `nblm-corpus-app` user / API key used for Storage + GenAI
signs Speech calls.

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

OCI Speech writes a per-input JSON at:

```
<speechOutputPrefix><namespace>_<bucket>_<flattened-object-name>.json
```

where slashes in the object name become underscores. `speech.ts`
reconstructs this path at submit time and uses it at finalise time;
if the derivation ever misses (a future SDK could rename the
convention), `fetchTranscriptText` tolerates a 404 by returning
`null`, which lands the row as `failed` with a clear error message.

We extract `transcriptions[0].transcription` (the model's own
punctuated join) and fall back to `tokens[].token` if that's missing.
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
| Service-principal policy missing                   | Submit succeeds + returns OCID; job immediately flips to `FAILED` with `INPUT_LIST_READ_ERROR: Unable to read the batch list`. Poller catches this on the next tick. See the IAM policy block above for the fix. |
| Invalid `displayName` (any char outside `[a-zA-Z0-9_-]`) | Submit fails at OCI API level. Not reachable from normal code paths — `sanitiseDisplayName()` in `speech.ts` strips bad chars first. |
| Output object 404 after SUCCEEDED                  | `fetchTranscriptText` returns null → row → `failed` (`empty transcript`). |
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
npx tsx server/corpus/transcribe-backfill.ts           # dry-run: shows targets
npx tsx server/corpus/transcribe-backfill.ts --apply   # submit jobs
# Also retry previously-failed rows:
npx tsx server/corpus/transcribe-backfill.ts --apply --include-failed
```

Selection rule:

```sql
WHERE kind IN ('audio','video')
  AND (transcription_status IS NULL OR transcription_status IN ('skipped','pending'[,'failed']))
```

The script walks oldest-first and is safe to re-run — `enqueueTranscription`
is idempotent and won't re-submit rows already `transcribing` or `done`.

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
