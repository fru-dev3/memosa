import { useEffect, useState } from 'react'
import memosaIcon from '../../assets/memosa-icon.png'
import * as api from '../../lib/tauri'
import type { AppView } from '../../lib/types'
import { useMemosaStore } from '../../store'

function IconWrap({ children }: { children: React.ReactNode }) {
  return <span style={{ width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{children}</span>
}

function TodayIcon() {
  return <IconWrap><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="2.5" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M5 1.5v2M11 1.5v2M1.5 6h13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="5.5" cy="10" r="1" fill="currentColor"/><circle cx="10.5" cy="10" r="1" fill="currentColor"/></svg></IconWrap>
}
function CalendarIcon() {
  return <IconWrap><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="2.5" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M1.5 6h13M5 1.5v2M11 1.5v2M4.5 8.8h2.2M9.2 8.8h2.2M4.5 11.3h2.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg></IconWrap>
}
function LibraryIcon() {
  return <IconWrap><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="8" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><path d="M10 4.5l4-1.5v10l-4 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M4.5 6.5h3M4.5 9.5h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></IconWrap>
}
function SearchIcon() {
  return <IconWrap><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5"/><path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></IconWrap>
}
function DiscoverIcon() {
  return <IconWrap><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="5.8" cy="6.2" r="2.8" stroke="currentColor" strokeWidth="1.4"/><path d="M8.1 8.4L10.8 11.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M10.9 4.1L13.6 4.1M12.25 2.75V5.45" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round"/></svg></IconWrap>
}
function InsightsIcon() {
  return <IconWrap><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 12.5L6.1 9.4L8.35 11.2L13 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><circle cx="3" cy="12.5" r="1" fill="currentColor"/><circle cx="6.1" cy="9.4" r="1" fill="currentColor"/><circle cx="8.35" cy="11.2" r="1" fill="currentColor"/><circle cx="13" cy="6.5" r="1" fill="currentColor"/></svg></IconWrap>
}
function IntegrationsIcon() {
  return <IconWrap><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M4 5.5h3.2M8.8 10.5H12M8 3v3M8 10v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="3" cy="5.5" r="1.35" stroke="currentColor" strokeWidth="1.3"/><circle cx="13" cy="10.5" r="1.35" stroke="currentColor" strokeWidth="1.3"/><circle cx="8" cy="8" r="1.6" stroke="currentColor" strokeWidth="1.3"/></svg></IconWrap>
}
function AboutIcon() {
  return <IconWrap><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5"/><path d="M8 7.2V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="8" cy="4.8" r="0.9" fill="currentColor"/></svg></IconWrap>
}
function ProfilesIcon() {
  return <IconWrap><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 8a2.75 2.75 0 100-5.5A2.75 2.75 0 008 8z" stroke="currentColor" strokeWidth="1.5"/><path d="M3 13.5c.7-2 2.6-3 5-3s4.3 1 5 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></IconWrap>
}
function TemplatesIcon() {
  return <IconWrap><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 2.5H13V13.5H3V2.5Z" stroke="currentColor" strokeWidth="1.5"/><path d="M5.25 5.5H10.75M5.25 8H10.75M5.25 10.5H8.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></IconWrap>
}
function ProjectsIcon() {
  return <IconWrap><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2 4.5C2 3.67 2.67 3 3.5 3H6.5L8 4.5H12.5C13.33 4.5 14 5.17 14 6V12C14 12.83 13.33 13.5 12.5 13.5H3.5C2.67 13.5 2 12.83 2 12V4.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg></IconWrap>
}
function SettingsIcon() {
  return <IconWrap><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M8 1v1.5M8 13.5V15M15 8h-1.5M2.5 8H1M12.95 3.05l-1.06 1.06M4.11 11.89l-1.06 1.06M12.95 12.95l-1.06-1.06M4.11 4.11L3.05 3.05" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></IconWrap>
}

function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.75" y="2" width="12.5" height="12" rx="2.1" stroke="currentColor" strokeWidth="1.35" />
      <path d="M5.25 2v12" stroke="currentColor" strokeWidth="1.35" />
      {collapsed ? (
        <path d="M9.2 8L7.3 6.2M9.2 8L7.3 9.8" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M6.9 8L8.8 6.2M6.9 8L8.8 9.8" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  )
}

function navIcon(view: AppView) {
  switch (view) {
    case 'today': return <TodayIcon />
    case 'calendar': return <CalendarIcon />
    case 'library': return <LibraryIcon />
    case 'projects': return <ProjectsIcon />
    case 'search': return <SearchIcon />
    case 'about': return <AboutIcon />
    case 'profiles': return <ProfilesIcon />
    case 'templates': return <TemplatesIcon />
    case 'settings': return <SettingsIcon />
    case 'privacy': return <SettingsIcon />
  }
}

function NavItem({
  label,
  hint,
  view,
  activeView,
  collapsed = false,
  setActiveView,
}: {
  label: string
  hint?: string
  view: AppView
  activeView: AppView
  collapsed?: boolean
  setActiveView: (v: AppView) => void
}) {
  const isActive = activeView === view

  return (
    <button
      onClick={() => setActiveView(view)}
      className="sidebar-nav-item"
      style={{
        background: isActive ? 'var(--bg-selected)' : 'transparent',
        color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
        borderColor: isActive ? 'var(--border-strong)' : 'transparent',
      }}
    >
      {isActive && <span className="sidebar-nav-rail" />}
      <span style={{ color: isActive ? 'var(--accent)' : 'currentColor' }}>{navIcon(view)}</span>
      {!collapsed && <span style={{ flex: 1 }}>{label}</span>}
      {!collapsed && hint && <span className="sidebar-nav-hint">{hint}</span>}
    </button>
  )
}

export function Sidebar() {
  const {
    activeView,
    profiles,
    selectedProfileId,
    setActiveView,
    sidebarCollapsed,
    toggleSidebarCollapsed,
  } = useMemosaStore()
  const [appVersion, setAppVersion] = useState('0.1.0')

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0]

  useEffect(() => {
    api.getAppVersion().then(setAppVersion).catch(() => {})
  }, [])

  return (
    <aside className={`app-sidebar ${sidebarCollapsed ? 'is-collapsed' : ''}`}>
      <div data-tauri-drag-region className="sidebar-header">
        <button
          type="button"
          className="sidebar-header-toggle"
          onClick={toggleSidebarCollapsed}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <SidebarToggleIcon collapsed={sidebarCollapsed} />
        </button>
        <div className="sidebar-brand-lockup">
          <div className="sidebar-brand-mark">
            <img
              src={memosaIcon}
              alt="Memosa"
              width={52}
              height={35}
              style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }}
            />
          </div>
          {!sidebarCollapsed && (
            <div className="sidebar-brand-copy">
              <div className="sidebar-brand-title">Memosa</div>
              <div className="sidebar-brand-subtitle">Meeting memory</div>
            </div>
          )}
        </div>
      </div>

      {!sidebarCollapsed && (
      <div className="sidebar-profile-card">
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>
            Active profile
          </div>
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="profile-swatch" style={{ background: selectedProfile?.accent ?? 'var(--accent)' }} />
            <div style={{ fontSize: 13, fontWeight: 600 }}>{selectedProfile?.name ?? 'Work'}</div>
          </div>
        </div>
      </div>
      )}

      {!sidebarCollapsed && (
      <div style={{ padding: '12px 16px 6px', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>
        Workspace
      </div>
      )}
      <nav style={{ padding: '0 10px 0', display: 'grid', gap: 4 }}>
        <NavItem label="Home" view="today" activeView={activeView} collapsed={sidebarCollapsed} setActiveView={setActiveView} />
        <NavItem label="Memos" view="library" activeView={activeView} collapsed={sidebarCollapsed} setActiveView={setActiveView} />
        <NavItem label="Folders" view="projects" activeView={activeView} collapsed={sidebarCollapsed} setActiveView={setActiveView} />
        <NavItem label="Search" view="search" activeView={activeView} collapsed={sidebarCollapsed} setActiveView={setActiveView} />
      </nav>

      <div style={{ marginTop: 'auto', padding: '14px 14px 16px', display: 'grid', gap: 10 }}>
        <div className="sidebar-preferences-group">
          {!sidebarCollapsed && <div className="sidebar-preferences-label">Planning</div>}
          <nav style={{ display: 'grid', gap: 4 }}>
            <NavItem label="Calendar" view="calendar" activeView={activeView} collapsed={sidebarCollapsed} setActiveView={setActiveView} />
          </nav>
        </div>

        <div className="sidebar-preferences-group">
          {!sidebarCollapsed && <div className="sidebar-preferences-label">Preferences</div>}
          <nav style={{ display: 'grid', gap: 4 }}>
            <NavItem label="About" view="about" activeView={activeView} collapsed={sidebarCollapsed} setActiveView={setActiveView} />
            <NavItem label="Profiles" view="profiles" activeView={activeView} collapsed={sidebarCollapsed} setActiveView={setActiveView} />
<NavItem label="Settings" view="settings" activeView={activeView} collapsed={sidebarCollapsed} setActiveView={setActiveView} />
          </nav>
        </div>

        <div className="sidebar-footer" style={{ display: sidebarCollapsed ? 'none' : undefined }}>
          <span>v{appVersion}</span>
        </div>
      </div>
    </aside>
  )
}
