/**
 * MapCanvas - PDF/画像背景 + SVGピンオーバーレイ
 *
 * 座標系:
 *   pin.px/py = Image座標（原寸ピクセル、ズーム不変）
 *   SVG描画時 = Image座標 × zoomScale = Canvas座標
 *   クリック時 = Canvas座標 → / zoomScale → Image座標として保存
 */
import { forwardRef, useEffect, useRef, useCallback } from 'react'
import type { ReactNode } from 'react'
import type { Pin, CalibState, StyleConfig, AppMode } from '../../types'
import { pxToLatLng } from '../../features/calibration/transform'
import { calcArrowSVG, NO_ARROW } from '../../features/arrow'
import { getPinType, PIN_TYPE_ICONS } from '../../types'
import { canvasToImage, imageToCanvas } from '../../features/coordinates'

interface MapCanvasProps {
  pdfLoaded: boolean
  useCalib: boolean
  mode: AppMode
  calib: CalibState
  pins: Pin[]
  selectedPinId: string | null
  style: StyleConfig
  zoomScale: number       // 現在の表示倍率（Canvas = Image × zoomScale）
  canvasW: number; canvasH: number
  pageW: number; pageH: number  // Image原寸サイズ
  wrapRef: React.RefObject<HTMLDivElement | null>
  pendingPhoto?: { name: string; url: string; is360: boolean } | null
  setCalib: (c: CalibState | ((prev: CalibState) => CalibState)) => void
  onCalibReady?: () => void
  onAddPin: (pin: Pin) => void
  onSelectPin: (id: string | null) => void
  onUpdatePin: (id: string, updates: Partial<Pin>) => void
  onModeChange: (m: AppMode) => void
  onScroll: (x: number, y: number) => void
  onPendingPhotoPlaced?: () => void
  children?: ReactNode
}

