import { openBlob, sealBlob } from '../vault/blobs';
import type { VaultKey } from '../vault/keys';
import { objectKey } from '../vault/objects';
import type { ApiResult, api as realApi } from './api';

type Api = typeof realApi;

export class Files {
  private constructor(
    private readonly accountId: string,
    private readonly key: CryptoKey,
    private readonly request: Api,
  ) {}

  static async open(accountId: string, vaultKey: VaultKey, request: Api): Promise<Files> {
    return new Files(accountId, await objectKey(vaultKey), request);
  }

  async put(id: string, bytes: Uint8Array<ArrayBuffer>): Promise<ApiResult<undefined>> {
    return this.request<undefined>('PUT', `blobs/${id}`, await sealBlob(this.key, this.accountId, id, bytes));
  }

  // A body that does not open answers 'unreadable', never empty bytes.
  async get(id: string): Promise<ApiResult<Uint8Array<ArrayBuffer>>> {
    const result = await this.request<Uint8Array<ArrayBuffer>>('GET', `blobs/${id}`);
    if (!result.ok) return result;
    const bytes = await openBlob(this.key, this.accountId, id, result.data);
    return bytes ? { ok: true, data: bytes } : { ok: false, error: 'unreadable' };
  }

  remove(id: string): Promise<ApiResult<undefined>> {
    return this.request<undefined>('DELETE', `blobs/${id}`);
  }
}
