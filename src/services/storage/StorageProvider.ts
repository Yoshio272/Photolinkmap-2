/**
 * StorageProvider 抽象インターフェース
 *
 * Google Drive / Box / OneDrive / SharePoint などを統一的に扱う。
 * Photo Sphere Viewer・PDF出力はこのインターフェースのみに依存し、
 * 具体的なストレージの種類を意識しない。
 */

// ===== 共通型 =====

export type StorageProviderType =
  | 'google-drive'   // 実装済み（GAS経由JSONP）
  | 'box'            // 雛形実装済み（OAuth後に完全対応）
  | 'onedrive'       // 将来対応
  | 'sharepoint'     // 将来対応
  | 'dropbox'        // 将来対応

export const STORAGE_PROVIDER_LABELS: Record<StorageProviderType, string> = {
  'google-drive': 'Google Drive',
  'box':          'Box',
  'onedrive':     'OneDrive（準備中）',
  'sharepoint':   'SharePoint（準備中）',
  'dropbox':      'Dropbox（準備中）',
}

export const STORAGE_PROVIDER_AVAILABLE: Record<StorageProviderType, boolean> = {
  'google-drive': true,
  'box':          true,   // OAuth雛形実装済み
  'onedrive':     false,
  'sharepoint':   false,
  'dropbox':      false,
}

/** ストレージ内のファイル情報 */
export interface StorageFile {
  /** プロバイダー固有のファイルID */
  fileId: string
  /** ファイル名 */
  name: string
  /** 閲覧用URL（ブラウザで開けるURL）*/
  viewUrl: string
  /** 直接ダウンロードURL（PSV等で画像として読み込める）*/
  directUrl?: string
  /** MIMEタイプ */
  mimeType?: string
}

/** ストレージ内のフォルダ情報 */
export interface StorageFolder {
  folderId: string
  name: string
  url: string
}

/** ファイル一覧取得結果 */
export interface StorageListResult {
  success: boolean
  folderName?: string
  files?: StorageFile[]
  error?: string
}

// ===== StorageProvider インターフェース =====

export interface StorageProvider {
  readonly type: StorageProviderType

  /** フォルダ内のファイル一覧を取得 */
  listFiles(folderId: string): Promise<StorageListResult>

  /** ファイルの閲覧URLを返す */
  getFileViewUrl(fileId: string): string

  /** 360度写真ビューワー用の直接アクセスURLを返す */
  getFile360Url(fileId: string): string

  /** PDF出力用リンクURLを返す（ViewerType対応）*/
  getPdfLinkUrl(
    fileId: string,
    isSpherical: boolean,
    title: string,
    lat: number,
    lng: number,
  ): string

  /** URLからファイルIDを抽出（ユーザーが貼り付けたURLから自動解析）*/
  extractFileId(url: string): string | null

  /** URLからフォルダIDを抽出 */
  extractFolderId(url: string): string | null

  /** このプロバイダーが利用可能な状態か（設定済みか）*/
  isConfigured(config: StorageConfig): boolean

  /** 設定の検証とエラーメッセージ */
  validateConfig(config: StorageConfig): string | null
}

// ===== ストレージ設定型 =====

/** Google Drive 設定 */
export interface GoogleDriveConfig {
  webAppUrl: string    // GAS WebApp URL
  folderId: string     // DriveフォルダID
}

/** Box 設定 */
export interface BoxConfig {
  clientId?: string          // OAuth Client ID（UI設定）
  accessToken?: string       // アクセストークン（認証後・localStorage に保存）
  folderId?: string          // BoxルートフォルダID（案件フォルダの作成先）
  enterpriseId?: string      // Enterprise ID（企業利用時）
}

/** 統合ストレージ設定（Project に保存される）*/
export interface StorageConfig {
  /** 選択中のプロバイダー */
  provider: StorageProviderType
  /** Google Drive 設定 */
  googleDrive: GoogleDriveConfig
  /** Box 設定 */
  box: BoxConfig
  /** 今後追加される設定のための拡張スペース */
  meta?: Record<string, unknown>
}

export function createDefaultStorageConfig(): StorageConfig {
  return {
    provider: 'google-drive',
    googleDrive: { webAppUrl: '', folderId: '' },
    box: {},
  }
}

/** 後方互換: 旧 GasConfig を StorageConfig に変換 */
export function migrateGasConfigToStorage(gas: { webAppUrl: string; folderId: string }): StorageConfig {
  return {
    ...createDefaultStorageConfig(),
    googleDrive: { webAppUrl: gas.webAppUrl, folderId: gas.folderId },
  }
}

/** 現在の設定からGasConfig相当を取得（後方互換用）*/
export function storageConfigToGasConfig(config: StorageConfig): { webAppUrl: string; folderId: string } {
  return config.googleDrive
}
