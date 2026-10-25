import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import './styles/tokens.css'
import App3 from './v3/App3.tsx'
import Pill from './v3/Pill.tsx'

// 3.0 is the app. The legacy UI stays reachable with ?ui=legacy while it is retired.
const params = new URLSearchParams(window.location.search)
const legacy = params.get('ui') === 'legacy'
// The floating recorder window loads the same app at ?view=pill.
const pill = params.get('view') === 'pill'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{pill ? <Pill /> : legacy ? <App /> : <App3 />}</React.StrictMode>,
)
