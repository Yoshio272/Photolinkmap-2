// ===== Core Types =====
// MediaPin（拡張ピン型）はtypes/pin.tsで定義・export
export type { MediaPin as Pin, PinType, PinMedia } from './pin'
export { PIN_TYPE_LABELS, PIN_TYPE_ICONS, PIN_TYPE_DEFAULT_COLORS, getPinType, getPinViewUrl, get360ImageUrl, driveUrlToDirectUrl, extractDriveFileId, migratePin } from './pin'

export interface LatLng { lat: number; lng: number }

export interface CalibPoint {
  px: number; py: number;
  lat?: number; lng?: number;
}

export interface CalibState {
  points: CalibPoint[];
  step: 1 | 2;
  ready: boolean;
}

export interface StyleConfig {
  pinColor: string;
  pinSize: number;
  arrowLength: number;
}

/** GasConfig は StorageConfig.googleDrive 相当 - 後方互換用 */
export interface GasConfig {
  webAppUrl: string;
  folderId: string;
}
/** 統合ストレージ設定（StorageProvider方式） */
export type { StorageConfig, StorageProviderType } from '../services/storage'

export interface ExportConfig {
  noLinkAction: 'skip' | 'map';
  noteText: string;
  fileName: string;
  /** ハイパーリンク埋め込み（デフォルトtrue・falseで印刷用PDF） */
  enableHyperlink?: boolean;
}

/** プロジェクト保存データ */
export interface Project {
  version: string;
  name: string;
  savedAt: string;
  updatedAt?: string;
  // 背景
  background?: import('../services/background').SerializedBackground;
  // 表示状態
  zoomScale: number;
  scrollX: number;
  scrollY: number;
  // キャリブ
  calib?: CalibState;
  /** キャリブレーション使用フラグ（選択制） */
  useCalib?: boolean;
  // ピン
  pins: import('./pin').MediaPin[];
  // スタイル
  style: StyleConfig;
  // ストレージ設定（StorageProvider方式）
  storageConfig?: import('../services/storage').StorageConfig;
  // 後方互換用 GAS設定
  gas: GasConfig;
  // 出力設定
  exportConfig?: ExportConfig;
  // 後方互換用
  pdfName?: string;
  canvasW: number;
  canvasH: number;
  pdfW: number;
  pdfH: number;
}

export type AppMode = 'calib' | 'pin' | 'view' | 'place-photo';
export type SideTab = 'settings' | 'photos' | 'placement' | 'sync' | 'export';
