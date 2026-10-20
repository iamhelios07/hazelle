import { useState } from 'react';
import { navigate } from '../shell/router';
import { Button, Dialog, Intro, Stack, Steps } from '../ui';
import { type News, type Tour as TourData } from './release';
import { tourArt } from './tourArt';

// A release's headline feature, shown page by page (design §6.15): a picture drawn in code, a title and a line, then
// 실제로 보기 into the feature or 나중에. Opened once by Workspace on a device that has not seen it, and again from 새 소식.
export const TOUR = { see: '둘러보기', later: '나중에', next: '다음' };

export function TourDialog({ news, onClose }: { news: News & { tour: TourData }; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const { pages, go } = news.tour;
  const page = pages[step]!;
  const last = step === pages.length - 1;
  return (
    <Dialog
      title={news.tour.title}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {TOUR.later}
          </Button>
          {last ? (
            <Button
              variant="primary"
              onClick={() => {
                onClose();
                navigate(go.route);
              }}
            >
              {go.label}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setStep(step + 1)}>
              {TOUR.next}
            </Button>
          )}
        </>
      }
    >
      <Stack gap="group">
        {tourArt[page.art]}
        <Intro title={page.title}>{page.text}</Intro>
        <Steps current={step + 1} total={pages.length} />
      </Stack>
    </Dialog>
  );
}
