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

  class ClassComponentA extends React.Component {
    constructor(props) {
      super(props)

      this.state = {
        count: 0,
      }
    }
    render() {
      const { count } = this.state
      return (
        <div
          className="class-component-a"
          onClick={() => this.setState({ count: count + 1 })}
        >
          {this.state.count}323
        </div>
      )
    }
  }
  module.exports = ClassComponentA

  window.$RefreshReg$(ClassComponentA, 'ClassComponentA')
  module.hot.accept()
  enqueueUpdate()
} finally {
  window.$RefreshReg$ = prevRefreshReg
  window.$RefreshSig$ = prevRefreshSig
}
