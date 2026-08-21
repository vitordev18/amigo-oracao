# Amigo Oração

Command-line tool to run the draw for an *Amigo Oração* event (the same format as Secret Santa) and notify each participant by email, individually and confidentially.

The draw is mathematically verified before any message goes out, and sending is fault-tolerant: if the process is interrupted midway, it can be resumed without duplicating messages and without changing the result already drawn.

Written in Node.js with no required dependencies.

> **A note on language.** The code, commands, and filenames are in English; the messages shown to the operator and the email content are in Portuguese.

---

## Quick start

Lost track of where you are? This command tells you where you stand and what to do next:

```
node --env-file=.env src/cli.js status
```

The full sequence, in order:

| # | Command | What it does | Confirm before moving on |
|---|---|---|---|
| 1 | `validate --mx` | checks the list | zero blocking errors |
| 2 | `test --to you@email.com` | sends a sample to yourself | it arrived, didn't land in spam, accents and logo correct |
| 3 | `draw` | draws and seals the result | the participant count matches |
| 4 | `send` | **simulates** the send | the queue size and the recipients |
| 5 | `send --confirm` | actually sends | the final summary lists no failures |
| 6 | `report` | status of each person | — |

All are prefixed with `node --env-file=.env src/cli.js`. Steps 1 and 2 can be repeated freely: neither writes a file nor changes the draw.

### Where am I?

You can tell just by looking at the `output/` folder:

| Situation | You're before step |
|---|---|
| `output/` empty | 3 — not drawn yet |
| `draw.json` exists, `sends.jsonl` doesn't | 4 — drawn, nothing sent |
| both exist | 5 or 6 — run `report` to see who's left |

The `status` command does this reading for you and also prints the next command.

### Testing with a fake list

To rehearse the whole flow while receiving everything in your own inbox, use sub-addresses: Gmail ignores anything after the `+` when delivering, but the validator treats them as distinct addresses.

```csv
name,email,exclude
Ana Test,you+ana@gmail.com,
João Test,you+joao@gmail.com,
Maria Test,you+maria@gmail.com,
```

---

## The problem

A draw like this looks trivial and isn't. Three things tend to go wrong:

**The draw itself.** Shuffling a list isn't enough: you have to guarantee that no one draws themselves, that no one is drawn twice, and that no one is left out. Doing it "by hand" with paper works; doing it with code requires a correct algorithm and an independent verification of the result.

**Email delivery.** A mistyped address, a nonexistent domain, or a blown provider quota means a person simply receives nothing — and, with no record, the organizer only finds out when someone complains.

**Failure midway.** This is the most serious one. If the connection drops at participant 20 of 30 and the process is restarted from scratch, a new draw is generated and the ten people who had already received become inconsistent with the remaining twenty. The event is silently and irreversibly corrupted.

This project handles all three cases explicitly.

---

## Design principles

**Draw and send are separate phases.** The result is written to disk and sealed *before* the first email. The send command never draws; it only reads what has already been decided. This makes resumption safe by construction.

**Fail early and loud.** Errors in the participant list stop execution before the draw, not during sending. Each step is a door that only opens if the previous one passed.

**State lives on disk, not in memory.** Each send is recorded immediately after it happens. A power loss loses at most the record in progress.

**Nothing is irreversible without explicit confirmation.** The send command simulates by default; it only sends for real with an additional flag. The draw refuses to overwrite an existing result.

**Cryptographic randomness.** The shuffle uses `crypto.randomInt` (CSPRNG), never `Math.random()`, whose sequence is predictable.

---

## Architecture

```
participants.csv
       │
       ▼
   [validate] ────────────────── DNS (optional)
       │  fails ⇒ stops here
       ▼
   [draw] ─────▶ output/draw.json        (sealed result + SHA-256)
       │
       ▼
   [send]  ────▶ Brevo / Resend / SMTP
       │
       └───────▶ output/sends.jsonl      (incremental log, append-only)
                        │
                        ▼
                    [report]
```

The `test` command sits outside this flow: it validates the send configuration in isolation, without touching the list, the draw, or the log.

### File structure

