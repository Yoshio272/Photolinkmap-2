import type { Project, ExportConfig } from '../../types'
import { createDefaultStorageConfig } from '../../services/storage'
import type { SerializedBackground } from '../../services/background'

export const VERSION = '1.1.0'
export const LS_KEY = 'photolinkmap_projects'

// ===== プロジェクトメタ情報 =====
export interface ProjectMeta {
  name: string
  savedAt: string
  updatedAt: string
  pinCount: number
  photoCount: number
  bgFileName?: string
  sizeEstimateKB: number
}

export function getProjectMeta(project: Project): ProjectMeta {
  const photoCount = project.pins.filter(p => p.src === 'gps').length
  // サイズ推定: backgroundのBase64が大部分
  const bgSize = project.background?.dataBase64
    ? Math.round(project.background.dataBase64.length * 0.75 / 1024)
    : project.background?.dataUrl
    ? Math.round(project.background.dataUrl.length * 0.75 / 1024)
    : 0
  return {
    name: project.name,
    savedAt: project.savedAt,
    updatedAt: project.updatedAt ?? project.savedAt,
    pinCount: project.pins.length,
    photoCount,
    bgFileName: project.background?.fileName ?? project.pdfName,
    sizeEstimateKB: bgSize + Math.round(JSON.stringify(project.pins).length / 1024),
  }
}

export function listProjectMetas(): ProjectMeta[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return []
    const all = JSON.parse(raw) as Record<string, Project>
    return Object.values(all)
      .map(p => getProjectMeta(p))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  } catch { return [] }
}

export function listProjects(): { name: string; savedAt: string }[] {
  return listProjectMetas().map(m => ({ name: m.name, savedAt: m.savedAt }))
}

export function saveProject(project: Project): { ok: boolean; error?: string } {
  const toSave: Project = { ...project, updatedAt: new Date().toISOString() }
  try {
    const raw = localStorage.getItem(LS_KEY)
    const all: Record<string, Project> = raw ? JSON.parse(raw) : {}
    all[project.name] = toSave
    localStorage.setItem(LS_KEY, JSON.stringify(all))
    return { ok: true }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      // 背景データを除いて保存（縮小版）
      try {
        const lite = { ...toSave, background: undefined }
        const raw = localStorage.getItem(LS_KEY)
        const all: Record<string, Project> = raw ? JSON.parse(raw) : {}
        all[project.name] = lite
        localStorage.setItem(LS_KEY, JSON.stringify(all))
      } catch { /* 完全失敗 */ }
      return { ok: false, error: '背景データが大きすぎて保存できませんでした。管理画面からJSONで書き出してください。' }
    }
    return { ok: false, error: String(e) }
  }
}

export function loadProject(name: string): Project | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    const all = JSON.parse(raw) as Record<string, Project>
    return all[name] ?? null
  } catch { return null }
}

export function deleteProject(name: string): void {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return
    const all = JSON.parse(raw) as Record<string, Project>
    delete all[name]
    localStorage.setItem(LS_KEY, JSON.stringify(all))
  } catch { /* ignore */ }
}

export function renameProject(oldName: string, newName: string): boolean {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return false
    const all = JSON.parse(raw) as Record<string, Project>
    if (!all[oldName]) return false
    if (all[newName]) return false // 重複名
    all[newName] = { ...all[oldName], name: newName, updatedAt: new Date().toISOString() }
    delete all[oldName]
    localStorage.setItem(LS_KEY, JSON.stringify(all))
    return true
  } catch { return false }
}

export function deleteAllProjects(): void {
  localStorage.removeItem(LS_KEY)
}

export function getStorageInfo(): { usedKB: number; totalKB: number; projectCount: number } {
  try {
    const raw = localStorage.getItem(LS_KEY) ?? ''
    const usedKB = Math.round(raw.length * 2 / 1024) // UTF-16
    return { usedKB, totalKB: 5120, projectCount: listProjectMetas().length }
  } catch { return { usedKB: 0, totalKB: 5120, projectCount: 0 } }
}

export function createEmptyProject(name = '新規プロジェクト'): Project {
  return {
    version: VERSION, name, savedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    background: undefined,
    zoomScale: 1, scrollX: 0, scrollY: 0,
    calib: { points: [], step: 1, ready: false },
    pins: [],
    style: { pinColor: '#1565C0', pinSize: 10, arrowLength: 30 },
    gas: { webAppUrl: '', folderId: '' },
    storageConfig: createDefaultStorageConfig(),
    exportConfig: { noLinkAction: 'skip', noteText: '', fileName: 'survey.pdf' },
    canvasW: 0, canvasH: 0, pdfW: 0, pdfH: 0,
  }
}

export function migrateProject(p: Project): Project {
  return {
    ...createEmptyProject(p.name),
    ...p,
    version: VERSION,
    updatedAt: (p as Project & { updatedAt?: string }).updatedAt ?? p.savedAt,
    zoomScale: p.zoomScale ?? 1,
    scrollX: p.scrollX ?? 0,
    scrollY: p.scrollY ?? 0,
    exportConfig: p.exportConfig ?? { noLinkAction: 'skip', noteText: '', fileName: 'survey.pdf' },
    storageConfig: p.storageConfig ?? createDefaultStorageConfig(),
  }
}

export function exportProjectJson(project: Project): void {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${project.name.replace(/[^a-zA-Z0-9_\-]/g, '_')}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

export function importProjectJson(file: File): Promise<Project> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try { resolve(migrateProject(JSON.parse(e.target?.result as string) as Project)) }
      catch { reject(new Error('JSONファイルの形式が正しくありません')) }
    }
    reader.onerror = () => reject(new Error('読み込みに失敗しました'))
    reader.readAsText(file)
  })
}

const GAS_URL_KEY = 'photolinkmap_gas_url'
const GAS_FOLDER_KEY = 'photolinkmap_folder_id'
export function saveGasConfig(url: string, folderId: string): void {
  try { localStorage.setItem(GAS_URL_KEY, url); localStorage.setItem(GAS_FOLDER_KEY, folderId) } catch { /* ignore */ }
}
export function loadGasConfig() {
  return { webAppUrl: localStorage.getItem(GAS_URL_KEY) ?? '', folderId: localStorage.getItem(GAS_FOLDER_KEY) ?? '' }
}

export type { SerializedBackground, ExportConfig }