export const MapCanvas = forwardRef<HTMLCanvasElement, MapCanvasProps>(
  function MapCanvas(props, ref) {
    const {
      pdfLoaded, useCalib, mode, calib, pins, selectedPinId, style,
      zoomScale, canvasW, canvasH, pageW, pageH, wrapRef,
      pendingPhoto,
      setCalib, onAddPin, onSelectPin, onUpdatePin, onModeChange, onScroll,
      onPendingPhotoPlaced,
      children,
    } = props

    const svgRef = useRef<SVGSVGElement>(null)
    const dragRef = useRef<{
      pinId: string
      startClientX: number; startClientY: number
      origImageX: number; origImageY: number   // Image座標で保持
      active: boolean
    } | null>(null)

    // SVGサイズ同期
    useEffect(() => {
      if (!svgRef.current) return
      svgRef.current.setAttribute('width', String(canvasW))
      svgRef.current.setAttribute('height', String(canvasH))
    }, [canvasW, canvasH])

    // スクロール追跡
    useEffect(() => {
      const wrap = wrapRef.current
      if (!wrap) return
      const handler = () => onScroll(wrap.scrollLeft, wrap.scrollTop)
      wrap.addEventListener('scroll', handler, { passive: true })
      return () => wrap.removeEventListener('scroll', handler)
    }, [wrapRef, onScroll])

    // キーボード
    useEffect(() => {
      function onKey(e: KeyboardEvent) {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
        if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
          e.preventDefault()
          setCalib(prev => {
            if (prev.points.length === 0) return prev
            const pts = prev.points.slice(0, -1)
            return { ...prev, points: pts, step: pts.length === 0 ? 1 : 2 as 1|2, ready: false }
          })
        }
        if (e.key === 'Escape' && mode === 'place-photo') {
          onModeChange('view')
        }
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
    }, [setCalib, mode, onModeChange])

    // ===== Canvas上のクリック座標 → Image座標 =====
    function getImageXY(e: React.MouseEvent) {
      const canvas = (ref as React.RefObject<HTMLCanvasElement>)?.current
      if (!canvas) return null
      const r = canvas.getBoundingClientRect()
      const canvasX = e.clientX - r.left
      const canvasY = e.clientY - r.top
      // Image座標に変換
      return canvasToImage(canvasX, canvasY, zoomScale)
    }

    // ===== クリックハンドラ =====
    function handleClick(e: React.MouseEvent) {
      if (!pdfLoaded) return
      if (dragRef.current?.active) return
      const imgPos = getImageXY(e)
      if (!imgPos) return
      // Image座標の範囲チェック（pageW=0の場合はスキップ）
      if (pageW > 0 && pageH > 0) {
        if (imgPos.x < 0 || imgPos.y < 0 || imgPos.x > pageW || imgPos.y > pageH) return
      }

      if (useCalib && !calib.ready && (mode === 'pin' || mode === 'place-photo')) {
        onModeChange('calib'); return
      }

      if (mode === 'calib') {
        // キャリブは Image座標で保存
        if (calib.step === 1 && !calib.points[0]) {
          setCalib(prev => ({ ...prev, points: [{ px: imgPos.x, py: imgPos.y }], step: 2 as 1|2 }))
        } else if (calib.step === 2 && !calib.points[1]) {
          setCalib(prev => ({ ...prev, points: [prev.points[0], { px: imgPos.x, py: imgPos.y }] }))
        }
      } else if (mode === 'pin' && calib.ready) {
        const ll = pxToLatLng(imgPos.x, imgPos.y, calib.points)
        const pin: Pin = {
          id: 'p' + Date.now() + Math.random().toString(36).slice(2, 5),
          px: imgPos.x, py: imgPos.y,   // Image座標
          lat: ll.lat, lng: ll.lng,
          name: 'Photo-' + (pins.length + 1), memo: '', link: '',
          deg: 270, r: style.pinSize, al: style.arrowLength,
          color: style.pinColor, src: 'manual', placedBy: 'manual',
        }
        onAddPin(pin)
      } else if (mode === 'place-photo' && calib.ready && pendingPhoto) {
        const ll = pxToLatLng(imgPos.x, imgPos.y, calib.points)
        const pin: Pin = {
          id: 'p' + Date.now() + Math.random().toString(36).slice(2, 5),
          px: imgPos.x, py: imgPos.y,   // Image座標
          lat: ll.lat, lng: ll.lng,
          name: pendingPhoto.name, memo: '', link: pendingPhoto.url,
          deg: 270, r: style.pinSize, al: style.arrowLength,
          color: pendingPhoto.is360 ? '#1D9E75' : style.pinColor,
          src: 'manual', placedBy: 'manual',
          photoFileName: pendingPhoto.name,
          media: { type: pendingPhoto.is360 ? '360' : 'photo', url: pendingPhoto.url },
        }
        onAddPin(pin)
        onPendingPhotoPlaced?.()
        onModeChange('view')
      }
    }

    // ===== ドラッグ（Image座標で管理）=====
    // ポインターキャプチャは再レンダリングで消えないSVGルート(svgRef)に付与する。
    // 個々の<g>はpx/py更新のたびに作り直されるため、そこにキャプチャを付けると
    // ドラッグが途中で切れてしまう（つかんで動かして離せない不具合の原因）。
    const handlePinPointerDown = useCallback((e: React.PointerEvent, pinId: string) => {
      e.stopPropagation()
      const pin = pins.find(p => p.id === pinId)
      if (!pin) return
      dragRef.current = {
        pinId,
        startClientX: e.clientX, startClientY: e.clientY,
        origImageX: pin.px, origImageY: pin.py,   // Image座標
        active: false,
      }
      // SVGルートにキャプチャ（再レンダリングされない安定要素）
      if (svgRef.current) {
        try { svgRef.current.setPointerCapture(e.pointerId) } catch {}
      }
      onSelectPin(pinId)
    }, [pins, onSelectPin])

    // SVGルートで move/up を処理（ドラッグ中の全ポインター移動を確実に受ける）
    const handleRootPointerMove = useCallback((e: React.PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const dcx = e.clientX - drag.startClientX
      const dcy = e.clientY - drag.startClientY
      if (!drag.active && Math.sqrt(dcx*dcx + dcy*dcy) > 4) {
        drag.active = true
      }
      if (!drag.active) return

      const dImgX = dcx / zoomScale
      const dImgY = dcy / zoomScale
      const newImgX = pageW > 0 ? Math.max(0, Math.min(pageW, drag.origImageX + dImgX)) : drag.origImageX + dImgX
      const newImgY = pageH > 0 ? Math.max(0, Math.min(pageH, drag.origImageY + dImgY)) : drag.origImageY + dImgY
      onUpdatePin(drag.pinId, { px: newImgX, py: newImgY })
    }, [zoomScale, pageW, pageH, onUpdatePin])

    const handleRootPointerUp = useCallback((e: React.PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      if (svgRef.current) {
        try { svgRef.current.releasePointerCapture(e.pointerId) } catch {}
      }
      if (drag.active && calib.ready) {
        const pin = pins.find(p => p.id === drag.pinId)
        if (pin) {
          const ll = pxToLatLng(pin.px, pin.py, calib.points)
          onUpdatePin(drag.pinId, { lat: ll.lat, lng: ll.lng, moved: true })
        }
      }
      dragRef.current = null
    }, [pins, calib, onUpdatePin])

    function getCursor() {
      if (mode === 'view') return 'default'
      if (mode === 'place-photo') return 'cell'
      return 'crosshair'
    }

    // ===== SVGピン描画（Image座標 → Canvas座標に変換して描画）=====
    function PinSVG({ pin }: { pin: Pin }) {
      // Image座標 → Canvas座標
      const { x: cx, y: cy } = imageToCanvas(pin.px, pin.py, zoomScale)
      if (pin.src === 'gps') {
        console.log('⑤描画値', { id: pin.id, 'pin.px': pin.px, 'pin.py': pin.py, zoomScale, cx, cy, canvasW, canvasH })
      }
      const r  = pin.r * zoomScale
      const al = pin.al * zoomScale
      const hasArrow = pin.deg !== NO_ARROW && al > 0
      const isSelected = pin.id === selectedPinId
      const mid = `arrow-${pin.id}`
      const arrow = hasArrow ? calcArrowSVG(cx, cy, r, al, pin.deg) : null
      const pinType = getPinType(pin)
      const icon = PIN_TYPE_ICONS[pinType]

      return (
        <g
          onPointerDown={e => handlePinPointerDown(e, pin.id)}
          onClick={ev => { ev.stopPropagation(); onSelectPin(pin.id) }}
          style={{ cursor: 'grab', touchAction: 'none' }}
        >
          {arrow && (
            <>
              <defs>
                <marker id={mid} markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill={pin.color} />
                </marker>
              </defs>
              <line x1={arrow.tx} y1={arrow.ty} x2={arrow.ex} y2={arrow.ey}
                stroke={pin.color} strokeWidth={2} markerEnd={`url(#${mid})`} />
            </>
          )}
          <circle cx={cx} cy={cy} r={r + 2} fill="white" opacity={0.85} />
          <circle cx={cx} cy={cy} r={r} fill={pin.color}
            stroke={isSelected ? '#FFD700' : pin.moved ? '#FF6B00' : 'none'}
            strokeWidth={isSelected ? 3 : pin.moved ? 2 : 0} />
          {r >= 8 && (
            <text x={cx} y={cy + r * 0.4} textAnchor="middle"
              fontSize={r * 1.1} style={{ pointerEvents: 'none', userSelect: 'none' }}>
              {icon}
            </text>
          )}
          {pin.placedBy === 'manual' && !pin.moved && (
            <circle cx={cx + r + 1} cy={cy - r - 1} r={3}
              fill="#FF6B00" stroke="white" strokeWidth={1} style={{ pointerEvents: 'none' }} />
          )}
        </g>
      )
    }

    function CalibDot({ pt, n }: { pt: { px: number; py: number }; n: number }) {
      // キャリブ点も Image座標 → Canvas座標
      const { x: cx, y: cy } = imageToCanvas(pt.px, pt.py, zoomScale)
      return (
        <g>
          <circle cx={cx} cy={cy} r={8} fill={n===0?'#2196F3':'#F44336'} stroke="white" strokeWidth={2} />
          <text x={cx} y={cy + 4} textAnchor="middle" fill="white" fontSize={9} fontWeight="bold">{n+1}</text>
        </g>
      )
    }

    return (
      <div className="flex-1 relative overflow-hidden bg-stone-300 min-w-0 flex flex-col">
        {mode === 'place-photo' && pendingPhoto && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 bg-[#1D9E75] text-white px-4 py-2 rounded-full text-sm font-semibold shadow-lg flex items-center gap-2">
            <span>{pendingPhoto.is360 ? '🌐' : '📷'}</span>
            <span>「{pendingPhoto.name}」を配置する場所をクリック</span>
            <button onClick={() => onModeChange('view')}
              className="ml-2 text-white/70 hover:text-white text-xs border border-white/30 rounded px-1.5 py-0.5">
              Esc / キャンセル
            </button>
          </div>
        )}
        <div
          ref={wrapRef}
          className="flex-1 overflow-auto flex justify-center items-start p-4"
          style={{ cursor: getCursor() }}
          onClick={handleClick}
        >
          <div className="relative inline-block flex-shrink-0">
            <canvas ref={ref} className="block shadow-md" />
            <svg ref={svgRef} className="absolute top-0 left-0 overflow-visible"
              style={{ pointerEvents: 'none' }}
              onPointerMove={handleRootPointerMove}
              onPointerUp={handleRootPointerUp}
              onPointerCancel={handleRootPointerUp}>
              <g style={{ pointerEvents: 'all' }}>
                {calib.points.map((pt, i) =>
                  pt.px !== undefined
                    ? <CalibDot key={`cd-${i}`} pt={pt as {px:number;py:number}} n={i} />
                    : null
                )}
                {pins.map(pin => <PinSVG key={pin.id} pin={pin} />)}
              </g>
            </svg>
          </div>
          {children}
        </div>
      </div>
    )
  }
)
