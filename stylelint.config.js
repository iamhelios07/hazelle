// Every raw design value lives in src/app/ui/tokens.css. Elsewhere, these properties must use its
// custom properties, so a style change is made once (src/app/ui/README.md).
const TOKEN_PROPERTIES = [
  '/color$/',
  'fill',
  'stroke',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  '/radius$/',
  'box-shadow',
  'gap',
  'row-gap',
  'column-gap',
  '/^padding/',
  '/^margin/',
];

export default {
  plugins: ['stylelint-declaration-strict-value'],
  rules: {
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': ['rgb', 'rgba', 'hsl', 'hsla'],
    'scale-unlimited/declaration-strict-value': [
      TOKEN_PROPERTIES,
      {
        expandShorthand: true,
        ignoreValues: ['0', 'auto', 'inherit', 'transparent', 'currentColor', 'none'],
      },
    ],
  },
  overrides: [
    {
      files: ['src/app/ui/tokens.css'],
      rules: {
        'color-no-hex': null,
        'function-disallowed-list': null,
        'scale-unlimited/declaration-strict-value': null,
      },
    },
  ],
};
