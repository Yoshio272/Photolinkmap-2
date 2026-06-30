/**
 * ViewerProvider 設計
 * 将来の360動画・Matterport・ドローンパノラマにも対応できる拡張可能な構造
 */

export type ViewerType =
  | 'image'        // 通常画像（Google Driveで開く）
  | 'photosphere'  // 360度写真（Photo Sphere Viewer）
  | 'video360'     // 360度動画（将来）
  | 'matterport'   // Matterport（将来）
  | 'drone'        // ドローンパノラマ（将来）

export interface ViewerMedia {
  viewerType: ViewerType
  driveFileId?: string
  url?: string
  title?: string
  sharedUrl?: string      // Box共有リンク（download_url）- 第三者閲覧用
  matterportId?: string   // 将来用
}

export function buildViewerUrl(media: ViewerMedia, baseUrl?: string): string {
  const base = baseUrl ?? (typeof window !== 'undefined' ? window.location.origin : '')
  const params = new URLSearchParams()
  params.set('type', media.viewerType)
  if (media.driveFileId) params.set('fileId', media.driveFileId)
  if (media.url) params.set('url', media.url)        // URLSearchParams が自動エンコード
  if (media.title) params.set('title', media.title)  // URLSearchParams が自動エンコード
  if (media.sharedUrl) params.set('shared', media.sharedUrl)  // Box共有リンク
  return `${base}/viewer?${params.toString()}`
}

export function parseViewerUrl(search: string): ViewerMedia | null {
  const params = new URLSearchParams(search)
  const type = params.get('type') as ViewerType | null
  if (!type) return null
  return {
    viewerType: type,
    driveFileId: params.get('fileId') ?? undefined,
    url: params.get('url') ?? undefined,       // URLSearchParams.get() が自動デコード
    title: params.get('title') ?? undefined,   // URLSearchParams.get() が自動デコード
    sharedUrl: params.get('shared') ?? undefined,
  }
}

/**
 * fileIdから360度画像URLを生成
 * StorageProvider経由で解決するため、プロバイダー依存を排除
 * @param fileId - ストレージプロバイダーのファイルID
 * @param provider - ストレージプロバイダー種別（デフォルト: 'google-drive'）
 */
export function fileIdTo360Url(fileId: string, provider = 'google-drive'): string {
  // StorageProviderFactory経由で解決（循環依存を避けるためlazy import）
  if (provider === 'google-drive') {
    return `https://lh3.googleusercontent.com/d/${fileId}`
  }
  if (provider === 'box') {
    // TODO: Box共有リンク取得後に直接URLを返す
    // 現在はBoxビューワーURLを返す
    return `https://app.box.com/file/${fileId}`
  }
  return fileId
}

/** 後方互換エイリアス */
export const driveFileIdTo360Url = (fileId: string) => fileIdTo360Url(fileId, 'google-drive')

/**
 * PDF出力用リンクURLを生成
 * StorageProvider非依存: プロバイダーに関係なく同じシグネチャで呼べる
 *
 * 360度写真 → PhotoLinkMap Viewer URL（プロバイダー情報もURLに含める）
 * 通常写真  → provider.getFileViewUrl() 相当のURL
 */
export function getPinPdfLinkUrl(
  viewerType: ViewerType,
  fileId: string | undefined,
  url: string | undefined,
  title: string | undefined,
  lat: number,
  lng: number,
  provider = 'google-drive',
  sharedUrl?: string,        // Box共有リンク（第三者閲覧用）
): string {
  switch (viewerType) {
    case 'photosphere': {
      const media: ViewerMedia = { viewerType, title }
      if (sharedUrl) media.sharedUrl = sharedUrl
      // fileIdを確定（driveFileIdが未設定の場合はURLから抽出）
      let resolvedFileId = fileId
      if (!resolvedFileId && url) {
        // Box URL: app.box.com/file/1234567890
        const boxMatch = url.match(/app\.box\.com\/file\/(\d+)/)
        if (boxMatch) resolvedFileId = boxMatch[1]
        // Google Drive URL: /file/d/FILEID/view
        const driveMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)
        if (driveMatch && provider === 'google-drive') resolvedFileId = driveMatch[1]
      }
      // fileIdが取れた場合はdriveFileIdとして渡す（urlは使わない）
      if (resolvedFileId) {
        media.driveFileId = resolvedFileId
      } else if (url) {
        media.url = url  // fileIdが取れなかった場合のフォールバック
      }
      // プロバイダー情報をURLに付加
      const base = buildViewerUrl(media)
      return provider !== 'google-drive' ? base + `&storageProvider=${encodeURIComponent(provider)}` : base
    }
    case 'image':
      // Box静止画: 共有リンクがあれば優先（外部ユーザーがBoxログインなしで閲覧可能）
      if (provider === 'box' && sharedUrl) return sharedUrl
      if (fileId && provider === 'google-drive') return `https://drive.google.com/file/d/${fileId}/view`
      if (fileId && provider === 'box') return `https://app.box.com/file/${fileId}`
      return url ?? ''
    case 'matterport':
      return `https://my.matterport.com/show/?m=${fileId ?? ''}`
    default:
      return url ?? `https://www.google.com/maps?q=${lat},${lng}`
  }
}
