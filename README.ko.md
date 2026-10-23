# 헤이젤 설치 안내

헤이젤을 내 컴퓨터나 폰에 직접 설치하는 방법이에요. 설치 없이 바로 쓰려면 [hazelle.app](https://hazelle.app)을 열면 돼요.

## 어떤 방법이 맞을까요

|  | 윈도우 (도커 없이) | 도커 | 안드로이드 (Termux) |
|---|---|---|---|
| 미리 필요한 것 | 없음 | Docker Desktop | Termux 앱 |
| 설치 | zip 풀고 더블클릭 | 명령어 한 줄 | 명령어 한 줄 |
| 업데이트 | 켤 때마다 자동 | 같은 명령어 다시 | 같은 명령어 다시 |

도커를 모르면 윈도우 방법으로 시작하세요.

어느 방법이든 처음 열면 비밀번호를 정해요. 혼자 쓰는 동안은 회원가입도 아이디도 없이, 그 비밀번호로만 열어요. 다른 사람과 함께 쓰려면 관리자 화면에서 가입 정원을 올려요. 그러면 손님 모드와 아이디로 가입하기가 열려요.

## 윈도우 (도커 없이)

1. [hazelle-windows-x64.zip](https://github.com/jiniill/hazelle/releases/latest/download/hazelle-windows-x64.zip)을 받아요.
2. 원하는 곳에 압축을 풀어요. `hazelle` 폴더가 생겨요.
3. `hazelle` 폴더의 `start-hazelle.bat`을 더블클릭해요. 처음 실행할 때 Windows가 경고 창을 띄우면 `실행`(또는 `추가 정보` → `실행`)을 눌러요.
4. 브라우저에서 http://localhost:8080 이 열리면 비밀번호를 정해요.

검은 창이 헤이젤이에요. 창을 닫으면 헤이젤도 꺼져요. 이미 켜져 있을 때 `start-hazelle.bat`을 다시 실행하면 브라우저만 열려요.

데이터는 `hazelle\data` 폴더에 쌓여요. 8080 포트를 다른 프로그램이 쓰고 있으면 `start-hazelle.bat`을 메모장으로 열고 `cd`로 시작하는 줄 아래에 `set PORT=8081`을 넣어요.

### 업데이트

`start-hazelle.bat`으로 켤 때마다 새 버전이 있는지 확인하고, 있으면 받은 다음 켜요. `data` 폴더와 `start-hazelle.bat`에 넣은 설정은 그대로 남아요. 인터넷이 안 되면 지금 버전으로 켜요.

## 도커

Docker Desktop을 설치하고 켠 다음, 아래 명령어를 실행해요. 설치하고 실행한 뒤 브라우저까지 열어 줘요.

윈도우 (PowerShell):

```powershell
iex ([Text.Encoding]::UTF8.GetString((iwr -useb https://github.com/jiniill/hazelle/releases/latest/download/install-docker.ps1).Content))
```

macOS, 리눅스:

```sh
curl -fsSL https://github.com/jiniill/hazelle/releases/latest/download/install-docker.sh | sh
```

설정 파일은 홈 폴더의 `hazelle-docker`에, 데이터는 도커 볼륨 `hazelle_data`에 있어요. 업데이트할 때는 같은 명령어를 다시 실행해요. 데이터는 그대로 남아요. 다른 곳으로 자동 백업하기, 복원, 그 밖의 설정은 [README의 Self-hosting](README.md#self-hosting)(영어)에 있어요.

## 안드로이드 (Termux)

1. [Termux](https://termux.dev/)를 F-Droid나 GitHub에서 받아요.
2. Termux에서 아래 명령어를 실행해요. Node.js 설치부터 헤이젤 실행까지 한 번에 하고, 끝나면 브라우저가 열려요.

```sh
curl -fsSL https://github.com/jiniill/hazelle/releases/latest/download/install.sh | sh
```

다음부터는 Termux에서 `sh ~/hazelle/start`로 켜요. 끌 때는 Termux에서 `Ctrl` + `C`를 눌러요. 데이터는 `~/hazelle/data`에 있어요.

화면이 꺼져도 헤이젤이 계속 돌도록, 켤 때 Termux의 wake lock이 함께 켜져요. 그래도 꺼지면 휴대폰 설정에서 Termux의 배터리 사용을 `제한 없음`으로 바꿔요.

업데이트할 때는 헤이젤을 끄고 같은 명령어를 다시 실행해요. 데이터는 그대로 남아요.

Node.js 24 이상이 깔린 리눅스나 macOS에서도 같은 명령어로 설치할 수 있어요.

## 헤이젤 나우

직접 설치한 헤이젤도 [헤이젤 나우](https://hazelle.app/now) 집계에 함께 더해져요. 보내는 건 역할, 연결 종류, 모델 이름뿐이고, 계정 대신 알아볼 수 없게 바꾼 값을 보내요. 빼고 싶으면 `설정 › 계정 › 앱 정보`에서 `헤이젤 나우 집계 참여`를 꺼요.

## 백업

- 계정 하나: `설정 › 계정 › 백업`의 전체 백업이 계정의 모든 것을 zip 하나로 저장해요.
- 설치 전체: 헤이젤을 끈 다음 `data` 폴더를 통째로 다른 곳에 복사해요. 켜진 채로 복사하면 파일이 깨질 수 있어요.
- 헤이젤도 매일 계정마다 스냅샷을 만들어요. 계정 설정에서 지난 일주일 안의 시점으로 되돌릴 수 있어요. 다만 스냅샷은 같은 디스크에 있어서, 디스크가 고장 나면 함께 사라져요.

## 로컬 모델 연결

헤이젤의 새 연결에서 주소를 이렇게 넣어요.

| 모델 서버 | 윈도우, Termux | 도커 |
|---|---|---|
| Ollama | `http://localhost:11434/v1` | `http://host.docker.internal:11434/v1` |
| LM Studio | `http://localhost:1234/v1` | `http://host.docker.internal:1234/v1` |
| koboldcpp | `http://localhost:5001/v1` | `http://host.docker.internal:5001/v1` |

다른 포트의 모델 서버를 쓰려면, 윈도우에서는 `start-hazelle.bat`의 `cd` 줄 아래에 `set HAZELLE_LOCAL_PROVIDERS=localhost:11434,localhost:1234,localhost:5001,localhost:8000`처럼 전부 적어 넣어요. 도커는 [README](README.md#local-models)를 봐요.

도커에서는 모델 서버가 같은 컴퓨터의 다른 프로그램에서 오는 접속도 받아야 해요. Ollama는 `OLLAMA_HOST=0.0.0.0`으로 실행하고, LM Studio는 로컬 네트워크에서 서비스하는 스위치를 켜요.

## 폰이나 다른 기기에서 쓰기

로그인과 암호화는 `https://` 주소이거나 같은 기기의 `localhost`에서만 돼요. 그래서 다른 기기에서 `http://192.168.x.x:8080`으로 열면 설정과 상관없이 쓸 수 없어요.

[Tailscale](https://tailscale.com/)을 쓰면 https 주소를 쉽게 만들 수 있어요.

1. 헤이젤을 설치한 컴퓨터와 폰에 Tailscale을 설치하고 같은 계정으로 로그인해요.
2. 컴퓨터의 터미널에서 `tailscale serve --bg 8080`을 실행해요. HTTPS를 켜라는 안내가 나오면 따라 해요.
3. 출력된 `https://<컴퓨터 이름>.<tailnet 이름>.ts.net` 주소를 폰에서 열어요.

주소가 다르면 다른 사이트로 취급돼요. 그래서 폰에서는 처음에 한 번 다시 로그인해야 해요.
