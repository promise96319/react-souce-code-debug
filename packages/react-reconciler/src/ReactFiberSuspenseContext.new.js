/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type { Fiber } from './ReactInternalTypes';
import type { StackCursor } from './ReactFiberStack.new';

import { createCursor, push, pop } from './ReactFiberStack.new';

export opaque type SuspenseContext = number;
export opaque type SubtreeSuspenseContext: SuspenseContext = number;
export opaque type ShallowSuspenseContext: SuspenseContext = number;

const DefaultSuspenseContext: SuspenseContext = 0b00;

// The Suspense Context is split into two parts. The lower bits is
// inherited deeply down the subtree. The upper bits only affect
// this immediate suspense boundary and gets reset each new
// boundary or suspense list.
// todo 这个是干嘛的？
// SuspenseList 只对其下方最近的 Suspense 和 SuspenseList 组件进行操作。
// 它不会搜索深度超过一级的边界。不过，可以将多个 SuspenseList 组件相互嵌套来构建栅格。
const SubtreeSuspenseContextMask: SuspenseContext = 0b01;

// Subtree Flags:

// InvisibleParentSuspenseContext indicates that one of our parent Suspense
// boundaries is not currently showing visible main content.
// Either because it is already showing a fallback or is not mounted at all.
// We can use this to determine if it is desirable to trigger a fallback at
// the parent. If not, then we might need to trigger undesirable boundaries
// and/or suspend the commit to avoid hiding the parent content.
// 父级 suspense 不显示主内容（已经显示了 fallback 或者没有挂载）
export const InvisibleParentSuspenseContext: SubtreeSuspenseContext = 0b01;

// Shallow Flags:

// ForceSuspenseFallback can be used by SuspenseList to force newly added
// items into their fallback state during one of the render passes.
export const ForceSuspenseFallback: ShallowSuspenseContext = 0b10;

// 当前 suspense context 状态
export const suspenseStackCursor: StackCursor<SuspenseContext> = createCursor(
  DefaultSuspenseContext,
);

// 是否包含 suspense context
export function hasSuspenseContext(
  parentContext: SuspenseContext,
  flag: SuspenseContext,
): boolean {
  return (parentContext & flag) !== 0;
}

// SubtreeSuspenseContextMask
export function setDefaultShallowSuspenseContext(
  parentContext: SuspenseContext,
): SuspenseContext {
  return parentContext & SubtreeSuspenseContextMask;
}

export function setShallowSuspenseContext(
  parentContext: SuspenseContext,
  shallowContext: ShallowSuspenseContext,
): SuspenseContext {
  return (parentContext & SubtreeSuspenseContextMask) | shallowContext;
}

export function addSubtreeSuspenseContext(
  parentContext: SuspenseContext,
  subtreeContext: SubtreeSuspenseContext,
): SuspenseContext {
  return parentContext | subtreeContext;
}

export function pushSuspenseContext(
  fiber: Fiber,
  newContext: SuspenseContext,
): void {
  push(suspenseStackCursor, newContext, fiber);
}

export function popSuspenseContext(fiber: Fiber): void {
  pop(suspenseStackCursor, fiber);
}
