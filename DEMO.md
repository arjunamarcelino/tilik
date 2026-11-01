# Tilik — Demo Walkthrough (5–7 min)

A repeatable demo of the evidence-integrity story: **fraud detected, evidence tamper-evident, and nothing
over-flagged.** Assumes the stack is deployed and seeded (see `DEPLOY.md` §4–§5). **Synthetic data only.**

**Before you start**

- Portal: **https://tilik.techjuna.cloud** (the deployed demo; `TILIK_DOMAIN=tilik.techjuna.cloud`). On a
  real domain the Let's Encrypt cert is trusted; a local `TILIK_DOMAIN=localhost` build uses an internal-CA
  cert that triggers a one-time browser warning (expected — click through).
- Log in as the reviewer (`SEED_REVIEWER_EMAIL` / its password).
- Have the Anthropic key working (the grounded summary is step 5) — confirm `claude-opus-4-8` is enabled.

---

## The narrative

### 1 · The queue (30s)

Land on the **dashboard**: counts by severity/status. Open **Cases** — the list is ranked
`severity DESC, createdAt DESC`. "Every case here was raised by an automated detector over imported JKN
claims; the reviewer's job is to adjudicate, not to hunt."

### 2 · A flagged case (90s)

Open a **HIGH**-severity case. Walk the three detector signals that can appear:

- **Repeat billing** — the same non-repeatable procedure billed on ≥2 claims, same patient, same day.
- **Cloning** — near-identical SOAP narrative copied across episodes (TF-IDF cosine over the corpus).
- **PERTENTANGAN BUKTI (evidence contradiction)** — a surgical procedure billed with **no supporting
  evidence**; note the `bertentangan` contradiction link on the evidence.

Point at the detector **reasons** on each finding: "these aren't black-box scores — each says _why_."

### 3 · Evidence integrity (60s)

Open the case's **evidence** panel. Each record shows an integrity state: the system recomputes
`sha256(object bytes)` and compares it to the **append-only** `contentHash` recorded at import. "The hash
lives in a table the application role cannot UPDATE or DELETE — tampering with a file is detectable, and
tampering with the record of it isn't possible for the app." (Payload-backed evidence shows `display_only`
— its hash is over a wrapper; file-backed evidence verifies the raw bytes.)

### 4 · The precision story — what is NOT flagged (60s)

This is the credibility beat. Show (or describe) the **exception cases the detectors correctly leave clean**:

- Repeat-billing **exception codes** (legitimately repeatable procedures) — not flagged.
- The deliberately **unbuilt `diagnosis → lab` rule** — because it would false-positive on every
  diagnosis-without-lab episode.
- Surgical procedures **with timely supporting evidence** — clean; support captured after submission is only
  `NEEDS_MORE_INFO`, never auto-flagged as contradiction.

"It's not just catching fraud — it's not crying wolf. Precision is the product."

### 5 · Grounded AI summary (60s)

Click **Generate summary**. It **streams token-by-token** (verify in the browser — it should render
incrementally, not as one blob). "This is Claude, but grounded strictly in the on-screen evidence — it's an
aid, it renders no verdict, and it shares the exact case context the detail page uses, so it can't drift from
what you see. The evidence is injection-fenced, so an importer-supplied value can't steer it."

### 6 · The decision (45s)

Open the **decision** panel. Pick a verdict (Confirm fraud / Not fraud / Needs more info) and confirm. "The
verdict is written once and is immutable — the reviewer's decision is as tamper-resistant to the app as an
audit row." Re-opening shows the panel locked.

### 7 · The audit trail (30s)

Scroll to the case **timeline**: `IMPORT → DETECT → VIEW_CASE → GENERATE_SUMMARY → DECIDE`, each append-only.
"Every action — import, detection, every view, the AI summary, the decision — is on an immutable ledger.
That's the whole thesis: evidence you can trust, and a trail you can't rewrite."

---

## Reset between runs

The demo is read-mostly; a decision is terminal per case. To get a clean slate, re-seed onto a fresh DB
(synthetic data — safe to wipe):

```bash
cd infra
./compose.sh -f docker-compose.prod.yml down            # keep volumes to preserve certs
# to fully reset data (drops pgdata + minio): add -v, then redeploy + re-seed
./compose.sh -f docker-compose.prod.yml up -d
./compose.sh -f docker-compose.prod.yml --profile seed run --rm seed
```

## Known gap (be honest if asked)

All seeded **fraud** cases are payload-backed, so the verified-file-download + 409-on-tamper path isn't
reachable from the seeded UI (file-backed evidence sits on clean episodes). It's a seed-data limitation, not
a missing feature — the download/verify code path exists and is exercised by the clean episodes.
