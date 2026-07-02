/**
 * 地図モード プロジェクト保存基盤（mapProject）
 *
 * 設計方針:
 *  - MapPage からは saveCurrentProject / loadProject 程度しか呼ばせない。
 *    シリアライズ・容量判定・フォールバック・バージョン変換はすべてここに閉じ込める。
 *  - 小さな純粋関数に分割し、将来 IndexedDB やクラウド保存へ移行しても
 *    MapPage 側をほぼ変更せずに済むようにする。
 *  - localStorage キーは図面モード（photolinkmap_projects）と分離する。
 *
 * 画像の保存方針（案W: ハイブリッド）:
 *  - 図面オーバーレイ画像: 保存する（JPEG圧縮）。容量超過時は位置情報のみにフォールバック。
 *  - 写真プレビュー(photoDataUrl): 保存しない（クラウドリンクで代替）。
 */

export const MAP_PROJECT_VERSION = 1
export const MAP_LS_KEY = 'photolinkmap_map_projects'
export const MAP_LAST_PROJECT_KEY = 'photolinkmap_map_last_project'

// localStorage の実用上の安全上限（保守的に 4.5MB とする。多くのブラウザは 5MB 前後）
const LS_SAFE_LIMIT_BYTES = 4.5 * 1024 * 1024

// ===== 保存対象の型 =====

/** 保存されるピン（写真プレビュー photoDataUrl は含めない = 軽量） */
export interface SavedMapPin {
  id: string
  no: number
  lat: number
  lng: number
  fileName: string
  hasGps: boolean
  comment: string
  is360: boolean
  cloudUrl?: string
  fileId?: string
}

/** 保存される図面オーバーレイ（dataUrl は容量超過時 null にフォールバック） */
export interface SavedOverlay {
  dataUrl: string | null
  imgW: number
  imgH: number
  anchorLat: number
  anchorLng: number
  baseZoom: number
  baseFitScale: number
  userScale: number
  userRotation: number
  opacity: number
}

/** localStorage に保存する 1 プロジェクトの完全な形 */
export interface MapProject {
  version: number
  name: string
  createdAt: string
  updatedAt: string
  thumbnail: string | null // 図面を 200px 幅・JPEG 品質 0.6 に縮小したもの
  siteName: string
  mapCenter: { lat: number; lng: number }
  mapZoom: number
  baseMap: string
  pins: SavedMapPin[]
  overlay: SavedOverlay | null
}

/** 管理画面一覧用の軽量メタ情報（本体を読み込まずに一覧表示できる） */
export interface MapProjectMeta {
  name: string
  createdAt: string
  updatedAt: string
  thumbnail: string | null
  pinCount: number
  hasOverlay: boolean
}

/**
 * MapPage 側の現在状態（シリアライズの入力）。
 * MapPage の state / ref から集めた「生」のデータをこの形で渡す。
 */
export interface MapState {
  siteName: string
  mapCenter: { lat: number; lng: number }
  mapZoom: number
  baseMap: string
  pins: Array<{
    id: string; no: number; lat: number; lng: number; fileName: string
    hasGps: boolean; comment: string; is360: boolean; cloudUrl?: string; fileId?: string
  }>
  overlay: {
    dataUrl: string; imgW: number; imgH: number
    anchorLat: number; anchorLng: number; baseZoom: number; baseFitScale: number
    userScale: number; userRotation: number; opacity: number
  } | null
  thumbnail?: string | null // 呼び出し側で生成済みなら渡す
}

// ===== シリアライズ / デシリアライズ =====

/**
 * MapState → MapProject（保存用オブジェクトを組み立てる。localStorage 書き込みはしない）
 * createdAt は新規時のみ。既存更新時は既存の createdAt を渡す。
 */
