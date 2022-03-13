let prevRefreshReg = window.$RefreshReg$
let prevRefreshSig = window.$RefreshSig$
let RefreshRuntime = require('react-refresh/runtime')

window.$RefreshReg$ = (type, id) => {
  // Note module.id is webpack-specific, this may vary in other bundlers
  const fullId = module.id + ' ' + id
  RefreshRuntime.register(type, fullId)
}
window.$RefreshSig$ = RefreshRuntime.createSignatureFunctionForTransform

import React from 'react'

console.log('FunctionComponentB')

const FunctionComponentB = () => (
  <div className="function-component-b">FunctionComponentB</div>
)

export default FunctionComponentB
