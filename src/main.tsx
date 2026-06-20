import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import './styles/tokens.css'
import App3 from './v3/App3.tsx'

// 3.0 UI coexists with the legacy app; opt in with ?ui=3 during the rebuild.
const useV3 = new URLSearchParams(window.location.search).get('ui') === '3'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{useV3 ? <App3 /> : <App />}</React.StrictMode>,
)
