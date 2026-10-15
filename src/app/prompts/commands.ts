import type { PromptSort } from '../../model/prompt';
import type { Snippet } from './edits';
import type { GuideId } from './guides';

// names: the tag's names as src/engine/cbs/tags.ts defines them, the first the one written in form; empty for a block,
// whose name the evaluator reads (evaluateBlock). commands.test.ts holds the two lists equal, and runs every example.
// form: what 삽입 types, with its first Korean word as the place to write next.
// uses: why a prompt of that sort often holds it, for 자주 쓰는 명령어.
export type Command = {
  names: readonly string[];
  form: string;
  what: string;
  example?: readonly [written: string, result: string];
  uses?: Partial<Record<PromptSort, string>>;
};
// sorts: the prompts it works in, when not every one.
export type CommandGroup = { title: string; guide?: GuideId; sorts?: readonly PromptSort[]; commands: readonly Command[] };

export const COMMANDS: readonly CommandGroup[] = [
  {
    title: '번역',
    sorts: ['translate'],
    commands: [
      { names: ['language'], form: '{{language}}', what: '번역할 언어의 영어 이름이에요.', example: ['Target: {{language}}', 'Target: Korean'], uses: { translate: '지시문에 번역할 언어를 적을 때 써요.' } },
    ],
  },
  {
    title: '캐릭터와 페르소나',
    commands: [
      { names: ['char', 'bot'], form: '{{char}}', what: '캐릭터 이름이에요. 카드에 별명이 있으면 별명이에요.', uses: { conversation: '지시문에서 캐릭터 이름을 가리킬 때 써요.', translate: '이름을 번역하지 말라고 할 때 써요: Keep {{char}} and {{user}} as written.' } },
      { names: ['user'], form: '{{user}}', what: '페르소나 이름이에요.', uses: { conversation: '지시문에서 내 이름을 가리킬 때 써요.', translate: '번역문의 내 이름과 호칭을 일정하게 맞출 때 써요.' } },
      { names: ['persona', 'userpersona'], form: '{{persona}}', what: '페르소나 설명이에요.' },
      { names: ['description', 'chardesc'], form: '{{description}}', what: '카드의 캐릭터 설명이에요.' },
      { names: ['personality', 'charpersona'], form: '{{personality}}', what: '카드의 성격이에요.' },
      { names: ['scenario'], form: '{{scenario}}', what: '카드의 시나리오예요.' },
      { names: ['exampledialogue', 'examplemessage'], form: '{{exampledialogue}}', what: '카드의 예시 대화예요.' },
      { names: ['mainprompt', 'systemprompt'], form: '{{mainprompt}}', what: `채팅 프롬프트에서 '본문' 표시를 한 텍스트예요.` },
      { names: ['globalnote', 'systemnote', 'ujb'], form: '{{globalnote}}', what: `채팅 프롬프트에서 '글로벌 노트' 표시를 한 텍스트예요.` },
      { names: ['authornote'], form: '{{authornote}}', what: '채팅의 노트예요. 없으면 프롬프트의 기본 노트예요.' },
      { names: ['lorebook', 'worldinfo'], form: '{{lorebook}}', what: '로어북 항목 전부를 JSON 배열로 넣어요.' },
      { names: [], form: '{{position::이름}}', what: '로어북에서 @@position pt_이름으로 자리를 정한 항목이 한 줄씩 들어가요.' },
      { names: ['assetlist'], form: '{{assetlist}}', what: '캐릭터 에셋의 이름을 JSON 배열로 넣어요. 모델이 에셋을 이름으로 선택할 때 써요.' },
      { names: ['chardisplayasset'], form: '{{chardisplayasset}}', what: 'Risu의 에셋 명령에 들어가는 이미지 목록이에요. 헤이젤에는 에셋 명령이 없어서 항상 빈 배열이에요.' },
      { names: ['moduleenabled'], form: '{{moduleenabled::이름}}', what: '그 네임스페이스의 모듈이 이 채팅에 켜져 있으면 1, 아니면 0이에요.' },
      { names: ['moduleassetlist'], form: '{{moduleassetlist::이름}}', what: '그 네임스페이스의 모듈이 켜져 있을 때, 그 모듈 에셋의 이름을 JSON 배열로 넣어요.' },
    ],
  },
  {
    title: '대화 기록',
    commands: [
      { names: ['lastmessage'], form: '{{lastmessage}}', what: '마지막 메시지의 내용이에요.' },
      { names: ['previouscharchat', 'lastcharmessage'], form: '{{previouscharchat}}', what: '캐릭터의 마지막 메시지예요.' },
      { names: ['previoususerchat', 'lastusermessage'], form: '{{previoususerchat}}', what: '내 마지막 메시지예요.' },
      { names: ['previouschatlog'], form: '{{previouschatlog::번호}}', what: '그 번호의 메시지예요. 인사말 다음 메시지가 0번이에요.' },
      { names: ['lastmessageid', 'lastmessageindex'], form: '{{lastmessageid}}', what: '마지막 메시지의 번호예요. 인사말은 -1번이에요.' },
      { names: ['history', 'messages'], form: '{{history}}', what: '인사말부터 모든 메시지를 JSON 배열로 넣어요. 각 항목에 role(user·char)과 data가 들어 있어요. {{history::role}}은 인사말 다음부터 "역할: 내용" 글로, 다른 말을 붙이면 내용만 넣어요.' },
      { names: ['userhistory'], form: '{{userhistory}}', what: '내 메시지들을 JSON 배열로 넣어요. 각 항목에 role과 data가 들어 있어요.' },
      { names: ['charhistory'], form: '{{charhistory}}', what: '인사말을 뺀 캐릭터 메시지들을 JSON 배열로 넣어요. 각 항목에 role과 data가 들어 있어요.' },
      { names: ['firstmsgindex'], form: '{{firstmsgindex}}', what: '채팅을 시작한 인사말의 카드 속 번호예요. 0부터 세요.' },
      { names: ['idleduration'], form: '{{idleduration}}', what: '마지막 메시지 뒤로 지난 시간이에요. 시:분:초로 넣어요.' },
      { names: ['messageunixtimearray'], form: '{{messageunixtimearray}}', what: '인사말 다음 메시지마다 보낸 시각을 밀리초 JSON 배열로 넣어요. 모르는 시각은 "0"이에요.' },
    ],
  },
  {
    title: '변수',
    guide: 'vars',
    commands: [
      { names: ['getvar'], form: '{{getvar::이름}}', what: '채팅 변수의 값이에요. 없으면 빈 텍스트예요.', uses: { conversation: '봇이 기록한 호감도나 날짜 같은 변수를 지시에 넣을 때 써요.' } },
      { names: ['getglobalvar'], form: '{{getglobalvar::toggle_키}}', what: '토글 값이에요. 이름은 toggle_ 뒤에 토글 키를 붙여요.' },
      { names: ['settempvar'], form: '{{settempvar::이름::값}}', what: '이 텍스트 안에서만 쓰는 임시 변수에 값을 넣어요.', example: ['{{settempvar::n::3}}{{tempvar::n}}', '3'] },
      { names: ['tempvar', 'gettempvar'], form: '{{tempvar::이름}}', what: '임시 변수의 값이에요.' },
    ],
  },
  {
    title: '조건',
    guide: 'when',
    commands: [
      {
        names: [],
        form: '{{#when::조건}}맞을 때 글{{:else}}아닐 때 글{{/when}}',
        what: '조건이 맞으면 앞의 텍스트를, 아니면 {{:else}} 뒤의 텍스트를 넣어요. 조건에 쓰는 말: is, isnot, >, <, >=, <=, and, or, not, var 변수, toggle 키, vis, visnot, tis, tisnot. 오른쪽부터 계산해요.',
        example: ['{{#when::3::>::2}}커요{{:else}}작아요{{/when}}', '커요'],
        uses: { conversation: '토글에 따라 지시를 켜고 끌 때 써요.' },
      },
      { names: [], form: '{{#if 조건}}글{{/if}}', what: '조건이 1이나 true면 안의 텍스트를 넣어요. 줄 앞 공백은 삭제해요. 공백을 두려면 #ifpure를 써요.', example: ['{{#if {{equal::a::a}}}}같아요{{/if}}', '같아요'] },
    ],
  },
  {
    title: '비교와 논리',
    guide: 'when',
    commands: [
      { names: ['equal'], form: '{{equal::가::나}}', what: '두 값이 같으면 1, 다르면 0이에요.', example: ['{{equal::a::a}}', '1'] },
      { names: ['notequal'], form: '{{notequal::가::나}}', what: '두 값이 다르면 1이에요.', example: ['{{notequal::a::b}}', '1'] },
      { names: ['greater'], form: '{{greater::가::나}}', what: '앞 숫자가 더 크면 1이에요.', example: ['{{greater::5::3}}', '1'] },
      { names: ['less'], form: '{{less::가::나}}', what: '앞 숫자가 더 작으면 1이에요.', example: ['{{less::5::3}}', '0'] },
      { names: ['greaterequal'], form: '{{greaterequal::가::나}}', what: '앞 숫자가 크거나 같으면 1이에요.', example: ['{{greaterequal::3::3}}', '1'] },
      { names: ['lessequal'], form: '{{lessequal::가::나}}', what: '앞 숫자가 작거나 같으면 1이에요.', example: ['{{lessequal::4::3}}', '0'] },
      { names: ['and'], form: '{{and::가::나}}', what: '둘 다 1이면 1이에요.', example: ['{{and::1::0}}', '0'] },
      { names: ['or'], form: '{{or::가::나}}', what: '하나라도 1이면 1이에요.', example: ['{{or::1::0}}', '1'] },
      { names: ['not'], form: '{{not::가}}', what: '1이면 0, 아니면 1이에요.', example: ['{{not::1}}', '0'] },
      { names: ['all'], form: '{{all::가::나::다}}', what: '모두 1이면 1이에요.', example: ['{{all::1::1::0}}', '0'] },
      { names: ['any'], form: '{{any::가::나::다}}', what: '하나라도 1이면 1이에요.', example: ['{{any::0::0::1}}', '1'] },
      { names: ['iserror'], form: '{{iserror::글}}', what: '텍스트가 error:로 시작하면 1이에요.', example: ['{{iserror::Error: 없음}}', '1'] },
    ],
  },
  {
    title: '계산',
    commands: [
      { names: ['calc'], form: '{{calc::식}}', what: '식을 계산해요. {{? 식}}으로 줄여 써도 돼요. $이름은 채팅 변수를 읽어요.', example: ['{{? 1 + 2 * 3}}', '7'] },
      { names: ['round'], form: '{{round::숫자}}', what: '반올림해요.', example: ['{{round::3.6}}', '4'] },
      { names: ['floor'], form: '{{floor::숫자}}', what: '내림해요.', example: ['{{floor::3.6}}', '3'] },
      { names: ['ceil'], form: '{{ceil::숫자}}', what: '올림해요.', example: ['{{ceil::3.2}}', '4'] },
      { names: ['abs'], form: '{{abs::숫자}}', what: '절댓값이에요.', example: ['{{abs::-5}}', '5'] },
      { names: ['remaind'], form: '{{remaind::가::나}}', what: '가를 나로 나눈 나머지예요.', example: ['{{remaind::7::3}}', '1'] },
      { names: ['pow'], form: '{{pow::가::나}}', what: '가의 나 제곱이에요.', example: ['{{pow::2::10}}', '1024'] },
      { names: ['fixnum'], form: '{{fixnum::숫자::자릿수}}', what: '소수점 아래를 그 자릿수로 맞춰요.', example: ['{{fixnum::3.14159::2}}', '3.14'] },
      { names: ['min'], form: '{{min::가::나::다}}', what: '가장 작은 수예요.', example: ['{{min::3::1::2}}', '1'] },
      { names: ['max'], form: '{{max::가::나::다}}', what: '가장 큰 수예요.', example: ['{{max::3::1::2}}', '3'] },
      { names: ['sum'], form: '{{sum::가::나::다}}', what: '합이에요.', example: ['{{sum::1::2::3}}', '6'] },
      { names: ['average'], form: '{{average::가::나::다}}', what: '평균이에요.', example: ['{{average::2::4}}', '3'] },
      { names: ['tonumber'], form: '{{tonumber::글}}', what: '텍스트에서 숫자만 남겨요.', example: ['{{tonumber::약 30kg}}', '30'] },
      { names: ['fromhex'], form: '{{fromhex::16진수}}', what: '16진수를 10진수로 바꿔요.', example: ['{{fromhex::ff}}', '255'] },
      { names: ['tohex'], form: '{{tohex::숫자}}', what: '10진수를 16진수로 바꿔요.', example: ['{{tohex::255}}', 'ff'] },
    ],
  },
  {
    title: '무작위',
    guide: 'random',
    commands: [
      { names: ['random'], form: '{{random::가::나::다}}', what: '하나를 무작위로 선택해요. 요청마다 새로 선택해요.', uses: { conversation: '보낼 때마다 다른 사건이나 분위기를 넣을 때 써요.' } },
      { names: ['pick'], form: '{{pick::가::나::다}}', what: '하나를 무작위로 선택하지만, 같은 채팅의 같은 차례에서는 항상 같은 값이에요.' },
      { names: ['randint'], form: '{{randint::1::10}}', what: '두 수 사이의 정수 하나예요. 두 수도 나올 수 있어요.' },
      { names: ['dice'], form: '{{dice::2d6}}', what: '주사위를 굴린 합이에요. 2d6은 6면체 둘이에요.' },
      { names: ['roll'], form: '{{roll::1d20}}', what: '주사위를 굴린 합이에요. 비워 두면 1d6이에요.' },
      { names: ['rollp', 'rollpick'], form: '{{rollp::1d20}}', what: 'roll과 같지만, pick처럼 같은 차례에서는 항상 같은 값이에요.' },
      { names: ['hash'], form: '{{hash::글}}', what: '텍스트마다 항상 같은 7자리 숫자예요.' },
    ],
  },
  {
    title: '시간',
    commands: [
      { names: ['time'], form: '{{time}}', what: '지금 시각이에요. {{time::HH:mm}}처럼 형식을 정할 수 있어요: YYYY MM DD HH hh mm ss dddd A.' },
      { names: ['date', 'datetimeformat'], form: '{{date}}', what: '오늘 날짜예요. {{date::YYYY년 MM월 DD일}}처럼 형식을 정할 수 있어요.' },
      { names: ['unixtime'], form: '{{unixtime}}', what: '지금 시각을 1970년부터 센 초로 넣어요.' },
      { names: ['isotime'], form: '{{isotime}}', what: '지금 UTC 시각이에요.' },
      { names: ['isodate'], form: '{{isodate}}', what: '오늘 UTC 날짜예요.' },
    ],
  },
  {
    title: '텍스트',
    commands: [
      { names: ['replace'], form: '{{replace::글::찾을 글::바꿀 글}}', what: '글에서 찾을 글을 모두 바꿀 글로 바꿔요.', example: ['{{replace::사과 두 개::사과::배}}', '배 두 개'] },
      { names: ['split'], form: '{{split::글::구분자}}', what: '텍스트를 구분자로 나눠 배열로 만들어요.', example: ['{{split::가,나::,}}', '["가","나"]'] },
      { names: ['join'], form: '{{join::배열::구분자}}', what: '배열의 항목을 구분자로 이어요.', example: ['{{join::["가","나"]:: / }}', '가 / 나'] },
      { names: ['spread'], form: '{{spread::배열}}', what: '배열의 항목을 바깥 명령어의 값들로 펼쳐요.', example: ['{{max::{{spread::[3,1,2]}}}}', '3'] },
      { names: ['trim'], form: '{{trim::글}}', what: '앞뒤 공백을 삭제해요.' },
      { names: ['length'], form: '{{length::글}}', what: '글자 수예요.', example: ['{{length::안녕}}', '2'] },
      { names: ['lower'], form: '{{lower::글}}', what: '영어를 소문자로 바꿔요.', example: ['{{lower::ABC}}', 'abc'] },
      { names: ['upper'], form: '{{upper::글}}', what: '영어를 대문자로 바꿔요.', example: ['{{upper::abc}}', 'ABC'] },
      { names: ['capitalize'], form: '{{capitalize::글}}', what: '첫 글자를 대문자로 바꿔요.', example: ['{{capitalize::hello}}', 'Hello'] },
      { names: ['startswith'], form: '{{startswith::글::앞 글}}', what: '글이 앞 글로 시작하면 1이에요.', example: ['{{startswith::안녕하세요::안녕}}', '1'] },
      { names: ['endswith'], form: '{{endswith::글::끝 글}}', what: '글이 끝 글로 끝나면 1이에요.', example: ['{{endswith::안녕하세요::요}}', '1'] },
      { names: ['contains'], form: '{{contains::글::찾을 글}}', what: '글에 찾을 글이 있으면 1이에요.', example: ['{{contains::사과 두 개::두}}', '1'] },
      { names: ['reverse'], form: '{{reverse::글}}', what: '글자 순서를 뒤집어요.', example: ['{{reverse::abc}}', 'cba'] },
      { names: ['unicodeencode'], form: '{{unicodeencode::글}}', what: '첫 글자의 유니코드 번호예요.', example: ['{{unicodeencode::A}}', '65'] },
      { names: ['unicodedecode'], form: '{{unicodedecode::번호}}', what: '유니코드 번호의 글자예요.', example: ['{{unicodedecode::65}}', 'A'] },
      { names: ['u', 'unicodedecodefromhex', 'ue', 'unicodeencodefromhex'], form: '{{u::16진수}}', what: '16진수 유니코드 번호의 글자예요.', example: ['{{u::41}}', 'A'] },
      { names: ['xor', 'xorencrypt', 'xorencode', 'xore'], form: '{{xor::글}}', what: '텍스트를 알아볼 수 없게 바꿔요. {{xordecrypt}}로 되돌려요.', example: ['{{xor::A}}', 'vg=='] },
      { names: ['xordecrypt', 'xordecode', 'xord'], form: '{{xordecrypt::글}}', what: '{{xor}}로 바꾼 텍스트를 되돌려요.', example: ['{{xordecrypt::vg==}}', 'A'] },
      { names: ['crypt', 'crypto', 'caesar', 'encrypt', 'decrypt'], form: '{{crypt::글}}', what: '글자를 밀어서 알아볼 수 없게 바꿔요. 한 번 더 쓰면 되돌아와요. {{crypt::글::숫자}}로 민 글은 -숫자로 되돌려요.', example: ['{{crypt::{{crypt::비밀}}}}', '비밀'] },
      { names: ['bkspc'], form: '{{bkspc}}', what: '앞의 마지막 단어를 삭제해요.', example: ['사과 배 {{bkspc}} 귤', '사과 귤'] },
      { names: ['erase'], form: '{{erase}}', what: '앞의 마지막 문장을 삭제해요.', example: ['안녕. 반가워 {{erase}} 잘 가', '안녕. 잘 가'] },
      { names: ['ruby', 'furigana'], form: '{{ruby::글::읽는 법}}', what: '글 위에 읽는 법을 작게 표시해요.' },
      { names: ['tex', 'latex', 'katex'], form: '{{tex::수식}}', what: 'LaTeX 수식을 화면에 그려요. 모델에게는 $$로 감싸서 보내요.', example: ['{{tex::x^2}}', '$$x^2$$'] },
      { names: ['codeblock'], form: '{{codeblock::코드}}', what: '코드를 코드 블록으로 보여 줘요. 안의 <와 >도 쓴 그대로 보여요.' },
      { names: ['file'], form: '{{file::이름::base64}}', what: 'Risu에서 첨부한 텍스트 파일이에요. 모델에게는 파일 내용을 보내요.' },
    ],
  },
  {
    title: '배열과 반복',
    guide: 'lists',
    commands: [
      { names: [], form: '{{#each 배열 as 이름}}글{{/each}}', what: '배열의 항목마다 안의 텍스트를 한 번씩 넣어요. {{slot::이름}}이 그 항목이에요.', example: ['{{#each ["가","나"] as x}}[{{slot::x}}]{{/each}}', '[가][나]'] },
      { names: ['slot'], form: '{{slot::이름}}', what: '#each가 지금 도는 항목이에요.' },
      { names: ['makearray', 'array', 'a'], form: '{{makearray::가::나}}', what: '값들로 배열을 만들어요.', example: ['{{makearray::가::나}}', '["가","나"]'] },
      { names: ['makedict', 'dict', 'object', 'o', 'd'], form: '{{makedict::키=값}}', what: '키=값들로 사전을 만들어요.', example: ['{{makedict::이름=미라::나이=20}}', '{"이름":"미라","나이":"20"}'] },
      { names: ['arraylength'], form: '{{arraylength::배열}}', what: '배열의 항목 수예요.', example: ['{{arraylength::["가","나"]}}', '2'] },
      { names: ['arrayelement'], form: '{{arrayelement::배열::번호}}', what: '그 번호의 항목이에요. 0부터 세요.', example: ['{{arrayelement::["가","나"]::1}}', '나'] },
      { names: ['dictelement'], form: '{{dictelement::사전::키}}', what: '그 키의 값이에요.', example: ['{{dictelement::{"이름":"미라"}::이름}}', '미라'] },
      { names: ['element', 'ele'], form: '{{element::JSON::키::키}}', what: '키나 번호를 차례로 따라가서 찾은 값이에요.', example: ['{{element::{"a":["x","y"]}::a::1}}', 'y'] },
      { names: ['arraypush'], form: '{{arraypush::배열::값}}', what: '끝에 값을 더한 배열이에요.', example: ['{{arraypush::["가"]::나}}', '["가","나"]'] },
      { names: ['arraypop'], form: '{{arraypop::배열}}', what: '마지막 항목을 뺀 배열이에요.', example: ['{{arraypop::["가","나"]}}', '["가"]'] },
      { names: ['arrayshift'], form: '{{arrayshift::배열}}', what: '첫 항목을 뺀 배열이에요.', example: ['{{arrayshift::["가","나"]}}', '["나"]'] },
      { names: ['arraysplice'], form: '{{arraysplice::배열::시작::개수::값}}', what: '시작 번호부터 개수만큼 빼고 그 자리에 값을 넣은 배열이에요.', example: ['{{arraysplice::["가","나","다"]::1::1::x}}', '["가","x","다"]'] },
      { names: ['arrayassert'], form: '{{arrayassert::배열::번호::값}}', what: '그 번호가 비어 있으면 값을 넣은 배열이에요.', example: ['{{arrayassert::["가"]::2::다}}', '["가","","다"]'] },
      { names: ['objectassert'], form: '{{objectassert::사전::키::값}}', what: '그 키가 없으면 값을 넣은 사전이에요.', example: ['{{objectassert::{"a":"1"}::b::2}}', '{"a":"1","b":"2"}'] },
      { names: ['range'], form: '{{range::[개수]}}', what: '0부터 개수 전까지의 숫자 배열이에요. [시작, 끝, 간격]으로도 써요.', example: ['{{range::[3]}}', '["0","1","2"]'] },
      { names: ['filter'], form: '{{filter::배열}}', what: '빈 항목과 겹치는 항목을 뺀 배열이에요. 뒤에 ::nonempty를 붙이면 빈 항목만, ::unique를 붙이면 겹치는 항목만 빼요.', example: ['{{filter::["가","","가","나"]}}', '["가","나"]'] },
    ],
  },
  {
    title: '함수',
    guide: 'func',
    commands: [
      { names: [], form: '{{#func 이름}}글{{/func}}', what: '안의 텍스트를 이름 붙인 함수로 정의해요. {{call}}로 호출해요.', example: ['{{#func 인사}}안녕, {{arg::1}}{{/func}}{{call::인사::미라}}', '안녕, 미라'] },
      { names: ['call'], form: '{{call::이름::값}}', what: '함수를 호출하고 값을 넘겨요.' },
      { names: ['arg'], form: '{{arg::1}}', what: '함수 안에서 넘겨받은 값이에요. 첫 값이 1번이에요.' },
      { names: ['return'], form: '{{return::값}}', what: '함수를 여기서 끝내고 값을 돌려줘요.', example: ['{{#func 확인}}{{return::끝}}남은 글{{/func}}{{call::확인}}', '끝'] },
    ],
  },
  {
    title: '모델',
    commands: [
      { names: ['model'], form: '{{model}}', what: '이 요청을 받는 모델의 id예요.' },
      { names: ['axmodel'], form: '{{axmodel}}', what: '보조 모델의 id예요. 정하지 않았으면 대화 모델의 id예요.' },
      { names: ['maxcontext'], form: '{{maxcontext}}', what: '모델의 컨텍스트 길이예요.' },
      { names: ['prefillsupported', 'prefill'], form: '{{prefillsupported}}', what: '모델이 AI 역할로 시작한 응답을 이어 쓰면 1이에요.' },
      { names: ['metadata'], form: '{{metadata::키}}', what: '키에 맞는 정보예요. maxcontext는 컨텍스트 길이, modelname과 modelinternalid는 모델의 id예요.', example: ['{{metadata::imateapot}}', '🫖'] },
    ],
  },
  {
    title: '글자 그대로',
    guide: 'literal',
    commands: [
      { names: [], form: '{{#pure}}텍스트{{/pure}}', what: '안의 텍스트를 명령어로 읽지 않고 쓴 그대로 넣어요.', example: ['{{#pure}}{{user}}{{/pure}}', '{{user}}'] },
      { names: [], form: '{{#escape}}텍스트{{/escape}}', what: '안의 텍스트를 쓴 그대로 넣고, 이후 정규식에서도 명령어로 읽히지 않게 해요. 앞뒤 빈 줄까지 두려면 #puredisplay를 써요.', example: ['{{#escape}}{{user}}{{/escape}}', '{{user}}'] },
      { names: [], form: '{{#code}}글{{/code}}', what: '줄바꿈과 탭을 삭제하고, \\n이나 \\u0041 같은 표기를 그 문자로 바꿔요.', example: ['{{#code}}\\u0041{{/code}}', 'A'] },
      { names: ['bo'], form: '{{bo}}', what: '{{를 명령어로 읽히지 않게 넣어요.', example: ['{{bo}}user{{bc}}', '{{user}}'] },
      { names: ['bc'], form: '{{bc}}', what: '}}를 명령어로 읽히지 않게 넣어요.' },
      { names: ['decbo'], form: '{{decbo}}', what: '{를 넣어요.' },
      { names: ['decbc'], form: '{{decbc}}', what: '}를 넣어요.' },
      { names: [':', '(', ')', '<', '>', ';'], form: '{{:}}', what: '그 문자를 명령어로 읽히지 않게 넣어요. ( ) < > ; 도 같아요.' },
    ],
  },
  {
    title: '줄바꿈과 메모',
    commands: [
      { names: ['br', 'newline'], form: '{{br}}', what: '줄바꿈이에요.' },
      { names: ['blank', 'none'], form: '{{blank}}', what: '아무것도 넣지 않아요.' },
      { names: ['risu'], form: '{{risu}}', what: 'Risu에서는 로고를 그려요. 헤이젤에서는 아무것도 넣지 않아요.' },
      { names: ['cbr'], form: '{{cbr}}', what: '줄바꿈이 아니라 \\n 두 글자를 넣어요. {{cbr::3}}은 세 번이에요.' },
      { names: [], form: '{{// 메모}}', what: '모델에 보내지 않는 메모예요.', example: ['안녕{{// 메모}}', '안녕'], uses: { conversation: '지시문에 메모를 남길 때 써요.', translate: '지시문에 메모를 남길 때 써요.' } },
      { names: ['hiddenkey'], form: '{{hiddenkey::키}}', what: '로어북 항목에 두면 다른 항목을 활성화하는 키로만 쓰이고, 모델에게는 보내지 않아요.' },
    ],
  },
  {
    title: '메시지와 화면에서만',
    guide: 'vars',
    commands: [
      { names: ['setvar'], form: '{{setvar::이름::값}}', what: '채팅 변수에 값을 넣어요.' },
      { names: ['addvar'], form: '{{addvar::이름::숫자}}', what: '채팅 변수에 숫자를 더해요.' },
      { names: ['setdefaultvar'], form: '{{setdefaultvar::이름::값}}', what: '채팅 변수가 비어 있을 때만 값을 넣어요.' },
      { names: ['chatindex'], form: '{{chatindex}}', what: '이 메시지의 번호예요.' },
      { names: ['role'], form: '{{role}}', what: '이 메시지를 쓴 쪽이에요: user나 char.' },
      { names: ['isfirstmsg'], form: '{{isfirstmsg}}', what: '이 메시지가 인사말이면 1이에요.' },
      { names: ['messagetime'], form: '{{messagetime}}', what: '이 메시지를 보낸 시각이에요.' },
      { names: ['messagedate'], form: '{{messagedate}}', what: '이 메시지를 보낸 날짜예요.' },
      { names: ['messageidleduration'], form: '{{messageidleduration}}', what: '앞 메시지와 이 메시지 사이에 지난 시간이에요.' },
      { names: ['comment'], form: '{{comment::글}}', what: '화면에만 보이는 텍스트예요. 모델에게는 보내지 않아요.' },
      { names: ['img'], form: '{{img::이미지 이름}}', what: '캐릭터 이미지를 보여 줘요.' },
      { names: ['image'], form: '{{image::이미지 이름}}', what: '캐릭터 이미지를 한 줄 차지하게 보여 줘요.' },
      { names: ['asset'], form: '{{asset::에셋 이름}}', what: '캐릭터 이미지나 영상을 보여 주고 줄을 바꿔요. 영상은 소리 없이 반복해요.' },
      { names: ['video'], form: '{{video::영상 이름}}', what: '캐릭터 영상을 재생 버튼과 함께 보여 줘요. 소리는 읽는 사람이 재생할 때 나요.' },
      { names: ['videoimg'], form: '{{video-img::영상 이름}}', what: '캐릭터 영상을 소리 없이 반복해서 보여 줘요.' },
      { names: ['raw', 'path'], form: '{{raw::에셋 이름}}', what: '캐릭터 이미지나 영상의 주소예요. HTML 안에 써요.' },
      { names: ['source'], form: '{{source::char}}', what: '캐릭터(char)나 페르소나(user)의 프로필 이미지 주소예요.' },
      { names: ['button'], form: '{{button::글::트리거}}', what: '봇의 버튼이에요. 누르면 그 이름의 트리거를 실행해요.' },
      { names: ['triggerid'], form: '{{triggerid}}', what: '버튼을 눌러 실행한 트리거에서, 그 버튼의 risu-id 값이에요.' },
      { names: ['inlay', 'inlayed', 'inlayeddata'], form: '{{inlay::id}}', what: 'Risu 채팅에 붙어 있던 이미지를 보여 줘요. 모델에게는 보내지 않아요.' },
      { names: ['screenwidth'], form: '{{screenwidth}}', what: '화면 너비예요.' },
      { names: ['screenheight'], form: '{{screenheight}}', what: '화면 높이예요.' },
    ],
  },
];

export function commandSnippet({ form }: Command): Snippet {
  const placeholder = /[가-힣]+(?: [가-힣]+)*/.exec(form);
  return { text: form, select: placeholder ? [placeholder.index, placeholder.index + placeholder[0].length] : [form.length, form.length] };
}
