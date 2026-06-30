/**
 * GoogleDriveProvider
 * 既存の GAS JSONP 連携を StorageProvider インターフェースに適合させる
 */
import type {
  StorageProvider, StorageConfig,
  StorageListResult, StorageFile,
} from './StorageProvider'

// GAS JSONP レスポンス型（内部用）
interface GasFile { name: string; url: string; id: string }
interface GasResult { success: boolean; folderName?: string; count?: number; files?: GasFile[]; error?: string }

/** JSONP で GAS にリクエスト */
function fetchGasJsonp(gasUrl: string, folderId: string): Promise<GasResult> {
  return new Promise((resolve, reject) => {
    const cbName = `gdrive_cb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const script = document.createElement('script')
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('タイムアウト。GAS URLとデプロイ設定を確認してください。'))
    }, 20000)
    function cleanup() {
      clearTimeout(timer)
      delete (window as unknown as Record<string, unknown>)[cbName]
      script.parentNode?.removeChild(script)
    }
    ;(window as unknown as Record<string, (d: GasResult) => void>)[cbName] = (data) => {
      cleanup(); resolve(data)
    }
    script.src = `${gasUrl}?folderId=${encodeURIComponent(folderId)}&callback=${encodeURIComponent(cbName)}`
    script.onerror = () => {
      cleanup()
      reject(new Error('GAS接続失敗。URLとデプロイ設定（アクセス：全員）を確認してください。'))
    }
    document.head.appendChild(script)
  })
}

/** Drive ファイルIDから lh3.googleusercontent.com の直接URLを生成 */
function fileIdToDirectUrl(fileId: string): string {
  return `https://lh3.googleusercontent.com/d/${fileId}`
}

/** Drive 共有URLからファイルIDを抽出 */
function extractFileIdFromUrl(url: string): string | null {
  const m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}

// ===== GoogleDriveProvider 実装 =====

export class GoogleDriveProvider implements StorageProvider {
  readonly type = 'google-drive' as const

  async listFiles(folderId: string, config?: StorageConfig): Promise<StorageListResult> {
    const gasUrl = config?.googleDrive.webAppUrl ?? ''
    if (!gasUrl) return { success: false, error: 'GAS WebApp URLが設定されていません' }

    try {
      const result = await fetchGasJsonp(gasUrl, folderId)
      if (!result.success || !result.files) {
        return { success: false, error: result.error ?? '取得失敗' }
      }
      const files: StorageFile[] = result.files
        .filter(f => /\.(jpe?g|png|gif|heic|360)$/i.test(f.name))
        .map(f => ({
          fileId: f.id,
          name: f.name,
          viewUrl: `https://drive.google.com/file/d/${f.id}/view`,
          directUrl: fileIdToDirectUrl(f.id),
        }))
      return { success: true, folderName: result.folderName, files }
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : '不明なエラー' }
    }
  }

  getFileViewUrl(fileId: string): string {
    return `https://drive.google.com/file/d/${fileId}/view`
  }

  getFile360Url(fileId: string): string {
    return fileIdToDirectUrl(fileId)
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
      // 360度写真 → PhotoLinkMap Viewer URL
      const params = new URLSearchParams({
        type: 'photosphere',
        fileId,
        title: encodeURIComponent(title),
      })
      const base = typeof window !== 'undefined' ? window.location.origin : ''
      return `${base}/viewer?${params.toString()}`
    }
    // 通常写真 → Drive 閲覧URL
    return this.getFileViewUrl(fileId)
  }

  extractFileId(url: string): string | null {
    return extractFileIdFromUrl(url)
  }

  extractFolderId(url: string): string | null {
    const m = url.match(/folders\/([a-zA-Z0-9_-]+)/)
    return m ? m[1] : null
  }

  isConfigured(config: StorageConfig): boolean {
    return !!config.googleDrive.webAppUrl && !!config.googleDrive.folderId
  }

  validateConfig(config: StorageConfig): string | null {
    if (!config.googleDrive.webAppUrl) return 'GAS WebApp URLを入力してください'
    if (!config.googleDrive.webAppUrl.includes('script.google.com')) return 'GAS URLの形式が正しくありません'
    if (!config.googleDrive.folderId) return 'DriveフォルダIDを入力してください'
    return null
  }
}

export const googleDriveProvider = new GoogleDriveProvider()
