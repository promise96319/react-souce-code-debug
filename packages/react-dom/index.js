/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

// Export all exports so that they're available in tests.
// We can't use export * from in Flow for some reason.
export {
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,
  // 创建 portal
  createPortal,
  // 创建 root
  createRoot,
  hydrateRoot,
  // 废弃，违背了抽象原则
  findDOMNode,
  // 同步执行函数，会设置相应的优先级
  flushSync,
  hydrate,
  // render ，legacy 模式
  render,
  unmountComponentAtNode,
  unstable_batchedUpdates,
  unstable_createEventHandle,
  unstable_flushControlled,
  unstable_isNewReconciler,
  unstable_renderSubtreeIntoContainer,
  unstable_runWithPriority, // DO NOT USE: Temporarily exposed to migrate off of Scheduler.runWithPriority.
  unstable_scheduleHydration,
  version,
} from './src/client/ReactDOM';

import * as ReactDom from './src/client/ReactDOM';
export default ReactDom;
