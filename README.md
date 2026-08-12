# tokenmap-action

내 Claude Code 사용량을 매일 히트맵으로 갱신합니다.

<!-- CLAUDE-HEATMAP:START -->

![Updated](https://img.shields.io/badge/updated-2026--08--12%2011%3A28-2ea043?style=flat-square)

<img src="assets/heatmap.svg" alt="Claude Code usage heatmap" width="100%">

<!-- CLAUDE-HEATMAP:END -->

## 어떻게 도는가

Claude Code 사용 기록은 `~/.claude/projects/**/*.jsonl` 에만 있습니다. 원격에서 읽을 방법이 없으므로
수집은 맥에서, 렌더링은 어디서든 가능한 구조로 나눴습니다.

```
맥 (launchd, 매일 09:00)                  git                     GitHub Actions
scripts/sync.mjs   ──▶  data/history.json  ──push──▶  scripts/render.mjs
(트랜스크립트 파싱)                                     (SVG + README 갱신)
```

- **`scripts/sync.mjs`** — 세션 로그를 파싱해 일자별 토큰을 `data/history.json`에 집계합니다.
  의존성 없음(Node 20+ 내장 모듈만). 이 기계에서만 의미가 있습니다.
- **`scripts/render.mjs`** — 커밋된 JSON만 읽어 `assets/heatmap.svg`를 만들고 README에 주입합니다.
  순수 함수라 CI에서도 로컬에서도 결과가 같습니다.

## 설치

```sh
node scripts/sync.mjs     # ~/.claude 스캔 → data/history.json
node scripts/render.mjs   # → assets/heatmap.svg + README
```

launchd 등록 (매일 09:00, 맥이 꺼져 있었으면 켜진 직후 실행):

```sh
cp launchd/com.viram.tokenmap.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.viram.tokenmap.plist
launchctl start com.viram.tokenmap        # 즉시 한 번 테스트
tail -f /tmp/tokenmap-action.log
```

해제는 `launchctl unload ~/Library/LaunchAgents/com.viram.tokenmap.plist`.

## 설정

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `METRIC` | `total` | 히트맵 강도. `total` / `billable` / `output` / `messages` |
| `WEEKS` | `53` | 렌더링할 주 수 |
| `CLAUDE_DIR` | `~/.claude` | Claude Code 데이터 디렉터리 |
| `TZ` | 시스템 | 일자 구분 기준 시간대 |

`total`은 `cache_read`를 포함하며 실제로 그 비중이 90%를 넘습니다. 캐시 조회를 빼고
"실제로 청구되는 무게"에 가깝게 보려면 `METRIC=billable`을 쓰세요.

```sh
METRIC=billable node scripts/render.mjs
```

## 수집되지 않는 것

- **Bedrock / Vertex / Foundry 경유 사용분** — 로컬 트랜스크립트에 남지 않습니다.
- **Codex / Cursor / OpenCode** — 각자 다른 포맷의 로컬 저장소를 씁니다. 현재 이 기계에는
  해당 디렉터리가 없어 제외했습니다.
- **claude.ai 웹/앱 사용분** — Claude Code 로그가 아닙니다.

## 왜 GitHub cron이 아닌가

`schedule:` 로 도는 GitHub 호스팅 러너에는 `~/.claude`가 없어 결과가 항상 0입니다.
Anthropic이 제공하는 원격 조회 경로(Usage & Cost Admin API, Claude Code Analytics API,
Claude Enterprise Analytics API)는 모두 조직 관리자 권한의 API 키를 요구하는데, 이 조직에서는
발급이 불가능해 사용하지 않았습니다. 따라서 스케줄러는 데이터가 있는 기계에 둡니다.