export function serializeProject(
  state: MapState,
  name: string,
  opts?: { createdAt?: string },
): MapProject {
  const now = new Date().toISOString()
  return {
    version: MAP_PROJECT_VERSION,
    name,
    createdAt: opts?.createdAt ?? now,
    updatedAt: now,
    thumbnail: state.thumbnail ?? null,
    siteName: state.siteName,
    mapCenter: state.mapCenter,
    mapZoom: state.mapZoom,
    baseMap: state.baseMap,
    pins: state.pins.map(p => ({
      id: p.id, no: p.no, lat: p.lat, lng: p.lng, fileName: p.fileName,
      hasGps: p.hasGps, comment: p.comment, is360: p.is360,
      ...(p.cloudUrl ? { cloudUrl: p.cloudUrl } : {}),
      ...(p.fileId ? { fileId: p.fileId } : {}),
    })),
    overlay: state.overlay ? {
      dataUrl: state.overlay.dataUrl,
      imgW: state.overlay.imgW, imgH: state.overlay.imgH,
      anchorLat: state.overlay.anchorLat, anchorLng: state.overlay.anchorLng,
      baseZoom: state.overlay.baseZoom, baseFitScale: state.overlay.baseFitScale,
      userScale: state.overlay.userScale, userRotation: state.overlay.userRotation,
      opacity: state.overlay.opacity,
    } : null,
  }
}

/**
 * MapProject → MapState（読み込んだプロジェクトを MapPage が復元できる形に戻す）
 * 図面画像が保存されていない（フォールバック済み）場合、overlay.dataUrl は null のまま返る。
 */
export function deserializeProject(project: MapProject): MapState {
  return {
    siteName: project.siteName,
    mapCenter: project.mapCenter,
    mapZoom: project.mapZoom,
    baseMap: project.baseMap,
    pins: project.pins.map(p => ({
      id: p.id, no: p.no, lat: p.lat, lng: p.lng, fileName: p.fileName,
      hasGps: p.hasGps, comment: p.comment, is360: p.is360,
      cloudUrl: p.cloudUrl, fileId: p.fileId,
    })),
    overlay: project.overlay ? {
      dataUrl: project.overlay.dataUrl ?? '', // null は空文字にして呼び出し側で判定
      imgW: project.overlay.imgW, imgH: project.overlay.imgH,
      anchorLat: project.overlay.anchorLat, anchorLng: project.overlay.anchorLng,
      baseZoom: project.overlay.baseZoom, baseFitScale: project.overlay.baseFitScale,
      userScale: project.overlay.userScale, userRotation: project.overlay.userRotation,
      opacity: project.overlay.opacity,
    } : null,
    thumbnail: project.thumbnail,
  }
}

// ===== バージョン変換 =====

/**
 * 読み込んだ生データを最新バージョンへ移行する。
 * 将来 version 2, 3 と増えたら、ここに変換を追加していく。
 */
export function migrateProject(raw: any): MapProject {
  let p = raw
  if (typeof p !== 'object' || p === null) {
    throw new Error('プロジェクトデータが不正です')
  }
  // version 未設定の古いデータは version 1 とみなす
  if (typeof p.version !== 'number') {
    p = { ...p, version: 1 }
  }
  // 例: 将来 version 2 で構造が変わったらここで変換
  // if (p.version === 1) { p = convertV1ToV2(p); }
  return p as MapProject
}

// ===== サイズ概算 =====

/**
 * プロジェクトを保存した場合の概算バイト数を返す（JSON 文字列長ベース）。
 * localStorage は UTF-16 だが、概算用途では JSON の文字数で十分な精度。
 */
export function estimateProjectSize(project: MapProject): number {
  return new Blob([JSON.stringify(project)]).size
}

/** 現在の localStorage 使用量の概算（この機能のキーのみ） */
export function estimateStoreUsage(): number {
  try {
    const raw = localStorage.getItem(MAP_LS_KEY) ?? ''
    return new Blob([raw]).size
  } catch {
    return 0
  }
}

// ===== localStorage CRUD =====

interface Store { [name: string]: MapProject }

