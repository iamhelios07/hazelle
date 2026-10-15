// The tag this page was built from: the Dockerfile hands its HAZELLE_VERSION to Vite. A build without one (dev, tests, a
// local docker build) has none, and then neither compares with the server nor says news.
export const BUILT_VERSION: string | null = (import.meta.env.VITE_HAZELLE_VERSION as string | undefined) || null;

// version: the tag of the release it came with. date: YYYY-MM-DD. lines: what a user notices, in the app's words.
export type News = { version: string; date: string; lines: string[] };

// Newest first. Only a release a user would notice gets an entry; the deploy skill drafts it from scripts/release-notes.sh.
export const NEWS: News[] = [
  {
    version: 'v0.2.5',
    date: '2026-10-15',
    lines: [
      '채팅 메뉴의 점검(Ctrl+U)에서 보낼 요청과 토큰을 쓰는 곳, 캐시, 변수, 모듈, 스크립트 기록을 한곳에서 볼 수 있어요.',
      'Risu 프리셋 파일(.risup, .risupreset)을 끌어다 놓거나 파일 선택으로 가져와요. 함께 온 모듈과 짝을 맞추고, 캐릭터·모듈·프롬프트 가져오기는 되돌릴 수 있어요.',
      '캐릭터 폴더를 세 단계까지 만들 수 있어요. 설정 › 실험실에서 탐색기식 폴더를 켜면 폴더를 카드로 보고 눌러서 들어가고, 카드를 끌어 폴더로 옮길 수 있어요.',
      '내 메시지에도 번역 버튼이 있어요. 내보내기에서는 번역 없는 메시지를 한 번에 번역할 수 있어요.',
      '모듈과 캐릭터의 토글을 프롬프트 토글과 같은 화면에서 편집해요. Risu에서 옮길 때 토글 값도 함께 와요.',
      '알림을 ✕로 닫거나, 휴대폰에서는 옆으로 밀어서 바로 닫을 수 있어요.',
      '이미지 가리기는 채팅 메뉴 대신 읽기 설정에 있어요. 프롬프트에는 캐릭터 설명 자리를 여러 번 둘 수 있어요.',
      '봇 스크립트의 =, ≠, ≤, ≥ 비교와 {{history}}가 Risu처럼 동작해요. 폴더 안에서 휴대폰 뒤로 버튼이 둘러보기 맨 위로 가던 것과 기억 정리 뒤 재검사가 빠지던 문제를 고쳤어요.',
    ],
  },
  {
    version: 'v0.2.4',
    date: '2026-10-15',
    lines: [
      "Vertex AI를 프로젝트 ID, 클라이언트 이메일, 프라이빗 키를 따로 넣어서도 연결할 수 있어요. 키 화면에서 '프로젝트 ID, 이메일, 키 따로 입력'을 펼치면 돼요.",
      '채팅 토글의 선택 토글이 이름 옆 드롭다운으로 바뀌었어요. 오른쪽 패널도 조금 넓어졌어요.',
      "채팅 토글에서 '프롬프트 토글의 기본값 바꾸기'를 연 뒤 뒤로 가면 다시 채팅 토글로 돌아와요.",
      '휴대폰 목록의 설정 버튼이 위쪽 로고 옆으로 옮겨졌어요.',
      "패널을 연 좁은 화면에서 '맨 아래로' 버튼이 메시지 도구와 겹치지 않아요.",
    ],
  },
  {
    version: 'v0.2.3',
    date: '2026-10-15',
    lines: [
      '채팅마다 로어북을 둘 수 있어요. 채팅 메뉴의 채팅 로어북에서 보고, 봇 스크립트가 적은 항목도 여기 모여요.',
      '캐릭터 편집 › 로어북에서 이 캐릭터만의 로어북 최대 분량을 정할 수 있어요. 비우면 설정의 공용 값을 따라요.',
      '첫인사의 언어·설정 패널이 첫 응답 뒤에도 계속 살아 있어요.',
      '무거운 봇의 스크립트가 더 많이 돌아요. 메시지 끼워 넣기와 잘라내기, 배경 HTML 바꾸기까지 돼요.',
      'RisuAI가 모듈로 내보낸 charx 파일을 모듈로 가져와요.',
      '봇 화면의 고정 상자가 메시지 밖으로 튀지 않고 제자리에 그려져요. iPad에서 파일 선택도 고쳤어요.',
    ],
  },
  {
    version: 'v0.2.2',
    date: '2026-10-14',
    lines: [
      '가져오기 결과의 못 가져온 에셋이 추가 아이콘, 감정 표현, 배경처럼 종류별로 보여요.',
      '아직 캐릭터가 없을 때 홈에서 Risu에서 이사가 맨 위에 와요. 이사 창은 백업 파일 두 칸으로 열리고, 메시지 속 이미지는 펼쳐서 넣어요.',
      '여러 사람이 동시에 이미지를 올려도 서로 기다리지 않아요.',
      '응답 정보에서 앱 추정과 이번 배율, 토큰을 맞춘 기준을 볼 수 있어요.',
      '새 소식은 최신 3개만 보이고, 모두 보기로 지난 소식을 볼 수 있어요.',
    ],
  },
  {
    version: 'v0.2.0',
    date: '2026-10-14',
    lines: [
      '연결 메뉴의 키 바꾸기로 API 키를 새로 넣을 수 있어요.',
      '설정 › 채팅 기본값에서 로어북 최대 분량을 정할 수 있어요. 넘어서 빠진 항목이 있으면 알려 드려요.',
      '휴지통에서 영구 삭제하면 더 쓰지 않는 이미지도 지워져서 이미지 용량이 줄어요.',
      'Risu에서 옮길 때 남은 이미지 공간을 미리 알려 드리고, 넘는 이미지는 빼고 가져와요.',
      '퍼메가 같은 봇에서 버튼으로 바꾼 값이 반영되지 않던 문제를 고쳤어요.',
    ],
  },
  {
    version: 'v0.1.82',
    date: '2026-10-14',
    lines: [
      '채팅 머리글의 캐릭터 이름을 누르면 캐릭터 설정이 열려요. 메뉴의 캐릭터 편집으로도 열 수 있어요.',
      '자주 쓰는 토글을 입력창 옆에 고정할 수 있어요. 토글 목록에서 핀을 눌러 보세요.',
      '새로고침하라는 알림이 계속 뜨던 문제를 고쳤어요.',
    ],
  },
  {
    version: 'v0.1.81',
    date: '2026-10-14',
    lines: [
      '디스플레이 설정에서 이미지 최대 높이를 정할 수 있어요.',
      '채팅 메뉴를 종류별로 묶고 항목마다 아이콘을 달았어요.',
      '채팅에서 프롬프트를 고를 때 사본이 원본 아래에 묶여 보여요.',
      '이미지 가리기로 연 이미지를 다시 가릴 수 있어요.',
      '읽은 만큼 표시는 화면 두 배보다 긴 답변에만 나와요.',
    ],
  },
  {
    version: 'v0.1.79',
    date: '2026-10-14',
    lines: [
      '운영자에게 알리기에서 기기 정보와 최근 오류를 함께 보낼 수 있어요. 진단 내용을 따로 복사하지 않아도 돼요.',
      '실패하면 다시 보내기 횟수를 채팅 기본값에서 한 번에 정하고, 연결이나 설정 묶음마다 따로 정할 수도 있어요.',
      '설정 화면을 더 읽기 쉽게 정리했어요.',
    ],
  },
  { version: 'v0.1.78', date: '2026-10-14', lines: ['iPhone에서 메시지를 보내지 못하던 문제를 고쳤어요.'] },
  { version: 'v0.1.77', date: '2026-10-14', lines: ['계정 → 앱 정보에 문제 진단이 생겼어요. 오류가 나면 진단하기를 누르고, 나온 내용을 복사해 운영자에게 보내 주세요.'] },
];

// Said once, on the first open of a release that came with news, on a device that opened another release before: a
// device's first open is someone new, who has no before to compare.
export function newsToSay(built: string | null, lastOpened: string, news: News[]): News | null {
  if (built === null || lastOpened === '' || lastOpened === built) return null;
  return news.find(({ version }) => version === built) ?? null;
}
