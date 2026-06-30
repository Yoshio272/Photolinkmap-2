/**
 * 360度画像URLリゾルバー
 *
 * ストレージプロバイダーごとに異なるURLを、
 * Photo Sphere Viewerが読み込める形式に解決する。
 *
 * 解決戦略:
 *   1. 直接アクセス可能か試す（CORS対応のURL）
 *   2. 不可なら image-proxy 経由にフォールバック
 */

const IMAGE_PROXY = '/image-proxy'
const LOG_PREFIX = '[PhotoLinkMap 360 Resolver]'

export interface ResolvedImage {
  url: string
  method: 'direct' | 'proxy' | 'box-api'
  originalUrl: string
  fileId?: string
  provider?: string
  /** 画像取得時のfetchオプション（POSTでトークンを渡す場合） */
  fetchInit?: RequestInit
}

/**
 * ストレージプロバイダーとfileId/urlから360度画像URLを解決
 */
export async function resolve360ImageUrl(
  fileIdArg: string | undefined,
  rawUrl: string | undefined,
  providerArg: string,
): Promise<ResolvedImage> {
  let fileId = fileIdArg
  let provider = providerArg
  console.log(`${LOG_PREFIX} Resolving 360 image:`, { fileId, rawUrl: rawUrl?.slice(0, 60), provider })

  // blob URL / object URL は永続保存禁止 → エラー
  if (rawUrl?.startsWith('blob:') || rawUrl?.startsWith('data:')) {
    throw new Error(
      '360度写真のURLが一時的なblob URLです。\n' +
      'Drive連携ボタンで写真リンクを取得してから再度お試しください。\n' +
      '（blob URLは永続保存できません）'
    )
  }

  // 最終防衛: app.box.com/file/xxx URL が来たら fileId を抽出（HTMLページをproxyに渡さない）
  if (!fileId && rawUrl) {
    const boxMatch = rawUrl.match(/app\.box\.com\/file\/(\d+)/)
    if (boxMatch) {
      fileId = boxMatch[1]
      provider = 'box'
      console.log(`${LOG_PREFIX} Extracted Box fileId from URL: ${fileId}`)
    }
    const driveMatch = rawUrl.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/)
    if (driveMatch) {
      fileId = driveMatch[1]
      provider = 'google-drive'
      console.log(`${LOG_PREFIX} Extracted Drive fileId from URL: ${fileId}`)
    }
  }

  // ===== Google Drive =====
  if (provider === 'google-drive' && fileId) {
    // lh3.googleusercontent.com/d/{id} は直接CORSエラーになる場合がある
    // → image-proxy経由を優先
    const directUrl = `https://lh3.googleusercontent.com/d/${fileId}`
    const proxyUrl = `${IMAGE_PROXY}?url=${encodeURIComponent(directUrl)}`

    console.log(`${LOG_PREFIX} Google Drive - direct: ${directUrl}`)
    console.log(`${LOG_PREFIX} Google Drive - proxy:  ${proxyUrl}`)

    // image-proxyが利用可能かチェック（Netlifyデプロイ環境かどうか）
    const isNetlify = window.location.hostname.includes('netlify') ||
                     window.location.hostname.includes('localhost')

    if (isNetlify) {
      // プロキシ経由（CORS問題を完全回避）
      return { url: proxyUrl, method: 'proxy', originalUrl: directUrl, fileId, provider }
    }
    // ローカル開発: 直接アクセス試行
    return { url: directUrl, method: 'direct', originalUrl: directUrl, fileId, provider }
  }

  // ===== Box =====
  if (provider === 'box' && fileId) {
    const token = localStorage.getItem('box_access_token') ?? ''
    if (!token) {
      throw new Error('Box未認証です。設定タブからサインインしてください。')
    }
    // POSTボディでトークンを渡す（URLクエリに露出させない）
    console.log(`${LOG_PREFIX} Box - proxy via POST (token in body): fileId=${fileId}`)
    return {
      url: IMAGE_PROXY,
      method: 'box-api',
      originalUrl: `box:${fileId}`,
      fileId, provider,
      fetchInit: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'box', fileId, token }),
      },
    }
  }

  // ===== 直接URL（provider不明 or url指定）=====
  if (rawUrl) {
    // Drive /view URL を直接URL変換
    const directUrl = convertDriveViewToDirectUrl(rawUrl)
    const proxyUrl = `${IMAGE_PROXY}?url=${encodeURIComponent(directUrl)}`
    console.log(`${LOG_PREFIX} Direct URL - original: ${rawUrl}`)
    console.log(`${LOG_PREFIX} Direct URL - resolved: ${directUrl}`)
    return { url: proxyUrl, method: 'proxy', originalUrl: rawUrl, provider }
  }

  throw new Error('画像URLを解決できませんでした。fileIdまたはURLを確認してください。')
}

/**
 * Google Drive の /view URL → 直接アクセス可能なURL に変換
 */
function convertDriveViewToDirectUrl(url: string): string {
  // https://drive.google.com/file/d/{ID}/view → lh3経由
  const m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)
  if (m) return `https://lh3.googleusercontent.com/d/${m[1]}`
  // uc?export= 形式はそのまま
  if (url.includes('uc?export=')) return url
  return url
}

/**
 * PSV用デバッグ情報をコンソールに出力
 */
export function logViewerDebug(info: {
  fileId?: string
  storageProvider?: string
  resolvedImageUrl: string
  viewerType: string
  method: string
}): void {
  console.group(`${LOG_PREFIX} Viewer Debug Info`)
  console.log('fileId:           ', info.fileId ?? '(none)')
  console.log('storageProvider:  ', info.storageProvider ?? 'google-drive')
  console.log('resolvedImageUrl: ', info.resolvedImageUrl)
  console.log('imageType:        ', detectImageType(info.resolvedImageUrl))
  console.log('viewerType:       ', info.viewerType)
  console.log('resolveMethod:    ', info.method)
  console.groupEnd()
}

function detectImageType(url: string): string {
  if (url.includes('image-proxy')) return 'proxied (type from upstream)'
  if (/\.(jpg|jpeg)(\?|$)/i.test(url)) return 'JPEG'
  if (/\.png(\?|$)/i.test(url)) return 'PNG'
  if (/\.webp(\?|$)/i.test(url)) return 'WebP'
  return 'unknown (will be determined at load time)'
}
