import { openBlob, sealBlob } from '../vault/blobs';
import type { VaultKey } from '../vault/keys';
import { objectKey } from '../vault/objects';
import type { ApiResult, api as realApi } from './api';

type Api = typeof realApi;

export type OpenVault = { accountId: string; vaultKey: VaultKey; request: Api };

export async function putBlob({ accountId, vaultKey, request }: OpenVault, id: string, bytes: Uint8Array<ArrayBuffer>): Promise<ApiResult<undefined>> {
  return request<undefined>('PUT', `blobs/${id}`, await sealBlob(await objectKey(vaultKey), accountId, id, bytes));
}

// A body that does not open answers 'unreadable', never empty bytes.
export async function getBlob({ accountId, vaultKey, request }: OpenVault, id: string): Promise<ApiResult<Uint8Array<ArrayBuffer>>> {
  const result = await request<Uint8Array<ArrayBuffer>>('GET', `blobs/${id}`);
  if (!result.ok) return result;
  const bytes = await openBlob(await objectKey(vaultKey), accountId, id, result.data);
  return bytes ? { ok: true, data: bytes } : { ok: false, error: 'unreadable' };
}

export async function removeBlob({ request }: OpenVault, id: string): Promise<ApiResult<undefined>> {
  return request<undefined>('DELETE', `blobs/${id}`);
}
