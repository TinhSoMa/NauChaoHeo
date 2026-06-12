import { useMemo, type ComponentType } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  BookOpen,
  Download,
  FileText,
  MessageCircle,
  Scissors,
  Settings,
  Subtitles,
  Video
} from 'lucide-react'
import styles from './ProjectHome.module.css'
import { useProjectContext } from '../../context/ProjectContext'

type HomeTile = {
  id: string
  label: string
  desc: string
  path: string
  icon: ComponentType<{ size?: number }>
}

export function ProjectHome() {
  const navigate = useNavigate()
  const location = useLocation()
  const { projectId, paths } = useProjectContext()

  const tiles = useMemo<HomeTile[]>(
    () => [
      { id: 'caption', label: 'Dịch Caption', desc: 'Subtitle, batch, hardsub', path: '/translator', icon: Subtitles },
      { id: 'cut', label: 'Cut Video', desc: 'Cắt, ghép clip nhanh', path: '/cut-video', icon: Scissors },
      { id: 'story', label: 'Dịch Truyện AI', desc: 'Dịch truyện theo prompt', path: '/story-translator', icon: BookOpen },
      { id: 'summary', label: 'Tóm Tắt Truyện AI', desc: 'Tóm tắt theo chương', path: '/story-summary', icon: FileText },
      { id: 'web', label: 'Dịch Truyện (Web)', desc: 'Dịch trực tiếp trên web', path: '/story-web', icon: MessageCircle },
      { id: 'gemini', label: 'Chat Gemini', desc: 'Chat, API tools', path: '/gemini-chat', icon: MessageCircle },
      { id: 'veo3', label: 'Veo3 AI Prompt', desc: 'Xây prompt video', path: '/veo3', icon: Video },
      { id: 'downloader', label: 'Downloader', desc: 'Tải video/sub/thumbnail', path: '/downloader', icon: Download },
      { id: 'settings', label: 'Settings', desc: 'Cấu hình ứng dụng', path: '/settings', icon: Settings }
    ],
    []
  )

  const searchParams = new URLSearchParams(location.search)
  const queryString = searchParams.toString()
  const withQuery = (path: string) => (queryString ? `${path}?${queryString}` : path)

  if (!projectId) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <div>
            <div className={styles.title}>Project Home</div>
            <div className={styles.subtitle}>Không tìm thấy projectId.</div>
          </div>
          <button className={styles.primaryButton} onClick={() => navigate('/projects')}>
            Quay về danh sách project
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <div className={styles.title}>Project Home</div>
          <div className={styles.subtitle}>
            Project: <span className={styles.mono}>{projectId}</span>
          </div>
          {paths?.root && (
            <div className={styles.path}>Root: {paths.root}</div>
          )}
        </div>
        <div className={styles.headerActions}>
          <button className={styles.secondaryButton} onClick={() => navigate('/projects')}>
            Đổi project
          </button>
        </div>
      </div>

      <div className={styles.grid}>
        {tiles.map((tile) => {
          const Icon = tile.icon
          return (
            <button
              key={tile.id}
              className={styles.tile}
              onClick={() => navigate(withQuery(tile.path))}
              type="button"
            >
              <div className={styles.tileIcon}>
                <Icon size={22} />
              </div>
              <div className={styles.tileBody}>
                <div className={styles.tileTitle}>{tile.label}</div>
                <div className={styles.tileDesc}>{tile.desc}</div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
