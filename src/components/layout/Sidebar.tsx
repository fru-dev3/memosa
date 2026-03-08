import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import memosaIcon from '../../assets/memosa-icon.png'
import * as api from '../../lib/tauri'
import type { AppView } from '../../lib/types'
import { useMemosaStore } from '../../store'

function IconWrap({ children }: { children: React.ReactNode }) {
  return <span style={{ width: 15, height: 15, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{children}</span>
}

function TodayIcon() {
  return <IconWrap><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="2.5" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M5 1.5v2M11 1.5v2M1.5 6h13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="5.5" cy="10" r="1" fill="currentColor"/><circle cx="10.5" cy="10" r="1" fill="currentColor"/></svg></IconWrap>
}
function SearchIcon() {
  return <IconWrap><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5"/><path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></IconWrap>
}
function CalendarIcon() {
  return <IconWrap><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="2.5" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M1.5 6h13M5 1.5v2M11 1.5v2M4.5 8.8h2.2M9.2 8.8h2.2M4.5 11.3h2.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg></IconWrap>
}
function ProjectsIcon() {
  return <IconWrap><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="8" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M10 4.5l4-1.5v10l-4 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg></IconWrap>
}
function SettingsIcon() {
  return <IconWrap><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M8 1v1.5M8 13.5V15M15 8h-1.5M2.5 8H1M12.95 3.05l-1.06 1.06M4.11 11.89l-1.06 1.06M12.95 12.95l-1.06-1.06M4.11 4.11L3.05 3.05" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></IconWrap>
}
function AboutIcon() {
  return <IconWrap><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5"/><path d="M8 7.2V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="8" cy="4.8" r="0.9" fill="currentColor"/></svg></IconWrap>
}

function navIcon(view: AppView) {
  switch (view) {
    case 'today': return <TodayIcon />
    case 'calendar': return <CalendarIcon />
    case 'projects': return <ProjectsIcon />
    case 'search': return <SearchIcon />
    case 'settings': return <SettingsIcon />
    case 'about': return <AboutIcon />
    default: return null
  }
}

function NavItem({
  label, view, activeView, collapsed, setActiveView,
}: {
  label: string
  view: AppView
  activeView: AppView
  collapsed: boolean
  setActiveView: (v: AppView) => void
}) {
  const isActive = activeView === view
  return (
    <button
      onClick={() => setActiveView(view)}
      className={`sb-nav-item${isActive ? ' is-active' : ''}`}
      title={collapsed ? label : undefined}
    >
      {isActive && <span className="sb-nav-pip" />}
      <span style={{ color: isActive ? 'var(--accent)' : 'currentColor' }}>{navIcon(view)}</span>
      {!collapsed && <span className="sb-nav-label">{label}</span>}
    </button>
  )
}

export function Sidebar() {
  const {
    activeView,
    setActiveView,
    sidebarCollapsed,
    toggleSidebarCollapsed,
  } = useMemosaStore()
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    api.getAppVersion().then(setAppVersion).catch(() => {})
  }, [])

  const handleDragMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) void invoke('start_window_drag')
  }, [])

  return (
    <aside className={`app-sidebar${sidebarCollapsed ? ' is-collapsed' : ''}`}>

      {/* ── Drag strip (matches main content drag bar height) ── */}
      <div className="sb-header" onMouseDown={handleDragMouseDown} style={{ cursor: 'grab' }}>
        {!sidebarCollapsed && (
          <>
            <button
              className="sb-brand"
              style={{ cursor: 'default', background: 'none', border: 'none', padding: 0 }}
            >
              <img src={memosaIcon} alt="Memosa" className="sb-logo" />
              <span className="sb-wordmark">Memosa</span>
            </button>
            <button
              className="sb-toggle"
              onClick={toggleSidebarCollapsed}
              onMouseDown={e => e.stopPropagation()}
              title="Collapse sidebar"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <rect x="1.75" y="2" width="12.5" height="12" rx="2.1" stroke="currentColor" strokeWidth="1.35" />
                <path d="M5.25 2v12" stroke="currentColor" strokeWidth="1.35" />
                <path d="M6.9 8L8.8 6.2M6.9 8L8.8 9.8" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </>
        )}
      </div>

      {/* ── Collapsed: toggle + logo sit below the drag strip ── */}
      {sidebarCollapsed && (
        <div className="sb-collapsed-header">
          <button
            className="sb-toggle"
            onClick={toggleSidebarCollapsed}
            title="Expand sidebar"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <rect x="1.75" y="2" width="12.5" height="12" rx="2.1" stroke="currentColor" strokeWidth="1.35" />
              <path d="M10.75 2v12" stroke="currentColor" strokeWidth="1.35" />
              <path d="M9.1 8L7.2 6.2M9.1 8L7.2 9.8" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <img src={memosaIcon} alt="Memosa" className="sb-logo" />
        </div>
      )}

      {/* ── Primary nav ── */}
      <nav className="sb-nav">
        <NavItem label="Home"   view="today"    activeView={activeView} collapsed={sidebarCollapsed} setActiveView={setActiveView} />
        <NavItem label="Memos"  view="projects" activeView={activeView} collapsed={sidebarCollapsed} setActiveView={setActiveView} />
        <NavItem label="Search" view="search"   activeView={activeView} collapsed={sidebarCollapsed} setActiveView={setActiveView} />
      </nav>

      <div className="sb-spacer" />

      {/* ── Secondary nav ── */}
      <nav className="sb-nav sb-nav-secondary">
        <NavItem label="Calendar" view="calendar" activeView={activeView} collapsed={sidebarCollapsed} setActiveView={setActiveView} />
        <NavItem label="About"    view="about"    activeView={activeView} collapsed={sidebarCollapsed} setActiveView={setActiveView} />
        <NavItem label="Settings" view="settings" activeView={activeView} collapsed={sidebarCollapsed} setActiveView={setActiveView} />
      </nav>

      {/* ── Footer ── */}
      {!sidebarCollapsed && appVersion && (
        <div className="sb-footer">v{appVersion}</div>
      )}
    </aside>
  )
}
