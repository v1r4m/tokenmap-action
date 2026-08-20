# tokenmap-action

내 Claude Code 사용량 히트맵.

<!-- CLAUDE-HEATMAP:START -->

![Updated](https://img.shields.io/badge/updated-2026--08--20%2009%3A00-2ea043?style=flat-square)

<img src="assets/heatmap.svg" alt="Claude Code usage heatmap" width="100%">

<!-- CLAUDE-HEATMAP:END -->

## 갱신하기

```sh
bash scripts/run.sh
```

스캔 → 렌더 → 커밋 → push까지 한 번에 합니다. 1초쯤 걸리고 끝납니다.

**매일 돌릴 필요는 없습니다.** 사용 기록은 `~/.claude`에 계속 쌓이고 `sync`는 매번 전체를 다시
스캔하므로, 한 달 뒤에 돌려도 그 사이 기록이 전부 살아납니다. 실행 주기는 README가 얼마나
최신이길 원하는지의 문제일 뿐, 데이터 유실과는 무관합니다.

렌더만 다시 하려면 (재스캔 없이, 커밋도 안 함):

```sh
METRIC=billable node scripts/render.mjs
```

## 구성

Claude Code 사용 기록은 `~/.claude/projects/**/*.jsonl` 에만 있습니다. 원격에서 읽을 방법이 없어
전부 이 맥에서 돕니다.

| 파일 | 하는 일 | 어디서 |
|---|---|---|
| `scripts/sync.mjs` | 세션 로그 파싱 → 일자별 토큰을 `data/history.json`에 집계 | 이 맥에서만 |
| `scripts/render.mjs` | `history.json` → `assets/heatmap.svg` + README 주입 | 어디서든 |
| `scripts/run.sh` | 위 둘 + git commit/push | 이 맥에서만 |

Node 20 이상이면 되고 **의존성이 없습니다.** 외부 패키지도, Python도, tokenmap도, Cairo도
쓰지 않고 표준 모듈만으로 돌아갑니다.

수집과 렌더를 나눈 이유: `render.mjs`는 커밋된 JSON만 읽는 순수 함수라서, 색이나 기간만 바꿔
다시 그릴 때 144개 트랜스크립트를 재스캔할 필요가 없습니다.

## 설정

| 환경변수 | 기본값 | 설명 |
|---|---|---|
| `METRIC` | `total` | 히트맵 강도. `total` / `billable` / `output` / `messages` |
| `WEEKS` | `53` | 렌더링할 주 수 |
| `CLAUDE_DIR` | `~/.claude` | Claude Code 데이터 디렉터리 |
| `TZ` | 시스템 | 일자 구분 기준 시간대 |

`total`은 `cache_read`를 포함하는데 실측상 그 비중이 96%입니다. 즉 히트맵이 사실상
"컨텍스트 크기 × 턴 수"를 그립니다. 실제 비용 감각에 가깝게 보려면 `METRIC=billable`
(input + output + cache_creation)을 쓰세요.

## 동작 특성

- **몇 번을 돌려도 수치가 안 부풀어요.** `messageId:requestId`로 중복 제거합니다.
- **오래된 로그가 정리돼도 과거가 안 날아가요.** `sync`가 기존 `history.json`과 병합합니다.
- **변경이 없으면 커밋하지 않습니다.**

## 수집되지 않는 것

- **Bedrock / Vertex / Foundry 경유 사용분** — 로컬 트랜스크립트에 남지 않습니다.
- **Codex / Cursor / OpenCode** — 각자 다른 포맷을 쓰고, 현재 이 맥엔 해당 디렉터리가 없습니다.
- **claude.ai 웹/앱 사용분** — Claude Code 로그가 아닙니다.

## 자동화를 원하게 되면

`launchd/com.viram.tokenmap.plist`가 들어 있습니다(매일 09:00). 지금은 쓰지 않지만 필요해지면:

```sh
cp launchd/com.viram.tokenmap.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.viram.tokenmap.plist
```

GitHub Actions로 스케줄링하는 방법은 없습니다. 호스팅 러너에는 `~/.claude`가 없어 결과가 항상
0이고, Anthropic의 원격 조회 API(Usage & Cost / Claude Code Analytics / Enterprise Analytics)는
모두 조직 관리자 API 키를 요구하는데 이 조직에서는 발급할 수 없습니다.
