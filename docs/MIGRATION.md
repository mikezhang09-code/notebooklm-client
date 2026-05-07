# Migration Guide — Running `notebooklm-client` on a New Computer

This document lists every file and credential you need to copy (or recreate) when migrating the project to a new machine.

---

## Prerequisites on the New Machine

| Requirement       | Version  | Notes                                          |
|-------------------|----------|------------------------------------------------|
| **Node.js**       | ≥ 20.0.0 | Required by `engines` in `package.json`        |
| **npm**           | ≥ 9      | Ships with Node 20+                            |
| **Git**           | any      | To clone the repository                        |
| **OCI CLI** *(optional)* | any | Only if you need to regenerate wallets/keys |

---

## Step-by-Step Migration

### 1. Clone the repository

```bash
git clone https://github.com/icebear0828/notebooklm-client.git
cd notebooklm-client
```

---

### 2. Copy environment & credential files

Below is the complete inventory of files that are **gitignored** and must be transferred manually.

#### 2.1  `.env` — Project secrets (REQUIRED for corpus features)

| Source path (current machine)      | Destination path (new machine)            |
|------------------------------------|-------------------------------------------|
| `<repo-root>/.env`                 | `<repo-root>/.env`                        |

> [!IMPORTANT]
> The `.env` file contains **passwords and OCIDs** — transfer it securely (e.g. encrypted zip, USB drive, password manager). Never send it over plain email or chat.

**Contents and what to update:**

```dotenv
# ── OCI Fundamentals ──
OCI_CONFIG_FILE=C:/Users/mike_zhang/.oci/config      # ⚠️ UPDATE path
OCI_PROFILE=DEFAULT                                   # usually unchanged
OCI_REGION=ap-tokyo-1                                  # unchanged
OCI_COMPARTMENT_OCID=ocid1.compartment.oc1..aaaa...   # unchanged

# ── Object Storage ──
OCI_NAMESPACE=nrxusfgp0z2e                             # unchanged
OCI_BUCKET=nblm-corpus                                 # unchanged

# ── Generative AI ──
OCI_GENAI_MODEL=cohere.embed-multilingual-v3.0         # unchanged
OCI_GENAI_REGION=ap-osaka-1                            # unchanged
OCI_GENAI_CHAT_MODEL=cohere.command-r-plus-08-2024     # unchanged

# ── OCI Speech ──
OCI_SPEECH_REGION=ap-tokyo-1                           # unchanged

# ── Oracle Autonomous Database ──
ORACLE_USER=CORPUS                                     # unchanged
ORACLE_PASSWORD=<your-password>                        # unchanged (sensitive!)
ORACLE_CONNECT_STRING=nblmcorpus_high                  # unchanged
ORACLE_WALLET_DIR=C:/Users/mike_zhang/.oci/wallets/nblm-corpus  # ⚠️ UPDATE path
ORACLE_WALLET_PASSWORD=<your-wallet-password>          # unchanged (sensitive!)
```

Fields marked **⚠️ UPDATE** contain absolute paths that must be adjusted to the new user's home directory.

---

#### 2.2  `~/.oci/` — OCI CLI Configuration & API Keys (REQUIRED for corpus features)

| Source path                         | Destination path                    |
|-------------------------------------|-------------------------------------|
| `C:/Users/mike_zhang/.oci/config`   | `<NEW_HOME>/.oci/config`           |
| `C:/Users/mike_zhang/.oci/*.pem`    | `<NEW_HOME>/.oci/*.pem`            |

The `config` file typically looks like:

```ini
[DEFAULT]
user=ocid1.user.oc1..aaaa...
fingerprint=xx:xx:xx:...
tenancy=ocid1.tenancy.oc1..aaaa...
region=ap-tokyo-1
key_file=C:/Users/mike_zhang/.oci/oci_api_key.pem   # ⚠️ UPDATE this path too
```

> [!WARNING]
> After copying, open `~/.oci/config` on the new machine and update the `key_file` path to point to the correct location of the private key `.pem` file.

---

#### 2.3  `~/.oci/wallets/nblm-corpus/` — Oracle Wallet (REQUIRED for corpus features)

| Source path                                             | Destination path                              |
|---------------------------------------------------------|-----------------------------------------------|
| `C:/Users/mike_zhang/.oci/wallets/nblm-corpus/`        | `<NEW_HOME>/.oci/wallets/nblm-corpus/`       |

Copy the **entire folder**. It contains the mTLS certificates (`cwallet.sso`, `ewallet.p12`, `tnsnames.ora`, `sqlnet.ora`, etc.) needed for the Oracle Autonomous Database connection.

> [!NOTE]
> The wallet folder path is referenced by `ORACLE_WALLET_DIR` in `.env`. Make sure the two match on the new machine.

---

#### 2.4  `~/.notebooklm/session.json` — NotebookLM Auth Session (OPTIONAL)

