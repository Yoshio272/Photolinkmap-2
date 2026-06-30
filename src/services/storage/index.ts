/**
 * StorageProviderFactory
 * 設定に基づいて適切なプロバイダーインスタンスを返す
 */
export type { StorageProvider, StorageConfig, StorageFile, StorageListResult } from './StorageProvider'
export type { StorageProviderType, GoogleDriveConfig, BoxConfig } from './StorageProvider'
export {
  STORAGE_PROVIDER_LABELS,
  STORAGE_PROVIDER_AVAILABLE,
  createDefaultStorageConfig,
  migrateGasConfigToStorage,
  storageConfigToGasConfig,
} from './StorageProvider'
export { googleDriveProvider } from './GoogleDriveProvider'
export { boxProvider } from './BoxProvider'

import type { StorageProvider } from './StorageProvider'
import type { StorageProviderType } from './StorageProvider'
import { googleDriveProvider } from './GoogleDriveProvider'
import { boxProvider } from './BoxProvider'

const PROVIDERS: Record<StorageProviderType, StorageProvider> = {
  'google-drive': googleDriveProvider,
  'box':          boxProvider,
  'onedrive':     createUnimplementedProvider('OneDrive'),
  'sharepoint':   createUnimplementedProvider('SharePoint'),
  'dropbox':      createUnimplementedProvider('Dropbox'),
}

/** プロバイダーを取得 */
export function getStorageProvider(type: StorageProviderType): StorageProvider {
  return PROVIDERS[type] ?? PROVIDERS['google-drive']
}

/** 未実装プロバイダーのスタブを生成 */
function createUnimplementedProvider(name: string): StorageProvider {
  return {
    type: 'onedrive' as StorageProviderType,  // stub
    listFiles: async () => ({ success: false, error: `${name}は現在準備中です` }),
    getFileViewUrl: (id) => id,
    getFile360Url: (id) => id,
    getPdfLinkUrl: (_, __, ___, lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`,
    extractFileId: () => null,
    extractFolderId: () => null,
    isConfigured: () => false,
    validateConfig: () => `${name}は現在準備中です`,
  }
}
