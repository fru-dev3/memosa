import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { invoke } from '@tauri-apps/api/core'
import type {
  AmbientModeSettings,
  AppSettings,
  AppView,
  AuthStatus,
  CalendarEvent,
  Folder,
  HotkeyConfig,
  Meeting,
  ModelInfo,
  PrivacyDashboard,
  RecordingProfile,
  RecordingStatus,
} from '../lib/types'
import * as api from '../lib/tauri'

interface AutoRecordWarning {
  event: CalendarEvent
  seconds_until: number
}

interface TranscriptionProgress {
  progress: number
  partial_text: string
}

interface MemosaStore {
  // Recording
  recordingStatus: RecordingStatus
  audioLevel: number
  recordingGuardMessage: string | null
  liveTranscriptLines: string[]
  setRecordingStatus: (status: RecordingStatus) => void
  setAudioLevel: (level: number) => void
  setRecordingGuardMessage: (message: string | null) => void
  appendLiveTranscriptLine: (text: string) => void
  clearLiveTranscript: () => void

  // Calendar
  todayEvents: CalendarEvent[]
  authStatus: AuthStatus
  autoRecord: boolean
  setTodayEvents: (events: CalendarEvent[]) => void
  setAuthStatus: (status: AuthStatus) => void
  setAutoRecord: (enabled: boolean) => void

  // Meetings
  meetings: Meeting[]
  currentMeeting: Meeting | null
  libraryViewMode: 'list' | 'cards'
  favoriteMeetingIds: string[]
  setMeetings: (meetings: Meeting[]) => void
  setCurrentMeeting: (meeting: Meeting | null) => void
  upsertMeeting: (meeting: Meeting) => void
  removeMeeting: (id: string) => void
  toggleFavorite: (id: string) => void
  setLibraryViewMode: (mode: 'list' | 'cards') => void

  // Transcription
  transcriptionProgress: Map<string, TranscriptionProgress>
  transcriptionErrors: Map<string, string>
  modelDownloadProgress: Map<string, number>
  setTranscriptionProgress: (meetingId: string, progress: TranscriptionProgress) => void
  clearTranscriptionProgress: (meetingId: string) => void
  setTranscriptionError: (meetingId: string, error: string) => void
  clearTranscriptionError: (meetingId: string) => void
  setModelDownloadProgress: (model: string, progress: number) => void
  clearModelDownloadProgress: (model: string) => void

  // Models
  availableModels: ModelInfo[]
  setAvailableModels: (models: ModelInfo[]) => void

  // Settings
  settings: AppSettings | null
  setSettings: (settings: AppSettings) => void

  // Product configuration
  profiles: RecordingProfile[]
  selectedProfileId: string
  ambientMode: AmbientModeSettings
  hotkeys: HotkeyConfig
  privacyDashboard: PrivacyDashboard
  setProfiles: (profiles: RecordingProfile[]) => void
  updateProfile: (id: string, patch: Partial<RecordingProfile>) => void
  createProfile: () => void
  deleteProfile: (id: string) => void
  setSelectedProfileId: (id: string) => void
  setAmbientMode: (ambientMode: AmbientModeSettings) => void
  setHotkeys: (hotkeys: HotkeyConfig) => void
  setPrivacyDashboard: (dashboard: PrivacyDashboard) => void
  screenshotCaptureEnabled: boolean
  screenshotIntervalMinutes: number
  setScreenshotCaptureEnabled: (enabled: boolean) => void
  setScreenshotIntervalMinutes: (minutes: number) => void
  // ephemeral — not persisted
  screenshotCount: number
  screenshotCountdown: number | null
  setScreenshotCount: (n: number) => void
  setScreenshotCountdown: (n: number | null) => void

  // Folders / Projects
  folders: Folder[]
  meetingFolderAssignments: Record<string, string[]>
  createFolder: (name: string, parentId?: string | null) => void
  renameFolder: (id: string, name: string) => void
  setFolderColor: (id: string, color: string) => void
  moveFolder: (id: string, newParentId: string | null) => void
  deleteFolder: (id: string) => void
  assignMeetingToProject: (meetingId: string, folderId: string) => void
  removeMeetingFromProject: (meetingId: string, folderId: string) => void
  loadFoldersFromDb: () => Promise<void>

