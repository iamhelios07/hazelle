import { Brand, Intro, Screen, Section, Stack, Text } from '../ui';
import { EFFECTIVE, PRIVACY, TERMS, type LegalText } from './legal';
import { LegalNotice } from './LegalNotice';

// main.tsx asks before the account flow, so both pages read the same signed in or out.
export function legalPage(path: string) {
  const text = [TERMS, PRIVACY].find((page) => page.path === path);
  return text ? <LegalPage text={text} /> : null;
}

function LegalPage({ text }: { text: LegalText }) {
  return (
    <Screen top={<Brand />}>
      <Intro title={text.title}>시행일: {EFFECTIVE}</Intro>
      {text.sections.map((section) => (
        <Section key={section.title} title={section.title}>
          <Stack gap="related">
            {section.body.flatMap((block) => (typeof block === 'string' ? [block] : block.map((line) => `· ${line}`))).map((line) => (
              <Text key={line}>{line}</Text>
            ))}
          </Stack>
        </Section>
      ))}
      <LegalNotice />
    </Screen>
  );
}
