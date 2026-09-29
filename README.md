# risu-alpha

RisuAI를 쓰다 지친 사람을 위한, 더 가볍고 편한 캐릭터 채팅 앱. RisuAI의 **기능**을 바탕으로 처음부터 새로 만들었고, RisuAI의 코드는 한 줄도 가져오지 않았다.

- **빠르고 가볍다.** 저장이 통째 파일 하나가 아니라 항목별로 나뉘어, 채팅 하나를 열면 그 채팅만 읽는다.
- **서버는 아무것도 못 읽는다.** 채팅, 캐릭터, API 키까지 모두 브라우저에서 암호화된 뒤 올라간다.
- **플러그인이 하던 일이 기본 기능이다.** 프로바이더 연결, Copilot 로그인, 잔액·비용 표시를 플러그인 없이 한다.
- **리스 버그는 하나도 남기지 않는다.** RisuAI에서는 기능과 의도만 가져오고, 그 버그나 별난 동작은 따라 하지 않는다.

> **알파 단계다.** 만든 사람이 직접 운영하는 사이트에서 혼자 쓰며 다듬는 중이고, 가입은 첫 계정 뒤에 닫힌다. 몇몇 사람과 함께 쓰는 초대제는 그다음 목표다.

## 지금 되는 것

**채팅**
- 보내기, 다시 생성, 이어 쓰기, 갈라지기(분기). 수정과 다시 생성은 기록을 덮어쓰지 않고 버전으로 쌓인다.
- 답장마다 **정보**: 실제로 보낸 요청, 조립된 프롬프트, 켜진 로어북 항목, 토큰과 캐시 적중, 비용.
- 채팅별 메모, 토글, 페르소나·프롬프트·모델 바꾸기. 글자 크기 같은 읽기 설정은 기기마다 따로.
- 키보드 단축키(Ctrl+, / E / P / `/` / B 등).

**캐릭터**
- 파일을 아무 데나 끌어다 놓으면 가져온다. 무엇이 들어왔고 무엇이 빠졌는지 요약해서 보여 준다.
- 폴더, 둘러보기, 편집, 지운 캐릭터 되살리기. 지우기는 바로 되고, 확인 창 대신 **되돌리기**를 준다.

**프롬프트와 모델**
- 프롬프트 편집기(블록, 토글, 되돌리기). Risu 프리셋(`.risup`)은 프롬프트로 가져온다.
- 페르소나.
- 모델마다 설정 묶음, 프롬프트 캐시 설정과 캐시 지점.
- 보조 모델: 장기 기억·번역·감정 에셋이 쓸 모델을 미리 골라 둔다(그 기능들은 아직 없다).

**연결**
- 목록에서 고르고 키를 넣으면 끝: Anthropic, OpenRouter, Vercel AI Gateway, GitHub Copilot(기기 코드 로그인).
- 목록에 없으면 **직접 연결**: OpenAI 호환 또는 Anthropic 호환 주소와 키.
- 연결 화면에서 남은 잔액과 한도를, 답장마다 비용을 본다. 제공자가 알려 주지 않는 값은 지어내지 않고 "알 수 없음"으로 둔다.

**백업**
- **전체 백업**: 계정의 모든 것을 브라우저에서 풀어 zip 하나로 받는다. **백업 불러오기**는 새 계정에만 불러온다.

## 아직 안 되는 것

설계는 있고 아직 만들지 않은 것:
- 상태창(Risu의 `backgroundHTML` 대신 기본 제공 패널)
- 장기 기억
- 탭을 닫아도 계속 받아지는 답장
- 아바타 말고 다른 에셋
- 사용량 게이지와 페이스, 키 여러 개 자동 고르기, 라우팅 선택, 번역 화면

처음부터 빼 둔 것: 그룹 채팅, 이미지 생성, TTS, 플러그인 API, 카드 v1, 트리거 스크립트와 Lua(나중에 다시 검토), 임베딩.

## 데이터는 이렇게 지킨다

- **비밀번호 하나로 로그인하고 금고를 연다.** 브라우저가 비밀번호에서 서로 무관한 두 값을 만든다. 서버는 로그인 증명만 받고, 금고를 여는 키는 브라우저를 떠나지 않는다.
- **복구 키**는 가입할 때 반드시 내려받는다. 비밀번호를 잊었을 때의 유일한 다른 길이다.

> ⚠️ **비밀번호와 복구 키를 둘 다 잃으면 데이터는 끝이다.** 운영자를 포함해 아무도 되살릴 수 없다. 전체 백업을 따로 받아 두면 새 계정에 불러올 수 있다.

- 프롬프트 조립, CBS, 로어북, 정규식은 모두 브라우저에서 돈다. 복호화 키가 거기에만 있기 때문이다.
- 모델 호출은 하나뿐인 **중계(relay)**를 거친다. 중계는 요청을 넘기고 응답을 흘려보낼 뿐, 본문과 키를 저장하거나 기록하지 않는다.