  // UI
  activeView: AppView
  activeFolderId: string | null
  setActiveFolderId: (id: string | null) => void
  sidebarCollapsed: boolean
  searchSeed: string
  commandPaletteOpen: boolean
  autoRecordWarning: AutoRecordWarning | null
  setActiveView: (view: AppView) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebarCollapsed: () => void
  setSearchSeed: (seed: string) => void
  setCommandPaletteOpen: (open: boolean) => void
  setAutoRecordWarning: (warning: AutoRecordWarning | null) => void
}

const systemDefaultProfile: RecordingProfile = {
  id: 'default',
  name: 'Default',
  icon: 'briefcase',
  accent: '#0FBE80',
  recording_mode: 'both',
  auto_transcribe: true,
  auto_summarize: true,
  auto_tag: true,
  auto_export: false,
  auto_open_after_recording: true,
  summary_template: 'general',
  export_targets: [],
  default_tags: ['general'],
  privacy_mode: 'strict',
  retention_days: 90,
}

const defaultProfiles: RecordingProfile[] = [
  systemDefaultProfile,
  {
    id: 'customer-calls',
    name: 'Customer Calls',
    icon: 'spark',
    accent: '#28A87D',
    recording_mode: 'both',
    auto_transcribe: true,
    auto_summarize: true,
    auto_tag: true,
    auto_export: true,
    auto_open_after_recording: true,
    summary_template: 'customer_call',
    export_targets: [],
    default_tags: ['customer', 'follow-up'],
    privacy_mode: 'balanced',
    retention_days: 180,
  },
  {
    id: 'research',
    name: 'Research',
    icon: 'notebook',
    accent: '#6E9F46',
    recording_mode: 'system',
    auto_transcribe: true,
    auto_summarize: false,
    auto_tag: false,
    auto_export: false,
    auto_open_after_recording: false,
    summary_template: 'research_notes',
    export_targets: [],
    default_tags: ['research'],
    privacy_mode: 'strict',
  },
]

function normalizeProfiles(profiles: RecordingProfile[]) {
  const cleaned = profiles.filter((profile) => profile && profile.id && profile.name)
  const withoutDefault = cleaned.filter((profile) => profile.id !== systemDefaultProfile.id)
  const existingDefault = cleaned.find((profile) => profile.id === systemDefaultProfile.id)
  return [
    { ...systemDefaultProfile, ...existingDefault, id: systemDefaultProfile.id },
    ...withoutDefault,
  ]
}

const defaultAmbientMode: AmbientModeSettings = {
  enabled: false,
  buffer_minutes: 30,
  capture_microphone: true,
  capture_system_audio: false,
  active_start_hour: 9,
  active_end_hour: 18,
  excluded_apps: ['1Password', 'Messages'],
  max_daily_storage_mb: 1024,
  save_hotkey: 'Cmd+Shift+S',
}

const defaultHotkeys: HotkeyConfig = {
  start_stop_recording: 'Cmd+Shift+R',
  open_command_palette: 'Cmd+Shift+P',
  quick_profile_switcher: 'Cmd+Shift+U',
}

const defaultPrivacyDashboard: PrivacyDashboard = {
  local_only_mode: true,
  export_activity: 'No exports in the last 7 days',
  last_cloud_action: 'Never',
  encryption_status: 'macOS disk encryption dependent',
  model_runtime: 'Whisper runs locally on this Mac',
}

const SAFE_APP_VIEWS: AppView[] = [
  'today',
  'calendar',
  'library',
  'projects',
  'search',
  'about',
  'profiles',
  'templates',
  'privacy',
  'settings',
]

