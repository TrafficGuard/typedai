#!/bin/bash
# Test harness for ensure-pnpm-check.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$SCRIPT_DIR/ensure-pnpm-check.sh"
TEST_DIR="$SCRIPT_DIR/test-fixtures"

mkdir -p "$TEST_DIR"

PASS=0
FAIL=0

test_result() {
  local name="$1"
  local expected="$2"  # "block" (exit 2) or "allow" (exit 0)
  local exit_code="$3"

  if [ "$expected" = "block" ]; then
    if [ "$exit_code" -eq 2 ]; then
      echo "  PASS: $name"
      ((PASS++))
    else
      echo "  FAIL: $name - expected exit 2 (block), got exit $exit_code"
      ((FAIL++))
    fi
  else
    if [ "$exit_code" -eq 0 ]; then
      echo "  PASS: $name"
      ((PASS++))
    else
      echo "  FAIL: $name - expected exit 0 (allow), got exit $exit_code"
      ((FAIL++))
    fi
  fi
}

# Test 1: No pnpm check run - should block
echo "Test 1: No pnpm check run"
cat > "$TEST_DIR/no-check.jsonl" << 'EOF'
{"type":"user","message":{"role":"user","content":"hello"}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hi there"}]}}
EOF
echo "{\"transcript_path\": \"$TEST_DIR/no-check.jsonl\", \"stop_hook_active\": false}" | "$HOOK" 2>/dev/null
exit_code=$?
test_result "No pnpm check - should block" "block" "$exit_code"

# Test 2: pnpm check was EXECUTED - should allow
echo "Test 2: pnpm check was executed"
cat > "$TEST_DIR/with-check.jsonl" << 'EOF'
{"type":"user","message":{"role":"user","content":"hello"}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{"command":"pnpm check"}}]}}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"ok"}]}}
EOF
echo "{\"transcript_path\": \"$TEST_DIR/with-check.jsonl\", \"stop_hook_active\": false}" | "$HOOK" 2>/dev/null
exit_code=$?
test_result "pnpm check was executed - should allow" "allow" "$exit_code"

# Test 3: pnpm check MENTIONED but not executed - should block
echo "Test 3: pnpm check mentioned but not executed"
cat > "$TEST_DIR/mentioned-only.jsonl" << 'EOF'
{"type":"user","message":{"role":"user","content":"please run pnpm check"}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"I will run pnpm check for you"}]}}
EOF
echo "{\"transcript_path\": \"$TEST_DIR/mentioned-only.jsonl\", \"stop_hook_active\": false}" | "$HOOK" 2>/dev/null
exit_code=$?
test_result "pnpm check mentioned only - should block" "block" "$exit_code"

# Test 4: pnpm check executed BEFORE last stop - should block
echo "Test 4: pnpm check before last stop"
cat > "$TEST_DIR/check-before-stop.jsonl" << 'EOF'
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{"command":"pnpm check"}}]}}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"ok"}]}}
{"type":"result","subtype":"stop"}
{"type":"user","message":{"role":"user","content":"continue please"}}
EOF
echo "{\"transcript_path\": \"$TEST_DIR/check-before-stop.jsonl\", \"stop_hook_active\": false}" | "$HOOK" 2>/dev/null
exit_code=$?
test_result "pnpm check before stop - should block" "block" "$exit_code"

# Test 5: pnpm check executed AFTER last stop - should allow
echo "Test 5: pnpm check after last stop"
cat > "$TEST_DIR/check-after-stop.jsonl" << 'EOF'
{"type":"result","subtype":"stop"}
{"type":"user","message":{"role":"user","content":"continue please"}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","input":{"command":"pnpm check"}}]}}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"ok"}]}}
EOF
echo "{\"transcript_path\": \"$TEST_DIR/check-after-stop.jsonl\", \"stop_hook_active\": false}" | "$HOOK" 2>/dev/null
exit_code=$?
test_result "pnpm check after stop - should allow" "allow" "$exit_code"

# Test 6: stop_hook_active=true - should always allow (prevent infinite loop)
echo "Test 6: stop_hook_active=true (infinite loop prevention)"
echo "{\"transcript_path\": \"$TEST_DIR/no-check.jsonl\", \"stop_hook_active\": true}" | "$HOOK" 2>/dev/null
exit_code=$?
test_result "stop_hook_active=true - should allow" "allow" "$exit_code"

# Cleanup
rm -rf "$TEST_DIR"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
