import type { RefObject } from 'react'
import type { Pin, StyleConfig, AppMode, SideTab, ExportConfig } from '../../types'
import type { StorageConfig } from '../../services/storage'
import type { BackgroundSource } from '../../services/background'
import { SettingsTab } from './SettingsTab'
import { PhotosTab } from './PhotosTab'
import { PlacementTab } from './PlacementTab'
import { SyncTab }      from './SyncTab'
import { ExportTab } from './ExportTab'

interface SidebarProps {
  activeTab: SideTab; setActiveTab: (t: SideTab) => void
  mode: AppMode; onModeChange: (m: AppMode) => void
  pins: Pin[]; selectedPinId: string | null
  onSelectPin: (id: string) => void
  onUpdatePin: (id: string, u: Partial<Pin>) => void
  onDeletePin: (id: string) => void
  setPins: (p: Pin[] | ((prev: Pin[]) => Pin[])) => void
  style: StyleConfig; setStyle: (s: StyleConfig) => void
  storageConfig: StorageConfig; setStorageConfig: (c: StorageConfig) => void
  exportConfig: ExportConfig; setExportConfig: (c: ExportConfig) => void
  pdfLoaded: boolean
  bgSource: BackgroundSource | null
  canvasRef: RefObject<HTMLCanvasElement | null>
  canvasW: number; canvasH: number
  pageW?: number; pageH?: number
  onBgLoaded: (source: BackgroundSource) => void
  projectName: string; setProjectName: (n: string) => void
  onSaveProject: (name?: string) => void
  setStatusMsg: (m: string) => void
  onOpen360: (pin: import('../../types').Pin) => void
  onStartManualPlace: (photo: { name: string; url: string; is360: boolean }) => void
  useCalib: boolean
  setUseCalib: (v: boolean) => void
  calib: import('../../types').CalibState
  setCalib: (c: import('../../types').CalibState | ((p: import('../../types').CalibState) => import('../../types').CalibState)) => void
  photos: import('../../features/photos/photoStore').PhotoEntry[]
  dispatchPhotos: (action: import('../../features/photos/photoStore').PhotoAction) => void
}

const TABS: { id: SideTab; label: string }[] = [
  { id: 'settings',  label: '設定' },
  { id: 'photos',    label: '写真' },
  { id: 'placement', label: '配置' },
  { id: 'sync',      label: '同期' },
  { id: 'export',    label: '出力' },
]

export function Sidebar(props: SidebarProps) {
  const { activeTab, setActiveTab, pins } = props

  return (
    <div className="flex flex-col bg-white border-l border-gray-200 shadow-sm overflow-hidden flex-shrink-0 w-[340px] min-w-[260px]">
      <div className="flex border-b border-gray-200 bg-gray-50 flex-shrink-0">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex-1 py-2 text-xs text-center border-b-2 transition-colors ${
              activeTab === t.id
                ? 'border-[#1565C0] text-[#1565C0] font-semibold bg-white'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {t.id === 'placement' ? `配置(${pins.length})` : t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {activeTab === 'settings'  && <SettingsTab  style={props.style} setStyle={props.setStyle} storageConfig={props.storageConfig} setStorageConfig={props.setStorageConfig} pdfLoaded={props.pdfLoaded} bgSource={props.bgSource} onBgLoaded={props.onBgLoaded} useCalib={props.useCalib} setUseCalib={props.setUseCalib} calib={props.calib} setCalib={props.setCalib} />}
        {activeTab === 'photos'    && <PhotosTab    {...props} pageW={props.pageW} pageH={props.pageH} onStartManualPlace={props.onStartManualPlace} mode={props.mode} photos={props.photos} dispatchPhotos={props.dispatchPhotos} />}
        {activeTab === 'sync'      && <SyncTab pins={props.pins} setPins={props.setPins} storageConfig={props.storageConfig} setStatusMsg={props.setStatusMsg} />}
        {activeTab === 'placement' && <PlacementTab {...props} onOpen360={props.onOpen360} />}
        {activeTab === 'export'    && <ExportTab    {...props} pageW={props.pageW ?? 0} pageH={props.pageH ?? 0} />}
      </div>
    </div>
  )
}