export const useMemosaStore = create<MemosaStore>()(persist((set, get) => ({
  recordingStatus: { is_recording: false },
  audioLevel: 0,
  recordingGuardMessage: null,
  liveTranscriptLines: [],
  setRecordingStatus: (status) => set({ recordingStatus: status }),
  setAudioLevel: (level) => set({ audioLevel: level }),
  setRecordingGuardMessage: (message) => set({ recordingGuardMessage: message }),
  appendLiveTranscriptLine: (text) => set((s) => ({ liveTranscriptLines: [...s.liveTranscriptLines, text] })),
  clearLiveTranscript: () => set({ liveTranscriptLines: [] }),

  todayEvents: [],
  authStatus: { connected: false },
  autoRecord: false,
  setTodayEvents: (events) => set({ todayEvents: events }),
  setAuthStatus: (status) => set({ authStatus: status }),
  setAutoRecord: (enabled) => set({ autoRecord: enabled }),

  meetings: [],
  currentMeeting: null,
  libraryViewMode: 'list',
  favoriteMeetingIds: [],
  setMeetings: (meetings) => set((state) => ({
    meetings: meetings.map((meeting) => ({
      ...meeting,
      is_favorite: state.favoriteMeetingIds.includes(meeting.id),
    })),
  })),
  setCurrentMeeting: (meeting) => set({ currentMeeting: meeting }),
  upsertMeeting: (meeting) => set((state) => ({
    currentMeeting: state.currentMeeting?.id === meeting.id
      ? { ...meeting, is_favorite: state.favoriteMeetingIds.includes(meeting.id) }
      : state.currentMeeting,
    meetings: state.meetings.some(m => m.id === meeting.id)
      ? state.meetings.map(m => m.id === meeting.id ? { ...meeting, is_favorite: state.favoriteMeetingIds.includes(meeting.id) } : m)
      : [{ ...meeting, is_favorite: state.favoriteMeetingIds.includes(meeting.id) }, ...state.meetings]
  })),
  removeMeeting: (id) => set((state) => ({
    currentMeeting: state.currentMeeting?.id === id ? null : state.currentMeeting,
    meetings: state.meetings.filter(m => m.id !== id),
    favoriteMeetingIds: state.favoriteMeetingIds.filter((item) => item !== id),
  })),
  toggleFavorite: (id) => {
    const nowFavorite = !get().meetings.find(m => m.id === id)?.is_favorite
    set((s) => ({
      favoriteMeetingIds: nowFavorite
        ? [...s.favoriteMeetingIds, id]
        : s.favoriteMeetingIds.filter((item) => item !== id),
      meetings: s.meetings.map((meeting) =>
        meeting.id === id ? { ...meeting, is_favorite: nowFavorite } : meeting
      ),
      currentMeeting: s.currentMeeting?.id === id
        ? { ...s.currentMeeting, is_favorite: nowFavorite }
        : s.currentMeeting,
    }))
    invoke('set_meeting_favorite', { id, isFavorite: nowFavorite }).catch(console.error)
  },
  setLibraryViewMode: (mode) => set({ libraryViewMode: mode }),

  folders: [
    { id: 'folder-default-people', name: 'People', parentId: null, color: '#3B82F6' },
    { id: 'folder-default-accounts', name: 'Accounts', parentId: null, color: '#8B5CF6' },
    { id: 'folder-default-meetings', name: 'Meetings', parentId: null, color: '#0FBE80' },
    { id: 'folder-default-notes', name: 'Notes', parentId: null, color: '#F59E0B' },
  ],
  meetingFolderAssignments: {},
  createFolder: (name, parentId = null) => {
    const id = `folder-${Date.now()}`
    const color = '#0FBE80'
    set((state) => ({ folders: [...state.folders, { id, name, parentId: parentId ?? null, color }] }))
    api.saveFolder(id, name, parentId ?? null, color).catch(() => {})
  },
  renameFolder: (id, name) => {
    set((state) => ({ folders: state.folders.map((f) => f.id === id ? { ...f, name } : f) }))
    const f = useMemosaStore.getState().folders.find(f => f.id === id)
    if (f) api.saveFolder(f.id, name, f.parentId ?? null, f.color ?? null).catch(() => {})
  },
  setFolderColor: (id, color) => {
    set((state) => ({ folders: state.folders.map((f) => f.id === id ? { ...f, color } : f) }))
    const f = useMemosaStore.getState().folders.find(f => f.id === id)
    if (f) api.saveFolder(f.id, f.name, f.parentId ?? null, color).catch(() => {})
  },
  moveFolder: (id, newParentId) => {
    set((state) => {
      const isDescendant = (parentId: string | null): boolean => {
        if (parentId === null) return false
        if (parentId === id) return true
        const parent = state.folders.find((f) => f.id === parentId)
        return parent ? isDescendant(parent.parentId) : false
      }
      if (newParentId !== null && (newParentId === id || isDescendant(newParentId))) return state
      return { folders: state.folders.map((f) => f.id === id ? { ...f, parentId: newParentId } : f) }
    })
    const f = useMemosaStore.getState().folders.find(f => f.id === id)
    if (f) api.saveFolder(f.id, f.name, newParentId, f.color ?? null).catch(() => {})
  },
  deleteFolder: (id) => {
    set((state) => {
      const toDelete = new Set<string>()
      const collect = (fid: string) => {
        toDelete.add(fid)
        state.folders.filter((f) => f.parentId === fid).forEach((f) => collect(f.id))
      }
      collect(id)
      const nextAssignments: Record<string, string[]> = {}
      for (const [mid, fids] of Object.entries(state.meetingFolderAssignments)) {
        const filtered = fids.filter((fid) => !toDelete.has(fid))
        if (filtered.length > 0) nextAssignments[mid] = filtered
      }
      return { folders: state.folders.filter((f) => !toDelete.has(f.id)), meetingFolderAssignments: nextAssignments }
    })
    api.deleteFolderRecord(id).catch(() => {})
  },
  assignMeetingToProject: (meetingId, folderId) => {
    set((state) => {
      const existing = state.meetingFolderAssignments[meetingId] ?? []
      if (existing.includes(folderId)) return state
      return { meetingFolderAssignments: { ...state.meetingFolderAssignments, [meetingId]: [...existing, folderId] } }
    })
    api.assignMeetingFolder(meetingId, folderId).catch(() => {})
  },
  removeMeetingFromProject: (meetingId, folderId) => {
    set((state) => {
      const existing = state.meetingFolderAssignments[meetingId] ?? []
      const filtered = existing.filter((fid) => fid !== folderId)
      const next = { ...state.meetingFolderAssignments }
      if (filtered.length === 0) { delete next[meetingId] } else { next[meetingId] = filtered }
      return { meetingFolderAssignments: next }
    })
    api.removeMeetingFolder(meetingId, folderId).catch(() => {})
  },
  loadFoldersFromDb: async () => {
    try {
      const [folderRows, assignmentRows] = await Promise.all([
        api.getFolders(),
        api.getFolderAssignments(),
      ])
      if (folderRows.length === 0) {
        // First launch with empty DB — persist the current localStorage folders to DB
        const state = useMemosaStore.getState()
        for (const f of state.folders) {
          await api.saveFolder(f.id, f.name, f.parentId ?? null, f.color ?? null)
        }
        for (const [mid, fids] of Object.entries(state.meetingFolderAssignments)) {
          for (const fid of fids) await api.assignMeetingFolder(mid, fid)
        }
        return
      }
      const folders: Folder[] = folderRows.map(r => ({
        id: r.id, name: r.name, parentId: r.parent_id ?? null, color: r.color ?? '#0FBE80',
      }))
      const meetingFolderAssignments: Record<string, string[]> = {}
      for (const { meeting_id, folder_id } of assignmentRows) {
        if (!meetingFolderAssignments[meeting_id]) meetingFolderAssignments[meeting_id] = []
        meetingFolderAssignments[meeting_id].push(folder_id)
      }
      set({ folders, meetingFolderAssignments })
    } catch {
      // DB not available (dev/web mode) — keep localStorage state
    }
  },

  transcriptionProgress: new Map(),
  transcriptionErrors: new Map(),
  modelDownloadProgress: new Map(),
  setTranscriptionProgress: (meetingId, progress) => set((state) => {
    const next = new Map(state.transcriptionProgress)
    next.set(meetingId, progress)
    return { transcriptionProgress: next }
  }),
  clearTranscriptionProgress: (meetingId) => set((state) => {
    const next = new Map(state.transcriptionProgress)
    next.delete(meetingId)
    return { transcriptionProgress: next }
  }),
  setTranscriptionError: (meetingId, error) => set((state) => {
    const next = new Map(state.transcriptionErrors)
    next.set(meetingId, error)
    return { transcriptionErrors: next }
  }),
  clearTranscriptionError: (meetingId) => set((state) => {
    const next = new Map(state.transcriptionErrors)
    next.delete(meetingId)
    return { transcriptionErrors: next }
  }),
  setModelDownloadProgress: (model, progress) => set((state) => {
    const next = new Map(state.modelDownloadProgress)
    next.set(model, progress)
    return { modelDownloadProgress: next }
  }),
  clearModelDownloadProgress: (model) => set((state) => {
    const next = new Map(state.modelDownloadProgress)
    next.delete(model)
    return { modelDownloadProgress: next }
  }),

  availableModels: [],
  setAvailableModels: (models) => set({ availableModels: models }),

  settings: null,
  setSettings: (settings) => set({ settings }),

  profiles: normalizeProfiles(defaultProfiles),
  selectedProfileId: systemDefaultProfile.id,
  ambientMode: defaultAmbientMode,
  hotkeys: defaultHotkeys,
  privacyDashboard: defaultPrivacyDashboard,
  setProfiles: (profiles) => set((state) => {
    const normalized = normalizeProfiles(profiles)
    const selectedExists = normalized.some((profile) => profile.id === state.selectedProfileId)
    return {
      profiles: normalized,
      selectedProfileId: selectedExists ? state.selectedProfileId : systemDefaultProfile.id,
    }
  }),
  updateProfile: (id, patch) => set((state) => ({
    profiles: state.profiles.map((profile) => profile.id === id ? { ...profile, ...patch } : profile),
  })),
  createProfile: () => set((state) => {
    const next = {
      id: `profile-${Date.now()}`,
      name: 'New Profile',
      icon: 'spark',
      accent: '#1FA971',
      recording_mode: 'both' as const,
      auto_transcribe: true,
      auto_summarize: false,
      auto_tag: false,
      auto_export: false,
      auto_open_after_recording: false,
      summary_template: 'general' as const,
      export_targets: [],
      default_tags: [],
      privacy_mode: 'strict' as const,
    }
    return {
      profiles: [...state.profiles, next],
      selectedProfileId: next.id,
    }
  }),
  deleteProfile: (id) => set((state) => {
    if (id === systemDefaultProfile.id) {
      return state
    }
    const profiles = state.profiles.filter((profile) => profile.id !== id)
    return {
      profiles: normalizeProfiles(profiles),
      selectedProfileId: state.selectedProfileId === id ? systemDefaultProfile.id : state.selectedProfileId,
    }
  }),
  setSelectedProfileId: (id) => set({ selectedProfileId: id }),
  setAmbientMode: (ambientMode) => set({ ambientMode }),
  setHotkeys: (hotkeys) => set({ hotkeys }),
  setPrivacyDashboard: (privacyDashboard) => set({ privacyDashboard }),
  screenshotCaptureEnabled: false,
  screenshotIntervalMinutes: 5,
  setScreenshotCaptureEnabled: (enabled) => set({ screenshotCaptureEnabled: enabled }),
  setScreenshotIntervalMinutes: (minutes) => set({ screenshotIntervalMinutes: minutes }),
  screenshotCount: 0,
  screenshotCountdown: null,
  setScreenshotCount: (n) => set({ screenshotCount: n }),
  setScreenshotCountdown: (n) => set({ screenshotCountdown: n }),

  activeView: 'today',
  activeFolderId: null,
  setActiveFolderId: (id) => set({ activeFolderId: id }),
  sidebarCollapsed: false,
  searchSeed: '',
  commandPaletteOpen: false,
  autoRecordWarning: null,
  setActiveView: (view) => set({ activeView: view }),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleSidebarCollapsed: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSearchSeed: (seed) => set({ searchSeed: seed }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setAutoRecordWarning: (warning) => set({ autoRecordWarning: warning }),
}), {
  name: 'memosa-ui-state-v2',
  version: 2,
  migrate: (persistedState: unknown) => {
    if (!persistedState || typeof persistedState !== 'object') {
      return persistedState as MemosaStore
    }

    const state = persistedState as Partial<MemosaStore> & { activeView?: unknown }
    return {
      ...state,
      activeView: SAFE_APP_VIEWS.includes(state.activeView as AppView) ? state.activeView as AppView : 'today',
    } as MemosaStore
  },
  partialize: (state) => ({
    ambientMode: state.ambientMode,
    favoriteMeetingIds: state.favoriteMeetingIds,
    folders: state.folders,
    hotkeys: state.hotkeys,
    libraryViewMode: state.libraryViewMode,
    meetingFolderAssignments: state.meetingFolderAssignments,
    privacyDashboard: state.privacyDashboard,
    profiles: state.profiles,
    searchSeed: state.searchSeed,
    selectedProfileId: state.selectedProfileId,
    sidebarCollapsed: state.sidebarCollapsed,
    screenshotCaptureEnabled: state.screenshotCaptureEnabled,
    screenshotIntervalMinutes: state.screenshotIntervalMinutes,
  }),
}))
