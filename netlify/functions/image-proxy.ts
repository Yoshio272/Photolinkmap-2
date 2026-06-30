/**
 * image-proxy.ts - Netlify Functions v2 ストリーミングプロキシ
 *
 * 【解決方針】
 * Netlify Functions v2 の Response ストリーミングを使用。
 * base64変換を廃止し、Box/Drive の画像を直接ストリーミング転送。
 * 6MB・30MB超の360度画像でも動作。
 *
 * Box の場合:
 *   GET /files/{id}/content (redirect:follow)
 *   → dl.boxcloud.com から画像ストリームを取得
 *   → そのままクライアントにストリーミング転送
 *   → Netlify側でバッファリングしないのでサイズ制限なし
 */

export default async (req: Request) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  const url = new URL(req.url)
  let p: Record<string, string> = Object.fromEntries(url.searchParams)

  // POST: トークンをURLに露出させないためボディで受け付ける（推奨）
  if (req.method === 'POST') {
    try {
      const body = await req.json() as Record<string, string>
      p = { ...p, ...body }
    } catch { /* ボディなしのPOSTは無視 */ }
  }

  // ===== Box: fileId + token → ストリーミング転送 =====
  if (p.provider === 'box' && p.fileId && p.token) {
    try {
      // Box API: redirect:'follow' で dl.boxcloud.com の実画像URLに追従
      const res = await fetch(
        `https://api.box.com/2.0/files/${p.fileId}/content`,
        {
          headers: { Authorization: `Bearer ${p.token}` },
          redirect: 'follow',  // dl.boxcloud.com まで自動追従
        }
      )

      const contentType = res.headers.get('content-type') ?? 'image/jpeg'
      const contentLength = res.headers.get('content-length') ?? 'unknown'
      console.log('CONTENT TYPE', contentType)
      console.log('CONTENT LENGTH', contentLength)
      console.log(`[image-proxy] Box file ${p.fileId}`)

      if (!res.ok) {
        const msg = res.status === 401 ? 'Box認証が無効です。再サインインしてください。'
                  : res.status === 403 ? 'Boxファイルへのアクセス権限がありません。'
                  : res.status === 404 ? 'BoxファイルIDが見つかりません。'
                  : `Box API エラー: ${res.status}`
        return new Response(JSON.stringify({ error: msg }), {
          status: res.status,
          headers: { ...cors, 'Content-Type': 'application/json' },
        })
      }

      // res.body をそのままストリーミング転送（バッファリングなし）
      return new Response(res.body, {
        status: 200,
        headers: {
          ...cors,
          'Content-Type': contentType,
          'Cache-Control': 'private, max-age=3600',
          ...(contentLength !== 'unknown' ? { 'Content-Length': contentLength } : {}),
        },
      })

    } catch (err) {
      console.error('[image-proxy] Box error:', err)
      return new Response(`Box fetch failed: ${String(err)}`, { status: 502, headers: cors })
    }
  }

  // ===== URL経由プロキシ（Google Drive等）=====
  const rawUrl = p.url
  if (!rawUrl) {
    return new Response('url or (provider+fileId+token) required', { status: 400, headers: cors })
  }

  let targetUrl: string
  try {
    targetUrl = decodeURIComponent(rawUrl)
    const u = new URL(targetUrl)

    // app.box.com の HTMLページ（/file/, /s/）は拒否、/shared/static/（実画像）は許可
    if (u.hostname === 'app.box.com' && !u.pathname.startsWith('/shared/static/')) {
      return new Response(
        JSON.stringify({ error: 'app.box.com のHTMLページは取得できません。共有リンクの download_url（/shared/static/...）または ?provider=box&fileId=xxx&token=xxx を使用してください。' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } }
      )
    }

    const ALLOWED = [
      'lh3.googleusercontent.com', 'dl.boxcloud.com', 'public.boxcloud.com',
      'drive.google.com', 'storage.googleapis.com', 'box.com',
    ]
    const allowed = ALLOWED.some(d => u.hostname === d || u.hostname.endsWith('.' + d))
    if (!allowed) {
      return new Response(
        JSON.stringify({ error: `Domain not allowed: ${u.hostname}` }),
        { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } }
      )
    }
  } catch {
    return new Response('Invalid URL', { status: 400, headers: cors })
  }

  try {
    const res = await fetch(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PhotoLinkMap/1.0)' },
      redirect: 'follow',
    })

    if (!res.ok) {
      return new Response(`Upstream error: ${res.status}`, { status: res.status, headers: cors })
    }

    const contentType = res.headers.get('content-type') ?? 'image/jpeg'
    const contentLength = res.headers.get('content-length')

    if (contentType.includes('text/html')) {
      return new Response(
        'HTML returned - check sharing settings',
        { status: 403, headers: cors }
      )
    }

    console.log('CONTENT TYPE', contentType)
    console.log('CONTENT LENGTH', contentLength ?? 'unknown')
    console.log(`[image-proxy] Streaming ${targetUrl.slice(0, 60)}`)

    // ストリーミング転送
    return new Response(res.body, {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
        ...(contentLength ? { 'Content-Length': contentLength } : {}),
      },
    })
  } catch (err) {
    console.error('[image-proxy] error:', err)
    return new Response('Failed to fetch image', { status: 502, headers: cors })
  }
}

export const config = {
  path: '/image-proxy',
}
