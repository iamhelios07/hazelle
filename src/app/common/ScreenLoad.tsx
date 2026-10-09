import { Component, Suspense, type ReactNode } from 'react';
import { Button, Intro, Progress, Screen } from '../ui';

export class ScreenLoad extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return (
      <Screen align="center">
        <Intro title="화면을 불러오지 못했어요">연결을 확인한 뒤 다시 시도해 주세요.</Intro>
        <Button onClick={() => location.reload()}>새로고침</Button>
      </Screen>
    );
    return (
      <Suspense fallback={<Screen align="center"><Progress steps={[{ label: '화면을 불러오는 중' }]} /></Screen>}>
        {this.props.children}
      </Suspense>
    );
  }
}