| Source path                                    | Destination path                         |
|------------------------------------------------|------------------------------------------|
| `C:/Users/mike_zhang/.notebooklm/session.json` | `<NEW_HOME>/.notebooklm/session.json`   |

This file stores your Google login session for the NotebookLM CLI/webapp.

- **If you copy it**: the CLI works immediately (assuming the session hasn't expired).
- **If you skip it**: just re-authenticate on the new machine by running:
  ```bash
  npx notebooklm login
  # or
  npx notebooklm export-session <session.json>
  ```

---

### 3. Install dependencies

```bash
npm install
```

This also runs the `postinstall` script which downloads `curl-impersonate` into `bin/`.

---

### 4. Verify the setup

```bash
# Test the CLI
npx notebooklm list --transport auto

# Start the webapp
npm run webapp:dev
```

If corpus features are enabled, the server log will print:

```
[corpus] enabled — region=ap-tokyo-1 bucket=nblm-corpus db=nblmcorpus_high ...
```

If any env vars are missing, you'll see:

```
[corpus] disabled — missing env vars: OCI_CONFIG_FILE, ... Set them in .env to enable.
```

The webapp still works without corpus — only corpus-specific features (search, library, upload, chat) are disabled.

---

## Summary Checklist

| #  | What to copy                           | Where it goes on new machine                   | Sensitive? | Required?                |
|----|----------------------------------------|-------------------------------------------------|------------|--------------------------|
| 1  | `.env`                                 | `<repo-root>/.env`                              | ✅ Yes     | Yes (for corpus)          |
| 2  | `~/.oci/config`                        | `<NEW_HOME>/.oci/config`                        | ✅ Yes     | Yes (for corpus)          |
| 3  | `~/.oci/*.pem` (API private key)       | `<NEW_HOME>/.oci/*.pem`                         | ✅ Yes     | Yes (for corpus)          |
| 4  | `~/.oci/wallets/nblm-corpus/`          | `<NEW_HOME>/.oci/wallets/nblm-corpus/`          | ✅ Yes     | Yes (for corpus)          |
| 5  | `~/.notebooklm/session.json`           | `<NEW_HOME>/.notebooklm/session.json`           | ✅ Yes     | Optional (can re-login)   |

---

## Paths That Need Updating After Copy

After copying all files, update these **absolute paths** to match the new machine:

1. **`.env`** → `OCI_CONFIG_FILE` — e.g. change `C:/Users/mike_zhang/` to `C:/Users/new_user/`
2. **`.env`** → `ORACLE_WALLET_DIR` — same path prefix change
3. **`~/.oci/config`** → `key_file` — update the private key path

---

## Optional Environment Variables

These are **not** in `.env` but can be set in your shell or added to `.env` if needed:

| Variable                          | Default                    | Purpose                                             |
|-----------------------------------|----------------------------|-----------------------------------------------------|
| `PORT`                            | `7860`                     | HTTP port for the webapp server                     |
| `HOST`                            | `0.0.0.0`                 | Bind address for the server                         |
| `HTTPS_PROXY` / `ALL_PROXY`      | *(none)*                   | Proxy for outbound requests                         |
| `NOTEBOOKLM_HOME`                | `~/.notebooklm`           | Custom directory for session & config files         |
| `NOTEBOOKLM_DEBUG`               | *(unset)*                  | Set to any value to enable debug-level logging      |
| `NOTEBOOKLM_AUTH_JSON`           | *(none)*                   | Inline session JSON (alternative to `session.json`) |
| `NOTEBOOKLM_CLIENT_TIMEOUT_SECONDS` | *(default)*             | Override HTTP timeout for the client                |
| `NBLM_JOB_TTL_MS`               | `1800000` (30 min)         | Job store time-to-live                              |
| `OCI_SPEECH_ENABLED`             | `true`                     | Set `false` to disable audio transcription          |
| `OCI_SPEECH_LANGUAGE`            | `auto`                     | Force Whisper language (`zh`, `en`, `ja`, etc.)     |
| `OCI_SPEECH_OUTPUT_PREFIX`       | `transcripts/`             | Object Storage prefix for transcription output      |
| `CORPUS_MAX_TRANSCRIBE_MINUTES`  | `120`                      | Skip audio longer than this                         |
| `CORPUS_TRANSCRIBE_POLL_MS`      | `30000`                    | Transcription poller interval                       |

---

## Docker Alternative

If you prefer Docker, no manual file copying is needed beyond the `.env` and OCI credentials:

```bash
docker compose run notebooklm list --transport auto
```

Mount points defined in `docker-compose.yml`:
- `~/.notebooklm` → `/root/.notebooklm` (session data)
- `./output` → `/output` (generated files)

For corpus features in Docker, mount your `.oci` directory and wallet as additional volumes.
