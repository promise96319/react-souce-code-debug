if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
  const runtime = require('react-refresh/runtime')
  runtime.injectIntoGlobalHook(window)
  window.$RefreshReg$ = () => {}
  window.$RefreshSig$ = () => (type) => type
}

import * as React from 'react'
import * as ReactDOM from 'react-dom'

const App = () => {
  const [count, setCount] = React.useState(0)
  return (
    <div className="app">
      <div className="app-counter" onClick={() => setCount(count + 1)}>
        {count}
      </div>
    </div>
  )
}

const root = document.getElementById('app')
ReactDOM.createRoot(root).render(<App></App>)
