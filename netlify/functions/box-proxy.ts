/**
 * box-proxy.ts — Netlify Function
 *
 * Box API の CORS プロキシ。
 * S-0 対応: token_exchange / token_refresh で client_secret は
 *           Netlify 環境変数 BOX_CLIENT_SECRET から取得し、
 *           ブラウザ側から受け取らない。
 */

import type { Handler } from '@netlify/functions'

const BOX_TOKEN_URL  = 'https://api.box.com/oauth2/token'
const BOX_API_BASE   = 'https://api.box.com/2.0'
const BOX_UPLOAD_URL = 'https://upload.box.com/api/2.0/files/content'

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) }
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(event.body ?? '{}')
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }
  }

  const { action } = body

  // ===== S-0: client_secret は環境変数から取得 =====
  const CLIENT_SECRET = process.env.BOX_CLIENT_SECRET ?? ''

  try {
    // ─────────────────────────────────────────────
    // token_exchange: 認証コード → アクセストークン
    // ─────────────────────────────────────────────
    if (action === 'token_exchange') {
      const { code, clientId } = body as { code: string; clientId: string }
      if (!CLIENT_SECRET) {
        return { statusCode: 500, body: JSON.stringify({ error: 'サーバー設定エラー: BOX_CLIENT_SECRET が未設定です' }) }
      }
      const redirectUri = `${process.env.URL ?? ''}/auth/box/callback`
      const params = new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        client_id:     clientId,
        client_secret: CLIENT_SECRET,
        redirect_uri:  redirectUri,
      })
      const res = await fetch(BOX_TOKEN_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    params.toString(),
      })
      const data = await res.json()
      return { statusCode: res.status, body: JSON.stringify(data) }
    }

    // ─────────────────────────────────────────────
    // token_refresh: リフレッシュトークン → 新アクセストークン
    // ─────────────────────────────────────────────
    if (action === 'token_refresh') {
      const { refreshToken, clientId } = body as { refreshToken: string; clientId: string }
      if (!CLIENT_SECRET) {
        return { statusCode: 500, body: JSON.stringify({ error: 'サーバー設定エラー: BOX_CLIENT_SECRET が未設定です' }) }
      }
      const params = new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: refreshToken,
        client_id:     clientId,
        client_secret: CLIENT_SECRET,
      })
      const res = await fetch(BOX_TOKEN_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    params.toString(),
      })
      const data = await res.json()
      return { statusCode: res.status, body: JSON.stringify(data) }
    }

    // ─────────────────────────────────────────────
    // 以下は token を使った Box API 操作
    // ─────────────────────────────────────────────
    const { token } = body as { token: string }
    if (!token) {
      return { statusCode: 401, body: JSON.stringify({ error: 'token が指定されていません' }) }
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    }

    // get_user_info
    if (action === 'get_user_info') {
      const res = await fetch(`${BOX_API_BASE}/users/me`, { headers })
      const data = await res.json()
      return { statusCode: res.status, body: JSON.stringify(data) }
    }

    // list_files
    if (action === 'list_files') {
      const { folderId } = body as { folderId: string }
      const res = await fetch(
        `${BOX_API_BASE}/folders/${folderId}/items?limit=1000&fields=id,name,type,size,shared_link`,
        { headers }
      )
      const data = await res.json()
      return { statusCode: res.status, body: JSON.stringify(data) }
    }

    // get_file_info
    if (action === 'get_file_info') {
      const { fileId } = body as { fileId: string }
      const res = await fetch(
        `${BOX_API_BASE}/files/${fileId}?fields=id,name,size,extension`,
        { headers }
      )
      const data = await res.json()
      return { statusCode: res.status, body: JSON.stringify(data) }
    }

    // create_folder
    if (action === 'create_folder') {
      const { folderName, parentFolderId } = body as { folderName: string; parentFolderId: string }
      const res = await fetch(`${BOX_API_BASE}/folders`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: folderName, parent: { id: parentFolderId } }),
      })
      const data = await res.json()
      if (res.status === 409) {
        // item_name_in_use: 同名フォルダが存在
        return { statusCode: 409, body: JSON.stringify({ ...data, code: 'item_name_in_use' }) }
      }
      return { statusCode: res.status, body: JSON.stringify(data) }
    }

    // create_shared_link
    if (action === 'create_shared_link') {
      const { fileId, sharedLinkAccess = 'open' } = body as { fileId: string; sharedLinkAccess?: string }
      // 既存の共有リンクを確認
      const infoRes = await fetch(
        `${BOX_API_BASE}/files/${fileId}?fields=shared_link`,
        { headers }
      )
      const infoData = await infoRes.json() as { shared_link?: { url: string; download_url?: string } }
      if (infoData.shared_link?.download_url) {
        return { statusCode: 200, body: JSON.stringify({ shared_link: infoData.shared_link, reused: true }) }
      }
      // 新規作成
      const res = await fetch(`${BOX_API_BASE}/files/${fileId}`, {
        method:  'PUT',
        headers,
        body: JSON.stringify({ shared_link: { access: sharedLinkAccess, permissions: { can_download: true } } }),
      })
      const data = await res.json()
      return { statusCode: res.status, body: JSON.stringify(data) }
    }

    // upload_file
    if (action === 'upload_file') {
      const { fileName, fileData, mimeType, parentFolderId } =
        body as { fileName: string; fileData: string; mimeType: string; parentFolderId: string }
      const buf = Buffer.from(fileData, 'base64')
      const formData = new FormData()
      formData.append('attributes', JSON.stringify({ name: fileName, parent: { id: parentFolderId } }))
      formData.append('file', new Blob([buf], { type: mimeType }), fileName)
      const res = await fetch(BOX_UPLOAD_URL, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
        body:    formData,
      })
      const data = await res.json()
      return { statusCode: res.status, body: JSON.stringify(data) }
    }

    // delete_file
    if (action === 'delete_file') {
      const { fileId } = body as { fileId: string }
      const res = await fetch(`${BOX_API_BASE}/files/${fileId}`, {
        method: 'DELETE',
        headers,
      })
      if (res.status === 204) return { statusCode: 204, body: '{}' }
      const data = await res.json()
      return { statusCode: res.status, body: JSON.stringify(data) }
    }

    // delete_folder
    if (action === 'delete_folder') {
      const { folderId } = body as { folderId: string }
      const res = await fetch(`${BOX_API_BASE}/folders/${folderId}?recursive=true`, {
        method: 'DELETE',
        headers,
      })
      if (res.status === 204) return { statusCode: 204, body: '{}' }
      const data = await res.json()
      return { statusCode: res.status, body: JSON.stringify(data) }
    }

    // get_thumbnail
    if (action === 'get_thumbnail') {
      const { fileId } = body as { fileId: string }
      const res = await fetch(
        `${BOX_API_BASE}/files/${fileId}/thumbnail.jpg?min_height=128&min_width=128`,
        { headers }
      )
      if (!res.ok) return { statusCode: 200, body: JSON.stringify({ thumbnail: null }) }
      const buf = Buffer.from(await res.arrayBuffer())
      const b64 = buf.toString('base64')
      return { statusCode: 200, body: JSON.stringify({ thumbnail: `data:image/jpeg;base64,${b64}` }) }
    }

    return { statusCode: 400, body: JSON.stringify({ error: `不明なアクション: ${action}` }) }

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '不明なエラー'
    return { statusCode: 500, body: JSON.stringify({ error: msg }) }
  }
}
