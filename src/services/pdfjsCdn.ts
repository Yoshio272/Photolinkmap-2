/**
 * PDF.js の worker / cMap を CDN から読み込むための URL 設定（一元管理）。
 *
 * 背景:
 *  - 以前は `new URL('pdfjs-dist/...', import.meta.url)` でパスを解決していたが、
 *    Vite の開発サーバー(dev)では想定外のパス(src/map/... 等)に解決され、
 *    「must include trailing slash」等のエラーで PDF が読めなかった。
 *  - CDN の固定 URL にすることで、開発・本番のどちらでも同じ挙動になる。
 *
 * バージョン:
 *  - PDFJS_VERSION は package.json の pdfjs-dist と一致させること。
 *    pdfjs-dist を更新したら、この定数も更新する。
 *
 * 将来 CDN を使わず自己完結にしたい場合（社内ネットワークが外部CDNを弾く等）は、
 *  cMap / worker を public/ に配置し、ここの URL を '/cmaps/' 等の絶対パスに差し替えるだけでよい。
 */

// package.json の "pdfjs-dist": "^6.0.227" と一致させる
export const PDFJS_VERSION = '6.0.227'

const CDN_BASE = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}`

// PDF.js の worker（.mjs）
export const PDFJS_WORKER_SRC = `${CDN_BASE}/build/pdf.worker.mjs`

// cMap（日本語等のフォント情報）。末尾スラッシュ必須（PDF.jsの要件）
export const PDFJS_CMAP_URL = `${CDN_BASE}/cmaps/`
export const PDFJS_CMAP_PACKED = true

// 標準フォント（standard_fonts）。末尾スラッシュ必須
export const PDFJS_STANDARD_FONTS_URL = `${CDN_BASE}/standard_fonts/`