```
amigo-oracao/
├── participants.csv           input: name, email, exclude
├── participants.example.csv   template with fictional data
├── .env                       configuration and credentials (do not commit)
├── assets/
│   └── logo.png               image shown in the email header
├── src/
│   ├── cli.js                 command parsing and orchestration
│   ├── participants.js        CSV reading and list validation
│   ├── draw.js                derangement algorithm and formal verification
│   ├── template.js            email body (HTML and plain text)
│   ├── mailer.js              send providers, error classification and retry
│   ├── dispatch.js            queue, incremental log and resume logic
│   └── utils.js               CSV parser, terminal utilities
├── tests/
│   └── invariants.js          proof of the draw invariants
└── output/
    ├── draw.json              sealed result (confidential, replaceable)
    └── sends.jsonl            send log, cumulative (does not contain the pairs)
```

---

## Draw guarantees

The result is a **derangement**: a permutation with no fixed points. The guaranteed properties are:

| Property | Meaning |
|---|---|
| σ(A) ≠ A | no one draws themselves |
| σ is a bijection | each person draws exactly one |
| σ⁻¹ is a bijection | each person is drawn by exactly one |
| \|σ\| = n | no one is left out, no one appears twice |
| σ respects constraints | forbidden pairs (couples, same household) don't occur |

There are two modes, chosen by configuration:

**`cycle`** (default) — shuffles the list and links each person to the next, closing a single ring: A→B→C→…→A. For n ≥ 2 a fixed point is structurally impossible, and the format eliminates reciprocal pairs (A↔B), which in small groups give the surprise away immediately. The distribution is uniform over the (n−1)! possible cycles.

**`free`** — uniform derangement over all !n derangements, obtained by rejection sampling. Allows reciprocal pairs and multiple cycles. The expected number of attempts is approximately *e* ≈ 2.72.

Regardless of the mode, the result goes through a **formal verification** before being written. Any violation throws an exception and aborts the process — the program prefers to deliver no result over delivering an invalid one.

The suite in `tests/invariants.js` exercises these invariants across thousands of draws, including lists with constraints and one impossible-constraint case, which must fail with a clear message instead of returning a degraded result.

---

## Delivery guarantees

**Upfront list validation.** Required fields, address syntax, duplicates, nonexistent constraint targets, and common domain typos (`gmial.com`, `hotmial.com`, `outlok.com`, and the like). Optionally queries DNS to confirm the domain accepts mail.

**Send-time error classification.** 4xx responses (except 429) are treated as permanent: the program doesn't insist, records it, and moves on. 429, 5xx, and network failures are temporary and trigger a retry with exponential backoff and jitter (1s → 2s → 4s → 8s).

**Rate control.** A configurable interval between messages avoids hitting the provider's rate limit.

**Incremental log.** Each result is written to `output/sends.jsonl` right after the send, in append mode. The JSONL format is resistant to truncation: a line corrupted by an abrupt crash doesn't invalidate the others.

**Idempotent resume, scoped per draw.** On re-running the send, anyone marked `sent` is skipped and anyone marked `failed` is retried. Running the command twice never duplicates messages.

Each log record carries the fingerprint of the draw that produced it, and the queue only considers records from the current draw. Without this, an old test send would make the system silently skip a real person who shared the same address — the participant would never receive anything and no one would notice. Records from other draws are counted and reported on screen, not silently discarded.

**Integrity seal.** The `draw.json` carries a SHA-256 fingerprint over addresses and names. If the file is edited by hand, sending is blocked before the first message.

**Stale-list detection.** If `participants.csv` changes after the draw, sending stops and shows exactly who was added or removed — instead of silently ignoring someone who was added to the list.

---

## Command reference

All follow the format:

```
node --env-file=.env src/cli.js <command> [flags]
```

There are also shortcuts via `npm run status`, `npm run validate`, `npm run draw`, `npm run send`, `npm run report`, and `npm run email-test`. `npm test` runs the invariants suite; it doesn't send email.

### `status`

Summarizes what point of the process the project is at and prints the next command to run. It changes nothing — safe to run at any time, including in the middle of an interrupted send.

- **Reads:** `participants.csv`, `.env`, `output/draw.json`, `output/sends.jsonl`
- **Writes:** nothing

Checks four things in order: whether the list exists and is valid, whether credentials are configured, whether a sealed draw already exists, and how many sends have been recorded. The suggested next step accounts for the actual state of the files — if there are failures in the log, for example, it points to resending the pending ones instead of the full send.

### `validate`

Checks the participant list. It's the entry gate of the process and produces no side effects — it doesn't write files and doesn't contact the email provider.

