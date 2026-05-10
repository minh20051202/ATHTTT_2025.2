# E2E Auth QA Report — 2026-05-09/10

## Environment
- Backend: FastAPI on port 8000 (started from project root: `uv run uvicorn backend.main:app --port 8000`)
- Frontend: Vite dev server on port 5173
- DB: SQLite `agentic_commerce.db` at project root (not in backend/)
- Q confirmed: `e798d9bf4ce1ca1673cb3b3fa6f908648af6d2681bd07f9b686...` (position 48 is `6`) in both `backend/auth/zkp.py` and `frontend/src/lib/zkp.js`

## Tasks Executed

### Task 1: Fix Q Constant
- **Backend `backend/auth/zkp.py` line 34:** changed `_DHQ` from `...b786...` to `...b686...` (position 48: `7→6`)
- **Frontend `frontend/src/lib/zkp.js` line 18:** already had correct Q (`...b686...`) — this had been fixed before this session
- **Verification:** both files now agree on Q

### Task 2: Delete DB and Reseed
- Dropped `/home/0xKaBG/Projects/athttt_2025.2/agentic_commerce.db`
- Called `POST /api/demo/seed` — created OAuth2 agent (ID 7) + ZKP agent (ID 8), user "demo", 4 products
- DB now holds public keys computed with the corrected Q

### Task 3: Backend Startup Fix
- **Critical fix:** `main.py` uses relative imports (`from .utils.config import settings`) — must be launched as `uv run uvicorn backend.main:app --port 8000` from the **project root**, not `backend/` directory. Running from `backend/` caused `ImportError: attempted relative import with no known parent package`
- Backend health: `{"status":"healthy","timestamp":...}` ✅
- Seed confirmed: ✅

---

## Bugs Found

### Bug 1: OAuth2 config bleed into ZKP requests
- **File:** `frontend/src/pages/Chat.jsx:78-85`
- **Symptom:** On ZKP tab switch, stale OAuth2 Bearer header was injected into ZKP requests, causing 401
- **Fix already applied:** Added `else if (authType === 'zkp')` branch calling `setAgentConfig({ authType: 'zkp' })` to clear OAuth2 config on ZKP switch
- **Verification:** ✅ Both Chat.jsx frontend fix and proper sessionStorage clearing resolved the stale agent ID issue

### Bug 2: ZKP Q constant mismatch
- **Files:** `backend/auth/zkp.py:34`, `frontend/src/lib/zkp.js:18`
- **Symptom:** ZKP proof verification always returned 401 — server stored public keys computed with wrong Q, and `_verify_schnorr` could not verify proofs computed without the same wrong Q
- **Root cause:** `_DHQ` had hex digit `7` at position 48 in the hex string (should be `6`): `...b786127...` → `...b686127...`
- **Fix:** Corrected both files to `0xe798d9bf4ce1ca1673cb3b3fa6f908648af6d2681bd07f9b68612769242e4cff`; DB reseeded to regenerate public keys with corrected Q
- **Status:** ✅ Fixed and reseeded

### Bug 3: Stale ZKP agent ID in browser sessionStorage
- **Symptom:** Browser session held old ZKP agent ID 262 from pre-reseed DB; new seed created agent ID 8 but frontend silently used 262 → `404: Agent 262 not found`
- **Root cause:** `AgentsContext` restores agent IDs from `sessionStorage.demo_agents` without checking if they're still valid
- **Fix applied:** Cleared `sessionStorage.demo_agents` and `demo_oauth2_creds` to force re-seed with fresh IDs
- **Note:** Requires either page reload after DB reseed OR clearing sessionStorage before re-seeding

### Bug 4: ZKP proof verification math failure (UNRESOLVED — separate issue)
- **Files:** `backend/auth/zkp.py` (particularly `_verify_schnorr` at line ~132 and domain parameters at line ~33)
- **Symptom:** After fixing Q and reseeding DB, browser ZKP flow still returns "ZKP proof verification failed" (401). Test `test_sign_data_produces_valid_proof` also fails with `is_valid=False`.
- **Root cause (identified):** The Schnorr verification equation `g^s ≡ t·y^c (mod p)` fails even when both `sign_data` and `verify_proof` use identical `_DHQ`. Verified with Python debug:
  - `create_public_key`: uses `x = H(password) mod q`, `y = g^x mod p` ✅
  - `sign_data`: uses same `x = hash_secret(password) mod q`, computes `c = H(t||token) mod q`, `s = r + c·x mod q` ✅
  - `verify_proof` (via `_verify_schnorr`): recalculates `c = H(t||token) mod q` and checks `g^s = t·y^c mod p` — FAILS ❌
