import { useState, useRef, useCallback, useEffect } from 'react'
import type { Pin, CalibState, StyleConfig, AppMode, SideTab, Project, ExportConfig } from './types'
import type { BackgroundSource } from './services/background'
import { useReducer } from 'react'
import { photoReducer } from './features/photos/photoStore'
import { createDefaultStorageConfig, migrateGasConfigToStorage, storageConfigToGasConfig } from './services/storage'
import type { StorageConfig } from './services/storage'
import { Viewer360Modal } from './components/Viewer360'
import { get360ImageUrl } from './types'
import { renderBackground, renderBackgroundFit, calcFitScale, serializeBackground, deserializeBackground } from './services/background'
import { saveProject, loadGasConfig, saveGasConfig, migrateProject, createEmptyProject, loadProject as loadProjectFn } from './features/project'
import { Toolbar } from './components/Toolbar/Toolbar'
import { Sidebar } from './components/Sidebar/Sidebar'
import { MapCanvas } from './components/Canvas/MapCanvas'
import { WelcomeScreen } from './components/WelcomeScreen'

// suppress unused import
void createEmptyProject

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef   = useRef<HTMLDivElement | null>(null)

  // ===== 背景 =====
  const [bgSource,   setBgSource]   = useState<BackgroundSource | null>(null)
  const [pdfLoaded,  setPdfLoaded]  = useState(false)

  // ===== キャンバス =====
  const [canvasW,     setCanvasW]     = useState(0)
  const [canvasH,     setCanvasH]     = useState(0)
  const [zoomScale,   setZoomScale]   = useState(1)
  const [renderScale, setRenderScale] = useState<number | null>(null)
  const [scrollX,     setScrollX]     = useState(0)
  const [scrollY,     setScrollY]     = useState(0)

  // ===== モード / タブ =====
  const [mode,      setMode]      = useState<AppMode>('calib')
  const [activeTab, setActiveTab] = useState<SideTab>('settings')

  // ===== キャリブ =====
  const [calib, setCalib] = useState<CalibState>({ points: [], step: 1, ready: false })
  const [useCalib, setUseCalib] = useState(false)

  // ===== ピン =====
  const [pins,          setPins]          = useState<Pin[]>([])
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null)
  const [photos, dispatchPhotos] = useReducer(photoReducer, [])
  const [viewer360Pin,  setViewer360Pin]  = useState<import('./types').Pin | null>(null)
  const [pendingPhoto,  setPendingPhoto]  = useState<{ name: string; url: string; is360: boolean } | null>(null)

  // ===== スタイル / GAS / 出力設定 =====
  const [style,        setStyle]        = useState<StyleConfig>({ pinColor: '#1565C0', pinSize: 10, arrowLength: 30 })
  const [storageConfig, setStorageConfig] = useState<StorageConfig>(createDefaultStorageConfig())
  const [exportConfig, setExportConfig] = useState<ExportConfig>({ noLinkAction: 'skip', noteText: '', fileName: 'survey.pdf' })

  // ===== プロジェクト =====
  const [projectName, setProjectName] = useState('新規プロジェクト')
  const [statusMsg,   setStatusMsg]   = useState('STEP1: 右カラムから図面（PDF/JPG/PNG）を読み込んでください')

  // ===== 保存状態（Toolbar用） =====
  const [isDirty, setIsDirty] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'error' | null>(null)

  // ストレージ設定の永続化（後方互換: 旧GasConfigも読み込む）
  useEffect(() => {
    const s = loadGasConfig()
    if (s.webAppUrl || s.folderId) setStorageConfig(migrateGasConfigToStorage(s))
  }, [])
  useEffect(() => {
    const gd = storageConfigToGasConfig(storageConfig)
    if (gd.webAppUrl || gd.folderId) saveGasConfig(gd.webAppUrl, gd.folderId)
  }, [storageConfig])

  // ===== 変更検知（未保存インジケーター） =====
  useEffect(() => {
    setIsDirty(true)
  }, [bgSource, pins, calib, style, storageConfig, exportConfig, projectName])

  // ===== 背景読み込みコールバック =====
  const handleBgLoaded = useCallback(async (source: BackgroundSource) => {
    setBgSource(source)
    const canvas = canvasRef.current
    const wrap   = wrapRef.current
    if (!canvas || !wrap) return
    const result = await renderBackgroundFit(source, canvas, wrap.clientWidth, wrap.clientHeight)
    setCanvasW(result.canvasW); setCanvasH(result.canvasH)
    setZoomScale(result.scale); setRenderScale(result.scale)
    setPdfLoaded(true)
    setMode('calib'); setActiveTab('settings')
    setStatusMsg('STEP2: 図面上の2点をクリックして基準点を設定してください')
  }, [])

  // ===== ズームスケール変更 → 再描画 =====
  const handleZoomChange = useCallback(async (newScale: number) => {
    if (!bgSource || !canvasRef.current) return
    const clampedScale = Math.max(0.1, Math.min(5, newScale))
    const result = await renderBackground(bgSource, canvasRef.current, clampedScale)
    // NOTE: pin.px/py は Image座標（原寸）で保持するため、ズーム時の変換は不要
    // Canvas座標への変換は MapCanvas 内で zoomScale を使って行う
    setCanvasW(result.canvasW); setCanvasH(result.canvasH)
    setZoomScale(clampedScale); setRenderScale(clampedScale)
  }, [bgSource, renderScale])

  // ===== 手動配置モード =====
  const handleStartManualPlace = useCallback((photo: { name: string; url: string; is360: boolean }) => {
    setPendingPhoto(photo)
    setMode('place-photo')
    setStatusMsg(`「${photo.name}」を配置する場所を図面上でクリックしてください (Escでキャンセル)`)
  }, [])

  const handlePendingPhotoPlaced = useCallback(() => {
    setPendingPhoto(null)
    setStatusMsg('STEP3: 写真を配置しました。続けて配置するか、配置タブで確認してください。')
  }, [])

  // ===== 360ビューワー =====
  const handleOpen360 = useCallback((pin: import('./types').Pin) => {
    setViewer360Pin(pin)
  }, [])

  // ===== fit =====
  const handleFit = useCallback(async () => {
    if (!bgSource || !canvasRef.current || !wrapRef.current) return
    const { clientWidth: areaW, clientHeight: areaH } = wrapRef.current
    const fitScale = calcFitScale(bgSource.pageWidth, bgSource.pageHeight, areaW, areaH)
    await handleZoomChange(fitScale)
  }, [bgSource, handleZoomChange])

  // ===== モード変更 =====
  const handleModeChange = useCallback((m: AppMode) => {
    setMode(m)
    const msgs: Record<AppMode, string> = {
      calib: `基準点設定 | ${calib.ready ? '✓完了' : `基準点${calib.step}を図面上でクリック`}`,
      pin: calib.ready ? 'ピン配置 | 図面上をクリック' : '⚠ 先に基準点設定を完了してください',
      view: '閲覧 | ピンをクリックして詳細編集',
      'place-photo': '手動配置 | 図面上をクリックして写真を配置',
    }
    setStatusMsg(msgs[m])
  }, [calib])

  // ===== キャリブ完了 =====
  const handleCalibReady = useCallback(() => {
    setMode('pin')
    setStatusMsg('STEP3: 右カラムの「写真」タブから写真を取り込んでください')
  }, [])

  // ===== ピン操作 =====
  const addPin = useCallback((pin: Pin) => {
    setPins(prev => {
      const next = [...prev, pin]
      dispatchPhotos({ type: 'SYNC_PINS', pins: next })
      return next
    })
    setSelectedPinId(pin.id)
    setActiveTab('placement')
  }, [dispatchPhotos])
  const updatePin = useCallback((id: string, updates: Partial<Pin>) => {
    setPins(prev => {
      const next = prev.map(p => p.id === id ? { ...p, ...updates } : p)
      // ピン変更をPhotoストアに同期
      dispatchPhotos({ type: 'SYNC_PINS', pins: next })
      return next
    })
  }, [dispatchPhotos])
  const deletePin = useCallback((id: string) => { setPins(prev => prev.filter(p => p.id !== id)); setSelectedPinId(null) }, [])

  // ===== スクロール位置追跡 =====
  const handleScroll = useCallback((x: number, y: number) => { setScrollX(x); setScrollY(y) }, [])

  // ===== プロジェクト保存（完全保存）=====
  const handleSaveProject = useCallback((name?: string) => {
    const n = name || projectName
    const proj: Project = {
      version: '1.1.0', name: n, savedAt: new Date().toISOString(),
      background: bgSource ? serializeBackground(bgSource) : undefined,
      zoomScale, scrollX, scrollY,
      calib, pins, style,
      gas: storageConfigToGasConfig(storageConfig) as import('./types').GasConfig,
      storageConfig,
      exportConfig,
      pdfName: bgSource?.fileName,
      canvasW, canvasH,
      pdfW: bgSource?.pageWidth ?? 0,
      pdfH: bgSource?.pageHeight ?? 0,
    }
    const result = saveProject(proj)
    setProjectName(n)
    if (result.ok) {
      setIsDirty(false)
      setSaveStatus('saved')
      setStatusMsg(`✓ プロジェクト「${n}」を保存しました`)
    } else {
      setSaveStatus('error')
      setStatusMsg(`⚠ 保存できませんでした: ${result.error ?? ''}`)
    }
    setTimeout(() => setSaveStatus(null), 3000)
  }, [bgSource, zoomScale, scrollX, scrollY, calib, pins, style, storageConfig, exportConfig, canvasW, canvasH, projectName])

  // ===== プロジェクト読み込み（完全復元）=====
  const handleLoadProject = useCallback(async (proj: Project) => {
    const migrated = migrateProject(proj)
    setCalib(migrated.calib ?? { points: [], step: 1, ready: false })
    setUseCalib(!!migrated.useCalib || !!migrated.calib?.ready)
    setPins(migrated.pins)
    setStyle(migrated.style)
    if (migrated.storageConfig) setStorageConfig(migrated.storageConfig)
    else if (migrated.gas?.webAppUrl) setStorageConfig(migrateGasConfigToStorage(migrated.gas))
    setExportConfig(migrated.exportConfig ?? { noLinkAction: 'skip', noteText: '', fileName: 'survey.pdf' })
    setProjectName(migrated.name)
    setCanvasW(migrated.canvasW); setCanvasH(migrated.canvasH)

    // 背景データの復元
    if (migrated.background && canvasRef.current) {
      const src = deserializeBackground(migrated.background)
      setBgSource(src)
      const wrap = wrapRef.current
      const areaW = wrap?.clientWidth ?? 800
      const areaH = wrap?.clientHeight ?? 600
      // 保存済みzoomScaleで描画。なければfit
      const sc = migrated.zoomScale > 0 ? migrated.zoomScale : calcFitScale(src.pageWidth, src.pageHeight, areaW, areaH)
      await renderBackground(src, canvasRef.current, sc)
      setZoomScale(sc); setRenderScale(sc)
      setPdfLoaded(true)
      // スクロール位置復元
      if (wrapRef.current) {
        wrapRef.current.scrollLeft = migrated.scrollX ?? 0
        wrapRef.current.scrollTop  = migrated.scrollY ?? 0
      }
    }
    setIsDirty(false)
    setStatusMsg(`プロジェクト「${migrated.name}」を読み込みました`)
  }, [])


  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-100">
      <Toolbar
        pdfLoaded={pdfLoaded}
        projectName={projectName}
        pinCount={pins.length}
        gasConfigured={storageConfig.provider !== 'google-drive' || !!storageConfig.googleDrive.webAppUrl}
        zoomScale={zoomScale}
        isDirty={isDirty}
        saveStatus={saveStatus}
        onZoom={handleZoomChange}
        onFit={handleFit}
        onSaveProject={handleSaveProject}
        onLoadProject={name => { const p = loadProjectFn(name); if (p) handleLoadProject(p) }}
      />

      {location.protocol === 'file:' && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-3 py-1 text-xs text-yellow-800 flex-shrink-0">
          ⚠ ローカルファイルで開いています。Google Drive連携はHTTPS環境でのみ動作します。
        </div>
      )}

      <div className="flex flex-1 overflow-hidden min-h-0">
        <MapCanvas
          ref={canvasRef}
          wrapRef={wrapRef}
          pdfLoaded={pdfLoaded}
          useCalib={useCalib}
          mode={mode}
          calib={calib}
          pins={pins}
          selectedPinId={selectedPinId}
          style={style}
          canvasW={canvasW}
          canvasH={canvasH}
          pageW={bgSource?.pageWidth ?? 0}
          pageH={bgSource?.pageHeight ?? 0}
          zoomScale={zoomScale}
          setCalib={setCalib}
          onCalibReady={handleCalibReady}
          onAddPin={addPin}
          onSelectPin={setSelectedPinId}
          onModeChange={handleModeChange}
          onScroll={handleScroll}
          pendingPhoto={pendingPhoto}
          onUpdatePin={updatePin}
          onPendingPhotoPlaced={handlePendingPhotoPlaced}
        >
          {!pdfLoaded && <WelcomeScreen />}
        </MapCanvas>

        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          mode={mode}
          onModeChange={handleModeChange}
          calib={calib}
          setCalib={setCalib}
          useCalib={useCalib}
          setUseCalib={setUseCalib}
          pins={pins}
          selectedPinId={selectedPinId}
          onSelectPin={setSelectedPinId}
          onUpdatePin={updatePin}
          onDeletePin={deletePin}
          setPins={setPins}
          style={style}
          setStyle={setStyle}
          storageConfig={storageConfig}
          setStorageConfig={setStorageConfig}
          exportConfig={exportConfig}
          setExportConfig={setExportConfig}
          pdfLoaded={pdfLoaded}
          bgSource={bgSource}
          canvasRef={canvasRef}
          canvasW={canvasW}
          canvasH={canvasH}
          pageW={bgSource?.pageWidth ?? 0}
          pageH={bgSource?.pageHeight ?? 0}
          onBgLoaded={handleBgLoaded}
          projectName={projectName}
          setProjectName={setProjectName}
          onSaveProject={handleSaveProject}
          setStatusMsg={setStatusMsg}
          onOpen360={handleOpen360}
          onStartManualPlace={handleStartManualPlace}
          photos={photos}
          dispatchPhotos={dispatchPhotos}
        />
      </div>

      {/* 360度ビューワーモーダル */}
      {viewer360Pin && (
        <Viewer360Modal
          imageUrl={get360ImageUrl(viewer360Pin)}
          title={viewer360Pin.name || '360度写真'}
          onClose={() => setViewer360Pin(null)}
        />
      )}

      <div className="px-3 py-1 text-xs text-gray-500 bg-gray-50 border-t border-gray-200 flex-shrink-0 min-h-[22px]">
        {statusMsg}
      </div>
    </div>
  )
}
