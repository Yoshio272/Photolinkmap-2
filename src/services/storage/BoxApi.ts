/**
 * Box API クライアント
 * Netlify Function (box-proxy) 経由でBox APIを呼び出す
 */

const PROXY = '/.netlify/functions/box-proxy'

async function call<T>(action: string, token: string, params: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, token, ...params }),
  })
  const data = await res.json() as T & { error?: string; code?: string }
  if (!res.ok) {
    const e = data as { error?: string; code?: string }
    const msg = e.error ?? 'Box APIエラー'
    const code = e.code ?? String(res.status)
    throw new BoxApiError(msg, code, res.status)
  }
  return data
}

export class BoxApiError extends Error {
  code: string
  status: number
  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = 'BoxApiError'
    this.code = code
    this.status = status
  }
}

// ===== Box API レスポンス型 =====

export interface BoxItem {
  type: 'file' | 'folder' | 'web_link'
  id: string
  name: string
  size?: number
  created_at?: string
  shared_link?: BoxSharedLink | null
}

export interface BoxFolderItems {
  total_count: number
  entries: BoxItem[]
}

export interface BoxSharedLink {
  url: string
  download_url?: string
  access: 'open' | 'company' | 'collaborators'
  permissions?: { can_download?: boolean }
}

export interface BoxFile {
  id: string
  name: string
  size: number
  shared_link?: BoxSharedLink
}

export interface BoxFolder {
  id: string
  name: string
}

export interface BoxUploadResponse {
  entries?: BoxFile[]
}

export interface BoxUserInfo {
  name: string
  login: string
  space_used: number
  space_amount: number
}

// ===== API メソッド =====

export const BoxApi = {

  /** フォルダ内ファイル一覧を取得 */
  async listFiles(token: string, folderId: string): Promise<BoxFolderItems> {
    return call<BoxFolderItems>('list_files', token, { folderId })
  },

  /** フォルダ作成（同名フォルダが存在する場合は既存を返す）*/
  async createFolder(token: string, folderName: string, parentFolderId: string): Promise<BoxFolder> {
    try {
      return await call<BoxFolder>('create_folder', token, { folderName, parentFolderId })
    } catch (e: unknown) {
      const err = e as BoxApiError
      // item_name_in_use: 同名フォルダが存在 → 既存のIDを返す
      if (err.code === 'item_name_in_use') {
        const items = await BoxApi.listFiles(token, parentFolderId)
        const existing = items.entries.find(i => i.name === folderName && i.type === 'folder')
        if (existing) return { id: existing.id, name: existing.name }
      }
      throw e
    }
  },

  /** ファイルアップロード（base64データ）*/
  async uploadFile(
    token: string,
    fileName: string,
    fileData: string,       // base64
    mimeType: string,
    parentFolderId: string
  ): Promise<BoxFile> {
    const res = await call<BoxUploadResponse>('upload_file', token, {
      fileName, fileData, mimeType, parentFolderId,
    })
    const entry = res.entries?.[0]
    if (!entry) throw new BoxApiError('アップロードレスポンスが不正です', 'upload_error', 500)
    return entry
  },

  /** 共有リンクを生成（閲覧のみ、ダウンロード可）*/
  async createSharedLink(token: string, fileId: string): Promise<BoxSharedLink> {
    const res = await call<{ shared_link?: BoxSharedLink }>('create_shared_link', token, {
      fileId,
      sharedLinkAccess: 'open',
    })
    if (!res.shared_link) throw new BoxApiError('共有リンクの生成に失敗しました', 'shared_link_error', 500)
    return res.shared_link
  },

  /** ファイル削除 */
  async deleteFile(token: string, fileId: string): Promise<void> {
    await call('delete_file', token, { fileId })
  },

  /** フォルダ削除（中身ごと）*/
  async deleteFolder(token: string, folderId: string): Promise<void> {
    await call('delete_folder', token, { folderId })
  },

  /** ユーザー情報・容量取得 */
  async getUserInfo(token: string): Promise<BoxUserInfo> {
    return call<BoxUserInfo>('get_user_info', token, {})
  },

  /** サムネイル取得（base64 DataURL）*/
  async getThumbnail(token: string, fileId: string): Promise<string | null> {
    const res = await call<{ thumbnail: string | null }>('get_thumbnail', token, { fileId })
    return res.thumbnail
  },
}
