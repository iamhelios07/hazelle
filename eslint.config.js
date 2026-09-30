import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import boundaries from './eslint/boundaries.js';

const CSS_IMPORT = { regex: '\\.css$', message: 'Only src/app/ui imports CSS (src/app/ui/README.md).' };
const HEX_COLOR = {
  selector: 'Literal[value=/^#(?:[0-9a-fA-F]{3,4}){1,2}$/]',
  message: 'Colors live in src/app/ui/foundation/tokens.css.',
};
// Wordings replaced by src/app/common/words.ts; one concept reads one way on every screen.
const RETIRED = '/삭제|복제|다시 생성|전체 기본값|본 대화|별표 찍|별표 목록|별표 모델|없어졌어요|고치기|다 했어요|고르기 끝|처음대로|AI에게|[와과] 같게|찾기|답장 다시 받기|새로 받기|노트가 없을 때 쓰는 글|노트 기본 글/';
const RETIRED_COPY = {
  selector: `:matches(Literal[value=${RETIRED}], TemplateElement[value.raw=${RETIRED}], JSXText[value=${RETIRED}])`,
  message: 'A retired wording: say it the way src/app/common/words.ts does.',
};
const STYLE_PROPS = {
  selector: 'JSXAttribute[name.name=/^(className|style)$/]',
  message: 'Only src/app/ui styles elements (src/app/ui/README.md).',
};

export default defineConfig([
  globalIgnores(['dist/', '.wrangler/', '.claude/', 'worker-configuration.d.ts', '**/*.module.d.css.ts']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/**'],
    plugins: { local: { rules: { boundaries } } },
    rules: { 'local/boundaries': 'error' },
  },
  {
    files: ['src/app/**'],
    rules: { 'no-restricted-syntax': ['error', HEX_COLOR, RETIRED_COPY] },
  },
  {
    files: ['src/app/**'],
    ignores: ['src/app/ui/**', 'src/app/main.tsx'],
    rules: { 'no-restricted-imports': ['error', { patterns: [CSS_IMPORT] }], 'no-restricted-syntax': ['error', HEX_COLOR, STYLE_PROPS, RETIRED_COPY] },
  },
]);
