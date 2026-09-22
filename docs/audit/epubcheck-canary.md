# EPUBCheck canary (completion gate G-zeta)

Real JRE, no fail-soft. This is the V13 evidence artifact.

## Runtime

- JRE: Eclipse Temurin 21.0.12.1+1 LTS (user-space install at `~/.local/jre21/jdk-21.0.12.1+1-jre`, no root required)
- EPUBCheck: 5.2.1 via `sh scripts/fetch-assets.sh` → `docker/epubcheck-5.2.1/epubcheck.jar`

## Canary manuscript

Generated from `@inkforge/core` `buildEpub` (two chapters, final status):
`/tmp/canary.epub` (5,313 bytes, `epubcheck-canary-inkforge-qa.epub`).

## Command

```
~/.local/jre21/jdk-21.0.12.1+1-jre/bin/java \
  -jar docker/epubcheck-5.2.1/epubcheck.jar /tmp/canary.epub
```

## Result (2026-09-22)

```
Validating using EPUB version 3.3 rules.
No errors or warnings detected.
Messages: 0 fatals / 0 errors / 0 warnings / 0 infos
EPUBCheck completed
exit code: 0
```

Gate G-zeta: PASS. In the battery this is step V13; the validator wrapper
(`packages/core/src/validate/epubcheck.ts`) picks up the same jar through its
default scan path or `EPUBCHECK_JAR`.
