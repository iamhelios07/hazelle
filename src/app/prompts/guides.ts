import { unescapeCbs } from '../../engine/cbs/escape';
import { evaluate, type CbsContext } from '../../engine/cbs/evaluate';

export type GuideId = 'basics' | 'when' | 'vars' | 'lists' | 'func' | 'random' | 'literal';
// inMessage: the example runs as a chat message's own text, the only place setvar and addvar write.
export type Example = { written: string; result: string; inMessage?: true };
export type Guide = { title: string; steps: readonly { text: string; example?: Example }[] };

// The chat every example runs in, which SAMPLE_NOTE describes to the reader. Its seed and clock are fixed, so an example
// gives the result written beside it; guides.test.ts runs every one.
const SAMPLE: CbsContext = {
  stage: 'prompt',
  card: {
    name: '미라',
    nickname: null,
    description: '',
    personality: '',
    scenario: '',
    greetings: [],
    exampleDialogue: '',
    systemPrompt: '',
    postHistoryInstructions: '',
    creatorNotes: '',
    creator: '',
    version: '',
    tags: [],
    variables: [],
    toggles: '',
    utility: false,
    bias: [],
    regex: [],
    triggers: [],
    loreSettings: { scanDepth: null, tokenBudget: null, recursive: null, fullWordMatching: null },
  },
  persona: { name: '나', description: '' },
  prompt: null,
  lore: [],
  messages: [{ id: 'm1', seed: 'm1', role: 'user', text: '안녕', time: null }],
  source: { seed: 'sample' },
  greeting: null,
  variables: new Map([
    ['호감도', '30'],
    ['날씨', '비'],
    ['가방', '["열쇠","지도"]'],
  ]),
  toggle: (key) => (key === '존댓말' ? '1' : null),
  model: null,
  screen: null,
  clock: { now: Date.UTC(2026, 9, 1, 3), timeZone: 'Asia/Seoul' },
  language: 'Korean',
  assets: [],
  faces: { char: null, user: null },
  pickSeed: 'sample',
};

export const SAMPLE_NOTE = '예시는 캐릭터 미라, 페르소나 나, 채팅 변수 호감도=30 · 날씨=비 · 가방=["열쇠","지도"], 토글 존댓말 켬인 채팅에서 계산해요.';

export function tryExample(written: string, inMessage = false): string {
  const context = { ...SAMPLE, variables: new Map(SAMPLE.variables), source: inMessage ? { message: 0 } : SAMPLE.source };
  return unescapeCbs(evaluate(written, context));
}

