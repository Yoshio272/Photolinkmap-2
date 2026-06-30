/**
 * BoxProvider - 本実装
 * Netlify Function (box-proxy) 経由でBox APIを利用
 *
 * 実装状況:
 *   ✅ OAuth 2.0 認証フロー
 *   ✅ アクセストークン自動リフレッシュ
 *   ✅ フォルダ内ファイル一覧取得
 *   ✅ フォルダ作成（案件フォルダ / Photos / Panorama / Export）
 *   ✅ ファイルアップロード（通常写真・360度写真）
 *   ✅ 共有リンク生成（閲覧のみ）
 *   ✅ ファイル削除
 *   ✅ ユーザー情報・容量表示
 *   ✅ サムネイル取得
 */
import type {
  StorageProvider, StorageConfig,
  StorageListResult, StorageFile,
} from './StorageProvider'
import { getValidToken } from './BoxAuth'
import { BoxApi, BoxApiError } from './BoxApi'

export interface BoxFolderStructure {
  rootId: string
  photosId: string
  panoramaId: string
  exportId: string
}

export class BoxProvider implements StorageProvider {
  readonly type = 'box' as const

  // ===== ヘルパー: 有効トークン取得（自動リフレッシュ）=====
  private async token(): Promise<string> {
    return getValidToken()
  }

  // ===== フォルダ内ファイル一覧 =====
  async listFiles(folderId: string, _config?: StorageConfig): Promise<StorageListResult> {
    try {
      const token = await this.token()
      const items = await BoxApi.listFiles(token, folderId)
      const imageExts = /\.(jpe?g|png|gif|heic|webp|360)$/i

      const files: StorageFile[] = items.entries
        .filter(e => e.type === 'file' && imageExts.test(e.name))
        .map(e => ({
          fileId: e.id,
          name: e.name,
          viewUrl: `https://app.box.com/file/${e.id}`,
          directUrl: e.shared_link?.download_url,
          mimeType: undefined,
        }))

      // shared_linkのないファイルは共有リンクを生成
      const withLinks: StorageFile[] = await Promise.all(files.map(async f => {
        if (f.directUrl) return f
        try {
          const link = await BoxApi.createSharedLink(token, f.fileId)
          return { ...f, viewUrl: link.url, directUrl: link.download_url }
        } catch { return f }
      }))

      return { success: true, files: withLinks }
    } catch (e: unknown) {
      return { success: false, error: this.formatError(e) }
    }
  }

  // ===== ファイルアップロード =====
  async uploadFile(
    file: File,
    folderId: string,
    fileName?: string
  ): Promise<{ fileId: string; viewUrl: string; directUrl?: string }> {
    const token = await this.token()
    const base64 = await fileToBase64(file)
    const name = fileName ?? file.name

    const uploaded = await BoxApi.uploadFile(token, name, base64, file.type, folderId)
    const link = await BoxApi.createSharedLink(token, uploaded.id)
    return {
      fileId:    uploaded.id,
      viewUrl:   link.url,
      directUrl: link.download_url,
    }
  }

  // ===== 案件フォルダ構造を作成 =====
  async createProjectFolders(
    projectName: string,
    rootFolderId: string
  ): Promise<BoxFolderStructure> {
    const token = await this.token()
    const rootFolder = await BoxApi.createFolder(token, projectName, rootFolderId)
    const [photos, panorama, exportF] = await Promise.all([
      BoxApi.createFolder(token, 'Photos', rootFolder.id),
      BoxApi.createFolder(token, 'Panorama', rootFolder.id),
      BoxApi.createFolder(token, 'Export', rootFolder.id),
    ])
    return {
      rootId:     rootFolder.id,
      photosId:   photos.id,
      panoramaId: panorama.id,
      exportId:   exportF.id,
    }
  }

  // ===== ファイル削除 =====
  async deleteFile(fileId: string): Promise<void> {
    const token = await this.token()
    await BoxApi.deleteFile(token, fileId)
  }

