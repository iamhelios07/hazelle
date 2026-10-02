import { Link, Row, Stack, Text } from '../ui';

// The notices GPLv3 §5(d) has an interactive program show, with AGPL-3.0 §13's offer of the running version's
// source. It shows before sign-in too: the page's code reaches a browser that never makes an account.
// scripts/source.sh writes both files at build, so the dev server has neither.
export function LegalNotice() {
  return (
    <Stack gap="related">
      <Text variant="note">
        © 2026 risu-alpha 만든이. AGPL-3.0에 따라 누구나 쓰고, 고치고, 다시 나눌 수 있는 자유 소프트웨어예요. 보증은 없어요.
      </Text>
      <Row kind="tags">
        <Link href="/source.tar.gz" download="risu-alpha-source.tar.gz">
          소스 코드 받기
        </Link>
        <Link href="/license.txt">라이선스 전문</Link>
      </Row>
    </Stack>
  );
}