export const GUIDES: Record<GuideId, Guide> = {
  basics: {
    title: '명령어 기본',
    steps: [
      {
        text: '{{ }}로 감싼 글이 명령어예요. 모델에게 보내기 직전에 그 자리가 값으로 바뀌어요. 프롬프트에는 명령어가 그대로 남아요.',
        example: { written: '{{user}}와 {{char}}의 이야기', result: '나와 미라의 이야기' },
      },
      { text: '값을 받는 명령어는 이름 뒤에 ::를 두고 값을 써요. 값이 여럿이면 ::로 나눠요.', example: { written: '{{replace::사과 두 개::사과::배}}', result: '배 두 개' } },
      { text: '명령어 안에 명령어를 쓸 수 있어요. 안쪽이 먼저 바뀌고, 그 결과로 바깥이 계산돼요.', example: { written: '{{char}}의 이름은 {{length::{{char}}}}글자예요.', result: '미라의 이름은 2글자예요.' } },
      { text: '참은 1, 거짓은 0이에요. 비교하는 명령어는 1이나 0을 내고, 조건은 1이나 true를 참으로 읽어요.', example: { written: '{{greater::{{getvar::호감도}}::20}}', result: '1' } },
      {
        text: '이름은 대소문자, 띄어쓰기, _와 -를 가리지 않아요. 모르는 이름이거나 값이 모자라면 쓴 그대로 가요. 모델에게 {{ }}가 보인다면 이름부터 확인해 보세요.',
        example: { written: '{{Get_Var::호감도}} {{없는명령어}}', result: '30 {{없는명령어}}' },
      },
    ],
  },
  when: {
    title: '조건',
    steps: [
      {
        text: '#when은 조건이 참일 때 안의 글을 넣어요. {{:else}} 뒤의 글은 거짓일 때 들어가요. 비교는 is, isnot, >, <, >=, <=로 해요.',
        example: { written: '{{#when::{{getvar::호감도}}::>::20}}미라는 나를 믿어요.{{:else}}미라는 나를 경계해요.{{/when}}', result: '미라는 나를 믿어요.' },
      },
      {
        text: '토글은 toggle 뒤에 키를 써서 읽어요. 조건 넣기를 누르면 이 모양을 대신 써 줘요.',
        example: { written: '{{#when::toggle::존댓말}}존댓말로 말해요.{{:else}}반말로 말해요.{{/when}}', result: '존댓말로 말해요.' },
      },
      { text: '채팅 변수가 어떤 값인지는 vis로 봐요. 아닌지는 visnot이에요.', example: { written: '{{#when::날씨::vis::비}}우산을 챙겨요.{{/when}}', result: '우산을 챙겨요.' } },
      {
        text: 'not은 뒤집고, and와 or는 두 조건을 묶어요. 양쪽이 복잡하면 비교 명령어로 1이나 0을 먼저 만들어 넣어요.',
        example: { written: '{{#when::{{greater::{{getvar::호감도}}::20}}::and::{{getglobalvar::toggle_존댓말}}}}믿고 존대해요.{{/when}}', result: '믿고 존대해요.' },
      },
    ],
  },
  vars: {
    title: '변수',
    steps: [
      { text: '채팅 변수는 채팅마다 따로 기억하는 값이에요. 봇의 메시지나 정규식이 기록하고, 프롬프트는 getvar로 읽어요.', example: { written: '호감도: {{getvar::호감도}}', result: '호감도: 30' } },
      {
        text: '값을 바꾸는 setvar와 addvar는 채팅 메시지 안에서만 동작해요. 프롬프트에 쓰면 아무것도 바꾸지 않고 지워져요. 이 예시는 메시지 안이라고 치고 계산해요.',
        example: { written: '{{addvar::호감도::5}}지금 호감도: {{getvar::호감도}}', result: '지금 호감도: 35', inMessage: true },
      },
      {
        text: '없는 변수는 빈 글로 읽혀요. 처음 값을 두려면 setdefaultvar를 써요. 이미 값이 있으면 그대로예요. 이것도 메시지 안에서만 동작해요.',
        example: { written: '{{setdefaultvar::기분::평온}}{{setdefaultvar::호감도::0}}{{getvar::기분}}, {{getvar::호감도}}', result: '평온, 30', inMessage: true },
      },
      { text: '한 글 안에서만 잠깐 쓸 값은 임시 변수에 둬요. 프롬프트에서도 동작해요.', example: { written: '{{settempvar::말투::다정하게}}미라는 {{tempvar::말투}} 말해요.', result: '미라는 다정하게 말해요.' } },
      { text: '계산에서는 $ 뒤에 이름을 써서 변수를 읽어요.', example: { written: '{{? $호감도 * 2}}', result: '60' } },
    ],
  },
  lists: {
    title: '배열과 반복',
    steps: [
      { text: '배열은 값 여러 개를 ["가","나"]처럼 JSON으로 적은 거예요. makearray로 만들 수도 있어요.', example: { written: '{{makearray::사과::배}}', result: '["사과","배"]' } },
      {
        text: '#each는 배열의 항목마다 안의 글을 한 번씩 넣어요. as 뒤에 붙인 이름을 {{slot::이름}}으로 읽어요.',
        example: { written: '{{#each {{getvar::가방}} as 물건}}- {{slot::물건}}{{br}}{{/each}}', result: '- 열쇠\n- 지도\n' },
      },
      { text: '항목 수는 arraylength, n번째 항목은 arrayelement로 읽어요. 번호는 0부터 세요.', example: { written: '{{arraylength::{{getvar::가방}}}}개 중 첫째: {{arrayelement::{{getvar::가방}}::0}}', result: '2개 중 첫째: 열쇠' } },
      { text: '사전은 키마다 값을 둔 JSON이에요. dictelement로 키의 값을 읽어요.', example: { written: '{{dictelement::{{makedict::이름=미라::나이=20}}::나이}}', result: '20' } },
      {
        text: '배열을 바꾸는 명령어는 바뀐 배열을 내요. 기억하려면 메시지 안에서 setvar로 변수에 다시 넣어요.',
        example: { written: '{{setvar::가방::{{arraypush::{{getvar::가방}}::칼}}}}{{getvar::가방}}', result: '["열쇠","지도","칼"]', inMessage: true },
      },
    ],
  },
  func: {
    title: '함수',
    steps: [
      {
        text: '여러 번 쓸 글은 #func로 이름을 붙여 두고 {{call}}로 불러요. 함수를 정한 자리에는 아무것도 남지 않아요.',
        example: { written: '{{#func 인사}}미라가 손을 흔들어요.{{/func}}{{call::인사}} {{call::인사}}', result: '미라가 손을 흔들어요. 미라가 손을 흔들어요.' },
      },
      { text: 'call 뒤에 값을 넘기면 함수 안에서 {{arg::1}}, {{arg::2}}로 읽어요.', example: { written: '{{#func 소개}}이름: {{arg::1}}, 나이: {{arg::2}}{{/func}}{{call::소개::미라::20}}', result: '이름: 미라, 나이: 20' } },
      {
        text: '{{return}}은 함수를 거기서 끝내고 그 값을 내요. 조건과 함께 쓰면 경우마다 다른 값을 낼 수 있어요.',
        example: { written: '{{#func 관계}}{{#when::{{arg::1}}::>::50}}{{return::친구}}{{/when}}{{return::지인}}{{/func}}{{call::관계::{{getvar::호감도}}}}', result: '지인' },
      },
    ],
  },
  random: {
    title: '무작위',
    steps: [
      {
        text: 'random은 값 중 하나를 골라요. 보낼 때마다 새로 골라요. 여기서는 예시 채팅이 하나로 정해져 있어서, 예시를 고쳐도 같은 자리는 같은 값을 골라요.',
        example: { written: '오늘 날씨: {{random::맑음::흐림::비}}', result: '오늘 날씨: 비' },
      },
      { text: 'pick도 하나를 고르지만, 같은 채팅에서 메시지 수가 같은 동안은 다시 보내도 같은 값이에요.', example: { written: '{{pick::맑음::흐림::비}}', result: '맑음' } },
      { text: 'randint는 두 수 사이의 정수를, dice와 roll은 주사위를 굴린 합을 내요. 2d6은 6면체 두 개예요.', example: { written: '{{randint::1::100}} / {{roll::2d6}}', result: '67 / 7' } },
      { text: 'hash는 같은 글에 늘 같은 7자리 숫자를 내요.', example: { written: '{{hash::미라}}', result: '2690090' } },
    ],
  },
  literal: {
    title: '글자 그대로',
    steps: [
      { text: '{{ }}를 글자 그대로 보내려면 #pure로 감싸요. 안의 명령어는 바뀌지 않아요.', example: { written: '{{#pure}}{{char}}는 캐릭터 이름 자리예요.{{/pure}}', result: '{{char}}는 캐릭터 이름 자리예요.' } },
      { text: '봇의 정규식이 뒤에서 명령어를 다시 읽는다면 #escape를 써요. 그 뒤로도 글자 그대로 남아요.', example: { written: '{{#escape}}{{user}}{{/escape}}', result: '{{user}}' } },
      { text: '한 군데만이라면 {{bo}}와 {{bc}}로 중괄호 두 개를, {{:}}로 콜론을 넣어요.', example: { written: '{{bo}}char{{bc}}', result: '{{char}}' } },
      { text: '반대로 \\n 같은 표기를 진짜 줄바꿈으로 바꾸려면 #code로 감싸요. 안에 있던 진짜 줄바꿈과 탭은 지워져요.', example: { written: '{{#code}}첫 줄\\n둘째 줄{{/code}}', result: '첫 줄\n둘째 줄' } },
    ],
  },
};
