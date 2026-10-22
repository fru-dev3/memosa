import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import './styles/tokens.css'
import App3 from './v3/App3.tsx'

// 3.0 is the app. The legacy UI stays reachable with ?ui=legacy while it is retired.
const legacy = new URLSearchParams(window.location.search).get('ui') === 'legacy'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{legacy ? <App /> : <App3 />}</React.StrictMode>,
)
