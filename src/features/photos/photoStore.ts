/**
 * 写真管理ストア
 *
 * PhotosTab のローカル state だと手動配置後に
 * コンポーネント再レンダー時に rows が pin と同期されず消える問題を解決。
 * App.tsx に持ち上げて useReducer で一元管理する。
 */

export type PhotoStatus =
  | 'unplaced'   // GPS無し・まだ配置していない
  | 'gps'        // GPS座標から自動配置済み
  | 'manual'     // 手動配置ボタンで配置済み
  | 'moved'      // ドラッグで位置を修正済み
  | 'deleted'    // 削除済み（一覧から非表示）

export interface PhotoEntry {
  /** ファイル名（一意キー）*/
  fileName: string
  /** 表示名（拡張子なし）*/
  displayName: string
  /** objectURL（ローカル表示用）*/
  objectUrl: string
  /** GPS情報があるか */
  hasGps: boolean
  /** 360度写真か（ファイル名自動判定 + 手動変更可） */
  is360: boolean
  /** 配置状態 */
  status: PhotoStatus
  /** 対応するPin ID */
  pinId?: string
}

export type PhotoAction =
  | { type: 'ADD_PHOTOS';    photos: PhotoEntry[] }
  | { type: 'SET_STATUS';    fileName: string; status: PhotoStatus; pinId?: string }
  | { type: 'SYNC_PINS';     pins: import('../../types').Pin[] }
  | { type: 'DELETE_PHOTO';  fileName: string }
  | { type: 'CLEAR_ALL' }
  | { type: 'RESTORE';       photos: PhotoEntry[] }

export function photoReducer(state: PhotoEntry[], action: PhotoAction): PhotoEntry[] {
  switch (action.type) {
    case 'ADD_PHOTOS': {
      // 既存ファイル名は上書きしない（重複読込防止）
      const existing = new Set(state.map(e => e.fileName))
      const newEntries = action.photos.filter(p => !existing.has(p.fileName))
      return [...state, ...newEntries]
    }
    case 'SET_STATUS': {
      return state.map(e =>
        e.fileName === action.fileName
          ? { ...e, status: action.status, pinId: action.pinId ?? e.pinId }
          : e
      )
    }
    case 'SYNC_PINS': {
      // pinの状態変化（moved等）をPhotoEntryに反映
      return state.map(entry => {
        const pin = action.pins.find(p =>
          p.photoFileName === entry.fileName ||
          p.name === entry.displayName
        )
        if (!pin) return entry
        let status: PhotoStatus = entry.status
        if (pin.moved) status = 'moved'
        else if (pin.placedBy === 'manual') status = 'manual'
        else if (pin.src === 'gps') status = 'gps'
        return { ...entry, status, pinId: pin.id }
      })
    }
    case 'DELETE_PHOTO':
      return state.map(e => e.fileName === action.fileName ? { ...e, status: 'deleted' } : e)
    case 'CLEAR_ALL':
      return []
    case 'RESTORE':
      return action.photos
    default:
      return state
  }
}

// ===== ファクトリ =====
export function createPhotoEntry(
  fileName: string,
  objectUrl: string,
  hasGps: boolean,
  is360?: boolean
): PhotoEntry {
  return {
    fileName,
    displayName: fileName.replace(/\.[^.]+$/, ''),
    objectUrl,
    hasGps,
    is360: is360 ?? /360|sphere|pano|panorama|equirect/i.test(fileName),
    status: 'unplaced',
    pinId: undefined,
  }
}

export const STATUS_LABELS: Record<PhotoStatus, string> = {
  unplaced: '未配置',
  gps:      'GPS配置',
  manual:   '手動配置',
  moved:    '移動済',
  deleted:  '削除済',
}

export const STATUS_BADGE: Record<PhotoStatus, string> = {
  unplaced: 'badge-gray',
  gps:      'badge-green',
  manual:   'badge-blue',
  moved:    'badge-warn',
  deleted:  'badge-gray',
}
