import { RETRIES } from '../../connectors/registry';
import { RETRY_MOST } from '../../contracts/streams';
import { setSharedRetries } from '../../runtime/connections';
import { detailLabel, RETRY_COUNT, RETRY_HELP } from '../common/words';
import { useSettings, useStore } from '../session';
import { useToast } from '../toast';
import { Disclosure, SettingGroup, SettingRow, Stepper } from '../ui';

export function RetryDefaults() {
  const store = useStore();
  const toast = useToast();
  const { retries } = useSettings();
  return (
    <Disclosure label={detailLabel(retries === undefined ? 0 : 1)}>
      <SettingGroup label="세부 설정">
        <SettingRow
          label={RETRY_COUNT}
          help={`${RETRY_HELP} API 연결이나 설정 묶음마다 따로 정할 수도 있어요.`}
          changed={retries !== undefined}
          control={
            <Stepper
              label={RETRY_COUNT}
              less="한 번 덜 보내기"
              more="한 번 더 보내기"
              value={retries ?? RETRIES}
              min={0}
              max={RETRY_MOST}
              onChange={(next) => void setSharedRetries(store, next).then((result) => result.ok || toast.failed(result))}
            />
          }
        />
      </SettingGroup>
    </Disclosure>
  );
}
