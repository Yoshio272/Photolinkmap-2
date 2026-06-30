/**
 * ピン種別の拡張可能Enum
 * 将来: '360video' | 'matterport' | 'drone' | 'lidar' なども追加可能
 */
export type PinType = 'photo' | '360' | 'location'

export const PIN_TYPE_LABELS: Record<PinType, string> = {
  photo:    '通常写真',
  '360':    '360度写真',
  location: '位置のみ',
}

export const PIN_TYPE_ICONS: Record<PinType, string> = {
  photo:    '📷',
  '360':    '🌐',
  location: '📍',
}

/** ピンのメディア情報 */
export interface PinMedia {
  type: PinType
  /** Google Drive ファイルID（typeが360またはphotoの場合） */
  driveFileId?: string
  /** 直接URL（DriveでもなんでもOK） */
  url?: string
  /** 表示タイトル */
  title?: string
}

/** 拡張Pin型（既存Pinとの互換維持） */
export interface MediaPin {
  id: string
  px: number; py: number
  lat: number; lng: number
  name: string
  memo: string
  /** 後方互換用: 通常写真のリンク（media.urlの別名） */
  link: string
  deg: number
  r: number
  al: number
  /** 矢印表示フラグ（デフォルトfalse） */
  showArrow?: boolean
  color: string
  src: 'manual' | 'gps'
  photoFileName?: string
  /** 新: メディア情報 */
  media?: PinMedia
  /** 配置方法 */
  placedBy?: 'gps' | 'manual'
  /** GPS配置後にドラッグ移動されたか */
  moved?: boolean
}

/** 後方互換: 旧PinをMediaPinに変換 */
export function migratePin(pin: unknown): MediaPin {
  const p = pin as MediaPin
  if (!p.media) {
    p.media = {
      type: 'photo',
      url: p.link || undefined,
    }
  }
  return p
}

/** PinTypeから色を取得（デフォルトカラー） */
export const PIN_TYPE_DEFAULT_COLORS: Record<PinType, string> = {
  photo:    '#1565C0',
  '360':    '#1D9E75',
  location: '#E53935',
}

/** Google Drive URLから直接アクセス可能な画像URLを生成 */
export function driveUrlToDirectUrl(input: string): string {
  // https://drive.google.com/file/d/{ID}/view → https://drive.google.com/uc?export=download&id={ID}
  const fileMatch = input.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)
  if (fileMatch) {
    return `https://drive.google.com/uc?export=download&id=${fileMatch[1]}`
  }
  // すでにuc?形式 or その他URLはそのまま
  return input
}

/** Drive URLからファイルIDを抽出 */
export function extractDriveFileId(input: string): string | null {
  const m = input.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}

/** ピンの表示用URLを取得 */
export function getPinViewUrl(pin: MediaPin): string {
  if (pin.media?.driveFileId) {
    return `https://drive.google.com/file/d/${pin.media.driveFileId}/view`
  }
  return pin.media?.url || pin.link || ''
}

/** 360度ビューワー用の画像URLを取得（直接アクセス可能な形式に変換） */
export function get360ImageUrl(pin: MediaPin): string {
  if (pin.media?.driveFileId) {
    // GoogleドライブはCORSがあるためプロキシが必要
    // Drive共有リンクを embed 形式に変換（PSVで読み込める）
    return `https://lh3.googleusercontent.com/d/${pin.media.driveFileId}`
  }
  if (pin.media?.url) return driveUrlToDirectUrl(pin.media.url)
  return driveUrlToDirectUrl(pin.link)
}

/** ピンのタイプを取得（後方互換） */
export function getPinType(pin: MediaPin): PinType {
  return pin.media?.type ?? 'photo'
}