그래도 서버가 알 수 있는 것은 숨기지 않는다:
- 항목의 종류, 개수, 서로의 연결, 크기, 시각.
- 중계는 전송 중인 프롬프트를 평문으로 본다. 기록하지 않는다는 건 약속이지, 암호로 막은 게 아니다.
- 에셋 파일만은 예외로, 같은 파일을 모든 계정이 한 번만 저장하도록 내용에서 만든 키로 잠근다. 내용은 못 읽지만, 같은 파일을 누가 갖고 있는지는 드러난다.

## RisuAI 호환

- **가져오는 것:** 카드 v2/v3(PNG, charx, JSON), charx 안의 `module.risum`과 `.risum` 모듈, 로어북, 정규식 스크립트, CBS(에셋·버튼·트리거·모듈처럼 없는 시스템에 기대는 태그 말고), 프리셋(`.risup`).
- **못 가져온 것은 세어서 보여 준다:** 트리거와 Lua, 에셋, `backgroundHTML`, 임베딩, 암호화된 카드 등.
- 가져올 때 한 번만 변환한다. Risu의 옛 필드 이름은 앱 안으로 들어오지 않고, 봇의 내용(CBS, 정규식, 데코레이터)은 그대로 보존한다.

## 개발

Node 22.12 이상.

```sh
npm install
npm run db:migrate:local   # 로컬 D1에 스키마 적용
npm run dev                # Vite + 로컬 Worker, D1, R2
```

로컬 실행에는 비밀 값이나 `.dev.vars`가 필요 없다.

| 명령 | 하는 일 |
|---|---|
| `npm run check` | 타입, ESLint, stylelint, Vitest 전부 |
| `npm test` | Vitest만 |
| `npm run e2e` | 빌드 후 Playwright (매번 빈 로컬 D1·R2에서 시작) |

코드를 만지기 전에 읽을 것:
- 폴더마다의 역할과 가져오기(import) 규칙: [`docs/tech-spec.md`](docs/tech-spec.md) §3. 경계는 `eslint/boundaries.js`가 검사한다.
- 스타일은 한 곳에만: 날 값은 `src/app/ui/foundation/tokens.css`에만 있고, 요소를 꾸미는 건 `src/app/ui`뿐이다. [`src/app/ui/README.md`](src/app/ui/README.md).

### 직접 배포하기

Cloudflare Workers Paid, D1, R2를 쓴다.

1. 자기 계정에 D1 데이터베이스와 R2 버킷을 만들고, `wrangler.jsonc`의 `database_id`와 `bucket_name`을 바꾼다.
2. `npm run db:migrate:remote`
3. `npm run deploy`

가입은 첫 계정이 생기면 닫힌다.

## 문서

- [`docs/design.md`](docs/design.md): 무엇을 왜 만드는가. 흐름, 연결 계약, 호환 범위. 이 문서와 어긋나면 design.md가 맞다.
- [`docs/tech-spec.md`](docs/tech-spec.md): 어떻게 만드는가. 호스팅, 금고, 동기화, 중계, 위험.
- [`docs/research/`](docs/research/): RisuAI 동작 명세, 옛 플러그인들이 메우던 불편 목록, 장기 기억 조사.

## 라이선스

[AGPL-3.0-only](LICENSE).

RisuAI(GPL-3.0)의 코드는 쓰지 않는다. 호환 작업은 동작 명세([`docs/research/risu-compat-spec.md`](docs/research/risu-compat-spec.md))만 보고 새로 짠다. AGPL인 이유는 `.risum`과 Risu에서 내보낸 charx를 제대로 읽는 데 필요한 RPack이 Risuai 밖에서는 AGPL-3.0이기 때문이다.

---

## In English

risu-alpha is a lighter, from-scratch alternative to RisuAI: built on RisuAI's features, not its code. It is an alpha, run by its author as a hosted web app; signup closes after the first account, and an invite-only tier is the next goal. The UI is Korean.

- **End-to-end encrypted.** Everything the user owns is sealed in the browser. One password signs in and opens the vault; the server only ever receives a proof derived from it. Lose both the password and the recovery key and the data is gone.
- **Browser compute.** Prompt assembly, CBS, lorebook and regex run client-side. Model calls go through one stateless relay that does not store or log bodies or keys. It does see prompts in transit.
- **RisuAI import.** Card v2/v3 (PNG, charx, JSON), `.risum`, lorebook, regex, CBS core, `.risup` presets. What cannot be imported is counted and shown. No Risu bugs are replicated.
- **Connections.** Anthropic, OpenRouter, Vercel AI Gateway, GitHub Copilot, and any OpenAI- or Anthropic-compatible endpoint.
- **Stack.** TypeScript, React + Vite, Hono on Cloudflare Workers, D1, R2. See [Development](#개발) for commands and [`docs/`](docs/) for the design (English).

License: AGPL-3.0-only.
