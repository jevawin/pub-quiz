#!/bin/bash
# Fetch verified questions from OpenTDB, per-category, exhausting each.
# Rate-limited: 5.2s between calls. Takes ~25min.
# Output: /tmp/opentdb/all.json (URL-encoded, raw)

set -e
mkdir -p /tmp/opentdb
TOKEN=$(curl -s "https://opentdb.com/api_token.php?command=request" | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])")
echo "token: $TOKEN"
OUT=/tmp/opentdb/all.json
echo "[" > "$OUT"
FIRST=1
for cat in 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32; do
  echo "cat $cat..."
  EXHAUSTED=0
  while [ $EXHAUSTED -eq 0 ]; do
    R=$(curl -s "https://opentdb.com/api.php?amount=50&category=$cat&token=$TOKEN&encode=url3986")
    CODE=$(echo "$R" | python3 -c "import json,sys;print(json.load(sys.stdin)['response_code'])" 2>/dev/null)
    if [ "$CODE" = "0" ]; then
      Q=$(echo "$R" | python3 -c "import json,sys;d=json.load(sys.stdin);print(json.dumps(d['results']))")
      COUNT=$(echo "$Q" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")
      [ $FIRST -eq 0 ] && echo "," >> "$OUT"
      echo "$Q" | sed 's/^\[//;s/\]$//' >> "$OUT"
      FIRST=0
      echo "  +$COUNT"
      [ "$COUNT" -lt 50 ] && EXHAUSTED=1
    elif [ "$CODE" = "4" ] || [ "$CODE" = "1" ]; then
      EXHAUSTED=1
    else
      echo "  code=$CODE, retry"
      sleep 6
    fi
    sleep 5.2
  done
done
echo "]" >> "$OUT"
python3 -c "import json;d=json.load(open('$OUT'));print('fetched',len(d),'questions')"