- **Reads:** `participants.csv`
- **Writes:** nothing
- **Network:** DNS only, and only with `--mx`
- **Exits with code 1** if there's a blocking error

Distinguishes two severities. *Blocking errors* prevent the draw: empty name or email, invalid syntax, duplicate address, domain with a known typo, list with fewer than two participants. *Warnings* are informational and don't stop it: a constraint pointing to someone outside the list, a domain with no MX record, an inconclusive DNS query.

Flag `--mx`: queries the MX records of each domain. Distinguishes a conclusive DNS response (`ENODATA`, `ENOTFOUND`) from a query failure (timeout, SERVFAIL, corporate network) — only the former is attributed to the address. Also accepts implicit MX: per RFC 5321, a domain with an A record receives mail on the host itself.

### `test`

Sends a sample message with fictional data to an address of your choice. It's the only command that exercises the full send chain in isolation, and it serves to validate credentials, IP authorization, sender verification, and message appearance before any real send.

- **Reads:** `.env`
- **Writes:** nothing — doesn't record to the log or consume the draw
- **Required flag:** `--to <address>`

The subject gets a `[TESTE]` prefix and the content uses fictional names, so no real result is revealed.

### `draw`

Runs the draw, formally verifies the result, and seals it to disk.

- **Reads:** `participants.csv` and the configured mode
- **Writes:** `output/draw.json`
- **Network:** none
- **Exits with code 1** if the list has a blocking error or if a previous draw already exists

Refuses to overwrite an existing `draw.json`, because redoing the draw after emails have gone out breaks the event's consistency. The `--force` flag removes this protection and should only be used when you're certain no send has been made.

At the end it prints an audit that proves the result's validity **without revealing the pairs**: total participants, mode, number of attempts, count and size of cycles, number of reciprocal pairs, and the fingerprint. The organizer can confirm everything is correct and still take part in the event knowing nothing.

### `send`

Walks through the sealed result and notifies each participant.

- **Reads:** `output/draw.json`, `output/sends.jsonl`, `participants.csv` and `.env`
- **Writes:** `output/sends.jsonl` (append, one line per attempt)
- **Exits with code 1** if there's any failure

Before sending, it revalidates the draw invariants, checks the fingerprint, and compares the current list with the one that was drawn; any divergence stops execution.

**Simulates by default.** Without the `--confirm` flag, it walks the entire queue, shows exactly what would happen, and doesn't contact the provider or write to the log. With `--confirm`, it sends for real.

Builds the queue by subtracting anyone already marked `sent`. At the end it presents a summary with the total, how many were skipped, how many went out now, and — most importantly — the named list of who did **not** receive, with the reason for each failure.

### `report`

Shows the individual status of each participant from the log.

- **Reads:** `output/sends.jsonl`
- **Writes:** nothing

Consolidates multiple attempts for the same address, keeping the most recent. Shows name, address, status, and, on failure, the error message returned by the provider.

Considers only the records from the currently sealed draw. Sends from previous draws remain in the file but don't appear in the report.

### `node tests/invariants.js`

Runs the invariants suite for the draw algorithm. Doesn't depend on configuration or network. Useful after any change to `src/draw.js`.

---

## Execution sequence

The order isn't arbitrary: each step is a door that validates a distinct class of problem, from the cheapest to fix to the most expensive.

At any point, `status` shows where you left off.

**1. `validate --mx`** — fixes data problems while they're still just a spreadsheet row. Proceed only with zero blocking errors; read the warnings and decide case by case.

**2. `test --to <your email>`** — fixes configuration problems before they affect the group. Confirm the message arrived, didn't go to spam, the accents are correct, the logo loaded, and the layout works on mobile.

**3. `draw`** — from here the result is sealed. Check the printed audit: the participant count should match what you expect and the mode should be the one you want.

**4. `send`** — simulation. Confirm the queue size and the absence of surprises in the recipient list.

**5. `send --confirm`** — real send. Follow along to the final summary.

**6. `report`** — if there are failures, fix the cause and repeat step 5; only the pending ones will be processed.

**7. Wrap-up** — after the event, remove or archive `output/draw.json`, the only file capable of revealing the pairs.

An operational recommendation: run steps 5 and 6 in a single session, without switching network or VPN midway. Email providers tend to tie authorization to the source IP address, and a switch during sending causes authentication failures halfway through the queue. If it happens, the process is recoverable — but it's simpler to avoid.

---

## The output files

