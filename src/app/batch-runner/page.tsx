name: Daily Stock Batch

on:
  schedule:
    - cron: "0 16 * * *"
  workflow_dispatch: {}

jobs:
  fins-batch:
    runs-on: ubuntu-latest
    timeout-minutes: 90
    steps:
      - name: Run fins batch
        run: |
          BASE="https://stock-valuation3.vercel.app"
          FROM=0
          SIZE=10

          while :; do
            echo "=== [財務] from=$FROM ==="
            RES=$(curl -s -m 60 "$BASE/api/batch?mode=fins&from=$FROM&size=$SIZE" || echo "")

            if ! echo "$RES" | jq -e . >/dev/null 2>&1; then
              echo "不正なレスポンス。30秒後にリトライ: $RES"
              sleep 30
              continue
            fi

            SUCCESS=$(echo "$RES" | jq -r '.success // 0')
            FINS_FAIL=$(echo "$RES" | jq -r '.finsFailCount // 0')
            NEXTURL=$(echo "$RES" | jq -r '.nextUrl')
            FROM=$(echo "$RES" | jq -r '.nextFrom')

            echo "成功:$SUCCESS 財務失敗:$FINS_FAIL"

            if [ "$NEXTURL" = "null" ]; then
              echo "財務バッチ完了！"
              break
            fi
            sleep 1
          done
