import { useEffect, useState } from 'react'
import * as api from '../../lib/tauri'

declare const __MEMOSA_BUILD_STAMP__: string

export function BuildBadge() {
  const [appVersion, setAppVersion] = useState('0.1.0')

  useEffect(() => {
    api.getAppVersion().then(setAppVersion).catch(() => {})
  }, [])

  return (
    <div className="build-badge" title={`Memosa v${appVersion} built ${__MEMOSA_BUILD_STAMP__}`}>
      <span className="build-badge-version">v{appVersion}</span>
      <span className="build-badge-stamp">{__MEMOSA_BUILD_STAMP__}</span>
    </div>
  )
}