The two files in `output/` have opposite life cycles, and confusing them is the source of a hard-to-spot bug.

### `draw.json` — one only, replaced

There is at most one sealed draw at a time. The `draw` command refuses to run when the file already exists; with `--force`, it is **overwritten** and the previous result is lost for good. There's no versioning or automatic backup.

### `sends.jsonl` — cumulative, never replaced

Each send attempt appends a line to the end of the file. Nothing is deleted, not even when a new draw is generated. This is deliberate: the log is the memory of who has already been notified, and deleting it during a send would make the system resend messages to those who had already received.

Each line is an independent JSON object:

| Field | Content |
|---|---|
| `at` | date and time of the attempt (ISO 8601) |
| `draw` | fingerprint of the draw that produced the send |
| `name`, `email` | recipient |
| `status` | `sent`, `failed`, or `simulated` |
| `attempts` | how many attempts were made |
| `messageId` | identifier returned by the provider |
| `error` | error message, when present |

The `draw` field is what lets records from different draws coexist in the same file without interference. Records generated before this field was introduced are treated as belonging to another draw — and therefore ignored.

### Between one event and the next

To start from scratch, delete both files. To keep history, rename them before starting over (`draw-2026.json`, `sends-2026.jsonl`); the program only reads the default names and ignores the rest.

**Never delete `sends.jsonl` in the middle of a real send.** Without it, resumption loses track of who already received and everyone is notified again.

---

## Configuration

Reference for the variables read from `.env`.

| Variable | Purpose |
|---|---|
| `PROVIDER` | `brevo`, `resend` or `smtp` |
| `BREVO_API_KEY` / `RESEND_API_KEY` | provider credential via API |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | SMTP-mode credentials |
| `SENDER_NAME`, `SENDER_EMAIL` | sender identity |
| `REPLY_TO` | reply-to address |
| `EVENT_NAME`, `REVEAL_DATE`, `VERSE` | message content |
| `LOGO_URL` | public URL of the logo shown in the header |
| `DRAW_MODE` | `cycle` or `free` |
| `SEND_INTERVAL_MS` | wait between sends |
| `MAX_SEND_ATTEMPTS` | attempts per recipient before giving up |
| `PARTICIPANTS_FILE` | alternative path to the CSV |

SMTP mode requires `npm install nodemailer`; the others require no installation.

**Compatibility.** The earlier Portuguese names are still accepted as an alternative (`PROVEDOR`, `REMETENTE_EMAIL`, `EVENTO_NOME`, `MODO_SORTEIO` with values `ciclo`/`livre`, among others), as well as the `participantes.csv` file and the `nome`/`excluir` headers. Old configurations keep working unchanged.

### CSV format

Columns `name`, `email`, and `exclude`. The third is optional and prevents certain people from drawing each other — useful for couples and members of the same household. Accepts multiple addresses separated by `|`. The column separator can be a comma or a semicolon, detected automatically. Files generated by spreadsheets should be saved in UTF-8 to preserve accents.

### Message customization

The email body is isolated in `src/template.js`, in two versions: HTML with inline styles and plain text. Both are sent together — clients that don't render HTML show the text alternative, which also improves the antispam rating. **Both must be edited together:** changing only one makes the recipient receive content different from what was reviewed.

The palette is concentrated in the `BRAND` constant at the top of the file. Changing the brand colors is a single-block edit.

### Logo in the header

`LOGO_URL` must point to a **public, stable URL**. Base64 or attached images won't work: Gmail and Outlook block them. If the variable is empty, the header renders without an image and stays intact — the layout doesn't depend on the logo loading, since many clients block images by default.

---

## Security and privacy

The draw never leaves the organizer's machine. There's no server, database, or intermediary service beyond the email provider.

`output/draw.json` is the only artifact that reveals who drew whom. The send log records only recipient and status, never the draw content — so it can be shared with other organizers without spoiling the event.

`.env`, `participants.csv`, and `output/` are listed in `.gitignore`. The `.env` contains an API credential and must never be committed, attached, or shared; the CSV contains third parties' names and emails and gets the same treatment.

---

## Exit codes

| Code | Situation |
|---|---|
| 0 | success |
| 1 | validation, integrity, or configuration error, or a failure in some send |

Suitable for chaining in scripts: `validate && draw`.

## Requirements

Node.js 20.6 or higher (the `--env-file` flag was introduced in that version). No required dependencies.
