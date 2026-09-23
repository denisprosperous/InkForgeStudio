# Typecheck Scope Diagnosis — worker.test.ts incident (NEG-Ω.REPAIR)

Date: 2026-09-23 · HEAD at diagnosis: `4c094c0` (== origin/main) · Trigger: prior card
reported `typecheck ✔ / STATUS: COMPLETE` while an observer reported 4+ syntax errors in
`apps/forge/test/worker.test.ts` at lines 88, 89, 311.

## 1.1 What `npm run typecheck` executes

`package.json` scripts (verbatim):

```
"typecheck": "tsc -b && tsc --noEmit -p apps/web"
```

- `tsc -b` walks the solution graph in the root `tsconfig.json`, which references only
  **src** projects (`packages/*/tsconfig.json` and `apps/forge/tsconfig.json` all have
  `"include": ["src"]`).
- `tsc --noEmit -p apps/web` covers `apps/web` **including its `test/**`**
(`apps/web/tsconfig.json`has`"include": ["*.mjs", "next-env.d.ts", ..., "test/**/*.ts"]`).
- It does **not** reference `apps/forge/tsconfig.tests.json` or `tsconfig.tests-root.json`.

## 1.2 Raw output of `npm run typecheck`

```
> inkforge-studio@1.0.0 typecheck
> tsc -b && tsc --noEmit -p apps/web

TYPECHECK_EXIT=0
```

Exit 0 → **the scope genuinely misses (forge/packages) test files**; a passing run of this
command cannot testify about them.

Scope proof (`--listFilesOnly` on the forge project that `tsc -b` compiles):

```
FORGE_SRC_EXIT=0
0
TEST_FILES_IN_FORGE_SRC_ABOVE        # grep -c '/test/' → zero test files in program
```

## 1.3 The project that SHOULD run

Which tsconfigs cover test files:

| Workspace tests                               | Covering tsconfig                | In `npm run typecheck`? |
| --------------------------------------------- | -------------------------------- | ----------------------- |
| `apps/web/test`                               | `apps/web/tsconfig.json`         | ✅ yes                  |
| `apps/forge/test`                             | `apps/forge/tsconfig.tests.json` | ❌ no                   |
| `packages/{ai,config,core,covers,db,ui}/test` | `tsconfig.tests-root.json`       | ❌ no                   |

Raw outputs:

```
$ npx tsc --noEmit -p apps/forge/tsconfig.json            # src-only (what -b runs)
FORGE_SRC_EXIT=0
$ npx tsc --noEmit -p apps/forge/tsconfig.tests.json      # src + test
FORGE_TESTS_EXIT=0
$ npx tsc --noEmit -p tsconfig.tests-root.json            # packages src + test
ROOT_TESTS_EXIT=0
```

## 1.4 Verdict on the incident claim

**Reproduced exactly.** Restoring the transient mid-edit line (member key dropped at
line 88 — the intermediate editor state that existed uncommitted for seconds during
NEGENTROPY-Ω.FINAL Task 2.4) yields the trigger's error list verbatim:

```
apps/forge/test/__midedit_repro.test.ts(88,23): error TS1005: '{' expected.
apps/forge/test/__midedit_repro.test.ts(89,5): error TS1109: Expression expected.
apps/forge/test/__midedit_repro.test.ts(311,1): error TS1128: Declaration or statement expected.
apps/forge/test/__midedit_repro.test.ts(311,2): error TS1128: Declaration or statement expected.
```

But it **never entered git**: `git diff 0cd5914..HEAD -- apps/forge/test/worker.test.ts`
shows exactly four intended hunks (remove `debug:` from the test-only recording logger;
make three `JobHandler` overrides `async`) — no malformed line at any commit. Line-by-line
read of 1→311 of the working tree shows the correctly keyed member at line 88 and a single
closing `});` at line 311; `tsc -p apps/forge/tsconfig.tests.json` exits 0; the suite runs
9/9 green (`vitest run apps/forge/test/worker.test.ts`, exit 0).

**One-paragraph diagnosis.** `apps/forge/test/*.ts` is covered only by
`apps/forge/tsconfig.tests.json`, and packages' tests only by `tsconfig.tests-root.json`;
`npm run typecheck` (`tsc -b && tsc --noEmit -p apps/web`) includes neither, so its green
run was **(a) real but scoped wrong** — honest for src + web (including web tests), blind
to forge/package tests by construction. The reported 4 syntax errors were real at the
moment they were observed, but only in the **uncommitted transient working-tree state**
of the Ω.FINAL line-88 edit (dropped `"outline.generate":` member key), whose exact
4-error fingerprint is reproduced above and which was corrected before any commit — so the
card's `typecheck ✔` was neither stale nor fabricated output, yet the _system_ that
produced it could not have caught a committed test-file syntax error of this class.
Minimal fix: option (b) — extend the script to
`tsc -b && tsc --noEmit -p apps/web && tsc --noEmit -p tsconfig.tests-root.json && tsc --noEmit -p apps/forge/tsconfig.tests.json`,
and add a CI sentinel (`scripts/audit-typecheck-scope.ts`) that fails if any workspace's
test sentinel drops out of the programs that command runs.

## Raw evidence appendix

```
$ git log --oneline -6
4c094c0 (HEAD -> main, origin/main) chore(state): terminal ledger
596dee3 chore(state): NEGENTROPY-Ω.FINAL — campaign complete
bc76950 chore(types): full workspace typecheck clean
ea09a03 fix(verify): non-null citation split head in reality check
25cf55b fix(test): pass Panel children via props for required children prop
9ebc3b1 fix(test): non-null column introspection row in migrations test

$ npx vitest run apps/forge/test/worker.test.ts
 ✓ |forge| apps/forge/test/worker.test.ts (9 tests) 7486ms
 Test Files  1 passed (1)
      Tests  9 passed (9)
VITEST_PIPE_EXIT=0

$ .github/workflows/ci.yml (gates)
      - run: npm run build:libs
      - run: npm run lint
      - run: npm run typecheck        # ← widened by NEG-Ω.REPAIR
      - run: npm test
$ .husky/ contains only pre-commit (lint-staged + audit:stubs) — no pre-push hook.
```