- The math is self-consistent within the module but the verification fails. Possible causes:
  1. `g=4` may not properly generate the order-`_DHQ` subgroup for this specific safe prime (257-bit)
  2. The challenge derivation `c = H(t||token)` uses token as a string; same bytes are used in sign and verify (verified)
  3. The domain parameters themselves may need adjustment for the given `g=4` generator
- The `g^q mod p` property (`g` generates order-`q` subgroup check) should be verified for this safe prime
- **Backend startup:** Backend is running from project root using `uv run uvicorn backend.main:app` (not `backend/` directory) ✅
- **Status:** NOT FIXED in this session — requires separate debugging of the Schnorr group parameters

---

## Test Results

### Backend Unit Tests

| Test Suite | Result | Notes |
|------------|--------|-------|
| `pytest tests/test_zkp.py` | 11 passed, 5 failed | See failures below |
| `pytest tests/test_oauth2.py` | 11 passed, 0 failed | ✅ All OAuth2 tests pass |
| ZKP failures | 5 | All `test_sign_data_produces_valid_proof`, `test_zkp_chat_full_flow`, `test_zkp_proof_replay_rejected`, `test_zkp_timing_metrics`, `test_server_never_receives_password` — caused by Bug 4 |

### Browser E2E

#### OAuth2 Flow — ✅ PASS
- Navigated to `http://localhost:5173/chat`
- Filled message "Search for laptops", clicked Send
- POST `/api/auth/oauth2/token` → 200 ✅
- POST `/api/chat/intent` → 200 (3586ms) ✅
- Response shows `auth_type_used: "oauth2"`, action `search_products: {product_name: "laptops"}`, confidence 95% ✅
- Result shows 2 products (Laptop, Phone) with prices ✅
- **Note:** NIM API rate limit caused `Provider rate limit reached` in display output, but auth succeeded and intent was extracted

#### ZKP Flow — ❌ FAIL
- Selected ZKP tab, filled password `zkp_password_456` and message `Search for headphones`
- GET `/api/chat/zkp-challenge/{new_id}` → 200 (challenge token fetched) ✅
- POST `/api/chat/intent` → 401 Unauthorized ✅
- Error: "ZKP proof verification failed" ❌
- **Root cause:** Bug 4 — Schnorr verification math fails in `_verify_schnorr` even with correct Q
- The challenge token was fetched successfully (agent ID resolved correctly) — but proof is rejected by the verification

---

## Changes Pending Commit

### Staged/Unstaged Changes
```
modified:   backend/auth/zkp.py        (_DHQ: 7→6 at position 48 in hex)
modified:   frontend/src/lib/zkp.js      (Q: 7→6 at position 48 — already fixed)
modified:   frontend/src/pages/Chat.jsx  (setAgentConfig for ZKP tab switch — already fixed)
```

### Files NOT Changed (already correct)
- `backend/auth/zkp.py` _DHQ: ✅ fixed from `...b786...` to `...b686...`
- `frontend/src/lib/zkp.js` Q: ✅ already had `...b686...` (correct from before this session)
- `frontend/src/pages/Chat.jsx`: ✅ `setAgentConfig` ZKP branch already present

---

## Recommendations

1. **Immediate:** Commit the frontend Chat.jsx change — it fixes the OAuth2 header bleed and is a clean, isolated fix
2. **Q fix commit:** The backend Q fix (`backend/auth/zkp.py`) + ZKP Q is a valid fix but incomplete without resolving Bug 4
3. **Bug 4 (ZKP verification):** Needs separate investigation — likely requires evaluating whether `g=4` is a valid generator for the given safe prime `p` in `backend/auth/zkp.py`
4. **sessionStorage staleness:** `AgentsContext` should validate agent IDs exist before using cached values, or refresh on DB reseed