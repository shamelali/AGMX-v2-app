#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# verify_am_workflow.sh — prove the format-patch / git-am workflow behaves as
# claimed, including the three outcomes that matter:
#   A. patch conflicts with moved upstream  -> git am stops, nothing is lost
#   B. patch applies cleanly                -> new commit on top of upstream
#   C. patch already applied                -> "No changes -- Patch already applied"
#
# Builds its own fixtures in /tmp. Touches nothing else.
# ---------------------------------------------------------------------------
set -uo pipefail
pass=0; fail=0
ok(){ printf '  \033[32mOK  \033[0m %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[31mFAIL\033[0m %s\n' "$1"; fail=$((fail+1)); }
chk(){ local r; set +o pipefail; eval "$2" >/dev/null 2>&1; r=$?; set -o pipefail
       [ $r -eq 0 ] && ok "$1" || no "$1"; }

R=/tmp/amverify; rm -rf "$R"; mkdir -p "$R"; cd "$R" || exit 1
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=a@b.c
export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=a@b.c

echo "══ fixtures ══"
git init -q up && cd up
mkdir -p tools; printf 'v1\n' > theme.js; printf 'check v1\n' > tools/check.sh
git add -A; git commit -qm base
printf 'v2 main\n' > theme.js; printf 'check v2\n' > tools/check.sh
git add -A; git commit -qm "main advances"
cd "$R"

# local: stale + one commit touching a moved file (conflict case)
git clone -q up localA && cd localA && git reset -q --hard HEAD~1
printf 'local check\n' > tools/check.sh
git add -A; git commit -qm "feat: touches a file main moved"
git format-patch -q -1 HEAD -o "$R/pA"
cd "$R"

# local: stale + one commit touching only a new file (clean case)
git clone -q up localB && cd localB && git reset -q --hard HEAD~1
printf 'brand new\n' > newthing.js
git add -A; git commit -qm "feat: isolated addition"
git format-patch -q -1 HEAD -o "$R/pB"
cd "$R"
echo "  built"

echo "── A: conflicting patch ──"
cd "$R" && git clone -q up liveA && cd liveA
chk "git am stops (non-zero)"      "! git am --3way '$R'/pA/*.patch"
chk "reports the conflicted file"  "git status --short | grep -q 'UU tools/check.sh'"
chk "upstream HEAD unchanged"      "[ \$(git rev-parse HEAD) = \$(git -C '$R'/up rev-parse HEAD) ]"
chk "--abort restores clean state" "git am --abort && ! test -d .git/rebase-apply"
cd "$R"

echo "── B: clean patch ──"
git clone -q up liveB && cd liveB
chk "git am succeeds"              "git am --3way '$R'/pB/*.patch"
chk "new commit on top of upstream" "git log --oneline -1 | grep -q 'isolated addition'"
chk "parent is upstream HEAD"      "[ \$(git rev-parse HEAD~1) = \$(git -C '$R'/up rev-parse HEAD) ]"
chk "file present"                 "test -f newthing.js"
cd "$R"

echo "── C: already applied ──"
git clone -q up liveC && cd liveC
printf 'brand new\n' > newthing.js && git add -A && git commit -qm "upstream did it first"
chk "detects already-applied"      "git am --3way '$R'/pB/*.patch 2>&1 | grep -q 'already applied'"
chk "advice is non-destructive"    "git am --abort 2>/dev/null; test -f newthing.js"
cd "$R"

echo "── D: safety rails ──"
chk "format-patch writes a .patch" "ls '$R'/pB/*.patch >/dev/null"
chk "patch has a From line"        "grep -q '^From ' '$R'/pB/*.patch"
chk "patch is 3-way applicable"    "grep -q '^index ' '$R'/pB/*.patch"

echo
printf 'RESULT: %d passed, %d failed\n' "$pass" "$fail"
rm -rf "$R"
[ "$fail" -eq 0 ]
