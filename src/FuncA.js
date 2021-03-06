let prevRefreshReg = window.$RefreshReg$
let prevRefreshSig = window.$RefreshSig$
let RefreshRuntime = require('react-refresh/runtime')
let enqueueUpdate = require('./utils/update')

window.$RefreshReg$ = (type, id) => {
  // Note module.id is webpack-specific, this may vary in other bundlers
  const fullId = module.id + ' ' + id
  RefreshRuntime.register(type, fullId)
}
window.$RefreshSig$ = RefreshRuntime.createSignatureFunctionForTransform

try {
  const React = require('react')

  const FunctionComponentA = () => {
    const [count, setCount] = React.useState(0)
    return (
      <div className="function-component-a" onClick={() => setCount(count + 1)}>
        {count}22
      </div>
    )
  }
  module.exports = FunctionComponentA

  window.$RefreshReg$(FunctionComponentA, 'FunctionComponentA')
  module.hot.accept()
  enqueueUpdate()
} finally {
  window.$RefreshReg$ = prevRefreshReg
  window.$RefreshSig$ = prevRefreshSig
}
