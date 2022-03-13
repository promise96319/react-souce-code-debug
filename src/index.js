if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
  const runtime = require('react-refresh/runtime')
  runtime.injectIntoGlobalHook(window)
  window.$RefreshReg$ = () => {}
  window.$RefreshSig$ = () => (type) => type
}

import * as React from 'react'
import * as ReactDOM from 'react-dom'

import FunctionComponentA from './FuncA'

const root = document.getElementById('app')
ReactDOM.createRoot(root).render(<FunctionComponentA></FunctionComponentA>)

// import FunctionComponentB from './FuncB'
// import ClassComponentA from './ClassA'
// import ClassComponentB from './ClassB'

// const App = () => {
//   return (
//     <div id="app">
//       111223
//       <FunctionComponentA></FunctionComponentA>
//       <FunctionComponentB></FunctionComponentB>
//       <ClassComponentA></ClassComponentA>
//       <ClassComponentB></ClassComponentB>
//     </div>
//   )
// }