function readStore(): Store {
  try {
    const raw = localStorage.getItem(MAP_LS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return (typeof parsed === 'object' && parsed !== null) ? parsed : {}
  } catch {
    return {}
  }
}

function writeStore(store: Store): void {
  localStorage.setItem(MAP_LS_KEY, JSON.stringify(store))
}

/**
 * プロジェクトを保存する（案W: 事前サイズ判定つき）。
 * 戻り値の mode で、完全保存 / 軽量フォールバック / 失敗 を呼び出し側に伝える。
 */
export function saveProject(project: MapProject): {
  ok: boolean
  mode: 'full' | 'fallback' | 'error'
  error?: string
} {
  const store = readStore()

  // 既存の同名プロジェクトを除いた他プロジェクトの容量
  const others: Store = { ...store }
  delete others[project.name]
  const othersBytes = new Blob([JSON.stringify(others)]).size

  // まず完全保存で試算
  const fullBytes = othersBytes + estimateProjectSize(project)

  let toSave = project
  let mode: 'full' | 'fallback' = 'full'

  // 事前チェック: 完全保存が安全上限を超えるなら、最初から軽量保存に切り替える
  if (fullBytes > LS_SAFE_LIMIT_BYTES && project.overlay?.dataUrl) {
    toSave = { ...project, overlay: { ...project.overlay, dataUrl: null } }
    mode = 'fallback'
  }

  // 実書き込み（保険として QuotaExceededError も捕捉）
  try {
    const next = { ...store, [toSave.name]: toSave }
    writeStore(next)
    return { ok: true, mode }
  } catch (e) {
    // 例外時のフォールバック: 図面画像を落として再試行
    if (project.overlay?.dataUrl) {
      try {
        const lightweight = { ...project, overlay: { ...project.overlay, dataUrl: null } }
        const next = { ...store, [lightweight.name]: lightweight }
        writeStore(next)
        return { ok: true, mode: 'fallback' }
      } catch (e2) {
        return { ok: false, mode: 'error', error: e2 instanceof Error ? e2.message : '保存に失敗しました' }
      }
    }
    return { ok: false, mode: 'error', error: e instanceof Error ? e.message : '保存に失敗しました' }
  }
}

/** プロジェクトを読み込む（バージョン変換込み）。存在しなければ null */
export function loadProject(name: string): MapProject | null {
  const store = readStore()
  const raw = store[name]
  if (!raw) return null
  try {
    return migrateProject(raw)
  } catch {
    return null
  }
}

/** 一覧用メタ情報を返す（更新日時の新しい順） */
export function listProjects(): MapProjectMeta[] {
  const store = readStore()
  return Object.values(store)
    .map(p => {
      const proj = (() => { try { return migrateProject(p) } catch { return null } })()
      if (!proj) return null
      return {
        name: proj.name,
        createdAt: proj.createdAt,
        updatedAt: proj.updatedAt,
        thumbnail: proj.thumbnail,
        pinCount: proj.pins.length,
        hasOverlay: !!proj.overlay,
      } as MapProjectMeta
    })
    .filter((m): m is MapProjectMeta => m !== null)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

/** プロジェクトを削除する */
export function deleteProject(name: string): void {
  const store = readStore()
  delete store[name]
  writeStore(store)
}

/** プロジェクト名を変更する。新名が既存と衝突する場合は false */
export function renameProject(oldName: string, newName: string): boolean {
  const store = readStore()
  if (!store[oldName]) return false
  if (store[newName]) return false
  const proj = store[oldName]
  proj.name = newName
  proj.updatedAt = new Date().toISOString()
  store[newName] = proj
  delete store[oldName]
  writeStore(store)
  return true
}

// ===== 前回プロジェクトの記憶（起動時案内用。自動復元はしない）=====

export function rememberLastProject(name: string): void {
  try { localStorage.setItem(MAP_LAST_PROJECT_KEY, name) } catch { /* ignore */ }
}

export function getLastProjectName(): string | null {
  try { return localStorage.getItem(MAP_LAST_PROJECT_KEY) } catch { return null }
}

export function clearLastProject(): void {
  try { localStorage.removeItem(MAP_LAST_PROJECT_KEY) } catch { /* ignore */ }
}
