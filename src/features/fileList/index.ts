/**
 * ファイルモード — データモデル・取込ヘルパー（Step1）
 *
 * 図面・地図への配置を行わず、写真名一覧のリンク付きPDFを出力するモード。
 * データは pins / photoStore / calib と完全に独立。
 * Step2: クラウド同期（cloudUrl/fileId） / Step3: PDF出力（pdf.ts）
 * Step4: JSONファイル保存・読込（localStorage非依存。既存プロジェクト機構とは独立）
 */

// ファイルモード専用エントリ（Pin・MapPinとは独立）
export interface FileEntry {
  id: string
  no: number             // 表示番号（一覧の並び順。並替時に振り直す）
  importSeq: number      // 取込順（固定。「取込順」ソートの復元に使う）
  fileName: string
  thumbDataUrl: string   // サムネイル（長辺160px JPEG。一覧・PDF両用）
  takenAt?: string       // EXIF撮影時刻 "2026/07/17 10:23"
  is360: boolean         // アスペクト比2:1判定（地図モードと同じ）
  cloudUrl?: string      // Step2: 同期後に設定
  fileId?: string        // Step2: 同期後に設定
}

export type FileSortKey = 'imported' | 'name' | 'takenAt'

/** 並び順に応じて no を 1..n に振り直す */
export function renumber(entries: FileEntry[]): FileEntry[] {
  return entries.map((e, i) => e.no === i + 1 ? e : { ...e, no: i + 1 })
}

/** ソート（新配列を返し、renumber済み） */
export function sortEntries(entries: FileEntry[], key: FileSortKey): FileEntry[] {
  const arr = [...entries]
  if (key === 'imported') {
    arr.sort((a, b) => a.importSeq - b.importSeq)
  } else if (key === 'name') {
    arr.sort((a, b) => a.fileName.localeCompare(b.fileName, 'ja', { numeric: true }))
  } else {
    // 撮影時刻順（時刻なしは末尾へ。同時刻は取込順）
    arr.sort((a, b) => {
      if (!a.takenAt && !b.takenAt) return a.importSeq - b.importSeq
      if (!a.takenAt) return 1
      if (!b.takenAt) return -1
      return a.takenAt.localeCompare(b.takenAt) || a.importSeq - b.importSeq
    })
  }
  return renumber(arr)
}

/** File → サムネイルDataURL（長辺maxPx・JPEG）。メモリ節約のため原寸は保持しない */
export function makeThumbnail(file: File, maxPx = 160): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('canvas 2d context取得失敗')); return }
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.7))
      } catch (e) {
        reject(e instanceof Error ? e : new Error('サムネイル生成失敗'))
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像読込失敗')) }
    img.src = url
  })
}

/** 360度判定（アスペクト比2:1。地図モード detect360 と同じ基準） */
export function detectIs360(file: File): Promise<boolean> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const ratio = img.width / img.height
      URL.revokeObjectURL(url)
      resolve(ratio >= 1.9 && ratio <= 2.1)
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(false) }
    img.src = url
  })
}

// ===== Step4: JSONファイル保存・読込 =====
// 既存プロジェクト保存（features/project）とは独立。localStorageを消費しない。

const FILELIST_KIND = 'photolinkmap-filelist'
const FILELIST_VERSION = '1.0'

interface FileListJson {
  kind: string
  version: string
  siteName: string
  savedAt: string
  entries: FileEntry[]
}

/** 一覧をJSONファイルとしてダウンロード保存する */
export function exportFileListJson(entries: FileEntry[], siteName: string): void {
  const data: FileListJson = {
    kind: FILELIST_KIND,
    version: FILELIST_VERSION,
    siteName,
    savedAt: new Date().toISOString(),
    entries,
  }
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const dateStr = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${siteName || '写真一覧'}_ファイルモード_${dateStr}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

/** JSONファイルから一覧を読み込む（形式検証つき） */
export function importFileListJson(file: File): Promise<{ siteName: string; entries: FileEntry[] }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string) as Partial<FileListJson>
        if (data.kind !== FILELIST_KIND || !Array.isArray(data.entries)) {
          reject(new Error('ファイルモードの保存ファイルではありません'))
          return
        }
        // 期待するフィールドのみ取り出して再構築（余分・欠損データを排除）
        const entries: FileEntry[] = data.entries
          .filter(x => x && typeof x.fileName === 'string' && typeof x.thumbDataUrl === 'string')
          .map((x, i) => ({
            id: typeof x.id === 'string' ? x.id : `fe_import_${Date.now()}_${i}`,
            no: 0,
            importSeq: typeof x.importSeq === 'number' ? x.importSeq : i + 1,
            fileName: x.fileName,
            thumbDataUrl: x.thumbDataUrl,
            takenAt: typeof x.takenAt === 'string' ? x.takenAt : undefined,
            is360: x.is360 === true,
            cloudUrl: typeof x.cloudUrl === 'string' ? x.cloudUrl : undefined,
            fileId: typeof x.fileId === 'string' ? x.fileId : undefined,
          }))
        if (entries.length === 0) {
          reject(new Error('写真データが含まれていません'))
          return
        }
        resolve({
          siteName: typeof data.siteName === 'string' ? data.siteName : '',
          entries: renumber(entries),
        })
      } catch {
        reject(new Error('JSONファイルの形式が正しくありません'))
      }
    }
    reader.onerror = () => reject(new Error('読み込みに失敗しました'))
    reader.readAsText(file)
  })
}