  // ===== ユーザー情報・容量 =====
  async getUserInfo() {
    const token = await this.token()
    return BoxApi.getUserInfo(token)
  }

  // ===== サムネイル =====
  async getThumbnail(fileId: string): Promise<string | null> {
    try {
      const token = await this.token()
      return await BoxApi.getThumbnail(token, fileId)
    } catch { return null }
  }

  // ===== StorageProvider インターフェース実装 =====

  getFileViewUrl(fileId: string): string {
    return `https://app.box.com/file/${fileId}`
  }

  /**
   * 360度写真の直接アクセスURL
   * Box Shared Link の download_url を使用（PSV直接アクセス）
   * ※ shared_linkが生成済みである前提
   */
  getFile360Url(fileId: string): string {
    // PSVはdownload_urlが必要だが、同期では取得不可
    // ViewerPage側でproxyを経由して取得する
    // URL形式: /viewer?type=photosphere&fileId={id}&storageProvider=box
    return `box:${fileId}`   // ViewerPage でプロキシ経由に解決
  }

  getPdfLinkUrl(
    fileId: string,
    isSpherical: boolean,
    title: string,
    lat: number,
    lng: number,
  ): string {
    void lat; void lng
    if (isSpherical) {
      const params = new URLSearchParams({
        type: 'photosphere',
        storageProvider: 'box',
        fileId,
        title: encodeURIComponent(title),
      })
      const base = typeof window !== 'undefined' ? window.location.origin : ''
      return `${base}/viewer?${params.toString()}`
    }
    return this.getFileViewUrl(fileId)
  }

  extractFileId(url: string): string | null {
    const m1 = url.match(/app\.box\.com\/file\/(\d+)/)
    if (m1) return m1[1]
    const m2 = url.match(/\.box\.com\/file\/(\d+)/)
    if (m2) return m2[1]
    if (/^\d+$/.test(url.trim())) return url.trim()
    return null
  }

  extractFolderId(url: string): string | null {
    const m = url.match(/\.box\.com\/folder\/(\d+)/)
    return m ? m[1] : null
  }

  isConfigured(config: StorageConfig): boolean {
    // トークンが有効かどうかをチェック
    const tokens = loadBoxTokensSync()
    return !!tokens?.accessToken && !!config.box.folderId
  }

  validateConfig(config: StorageConfig): string | null {
    const tokens = loadBoxTokensSync()
    if (!tokens) return 'Boxにサインインしてください（設定タブ → Boxにサインイン）'
    if (!config.box.folderId) return 'BoxのルートフォルダIDを入力してください'
    return null
  }

  // ===== エラーフォーマット =====
  private formatError(e: unknown): string {
    if (e instanceof BoxApiError) {
      switch (e.code) {
        case 'unauthorized':          return 'Box認証が無効です。再サインインしてください。'
        case 'access_denied_insufficient_permissions': return 'Boxフォルダへのアクセス権限がありません。'
        case 'storage_limit_exceeded': return 'Box容量が上限に達しています。'
        case 'item_name_in_use':      return '同名のファイルが既に存在します。'
        case 'not_found':             return 'ファイルまたはフォルダが見つかりません。'
        default: return e.message
      }
    }
    return e instanceof Error ? e.message : 'Box APIエラーが発生しました'
  }
}

// ===== ユーティリティ =====

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      const result = e.target?.result as string
      // "data:image/jpeg;base64,XXXX" → "XXXX" 部分のみ
      resolve(result.split(',')[1] ?? result)
    }
    reader.onerror = () => reject(new Error('ファイル読み込みに失敗しました'))
    reader.readAsDataURL(file)
  })
}

function loadBoxTokensSync() {
  const a = localStorage.getItem('box_access_token')
  const r = localStorage.getItem('box_refresh_token')
  if (!a || !r) return null
  return { accessToken: a, refreshToken: r }
}

export const boxProvider = new BoxProvider()
