/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {
  Instance,
  TextInstance,
  SuspenseInstance,
  Container,
  ChildSet,
  UpdatePayload,
} from './ReactFiberHostConfig';
import type { Fiber } from './ReactInternalTypes';
import type { FiberRoot } from './ReactInternalTypes';
import type { Lanes } from './ReactFiberLane.new';
import type { SuspenseState } from './ReactFiberSuspenseComponent.new';
import type { UpdateQueue } from './ReactUpdateQueue.new';
import type { FunctionComponentUpdateQueue } from './ReactFiberHooks.new';
import type { Wakeable } from 'shared/ReactTypes';
import type { OffscreenState } from './ReactFiberOffscreenComponent';
import type { HookFlags } from './ReactHookEffectTags';

import {
  enableCreateEventHandleAPI,
  enableProfilerTimer,
  enableProfilerCommitHooks,
  enableProfilerNestedUpdatePhase,
  enableSuspenseServerRenderer,
  enableSuspenseCallback,
  enableScopeAPI,
  enableStrictEffects,
  deletedTreeCleanUpLevel,
  enableSuspenseLayoutEffectSemantics,
  enableUpdaterTracking,
} from 'shared/ReactFeatureFlags';
import {
  FunctionComponent,
  ForwardRef,
  ClassComponent,
  HostRoot,
  HostComponent,
  HostText,
  HostPortal,
  Profiler,
  SuspenseComponent,
  DehydratedFragment,
  IncompleteClassComponent,
  MemoComponent,
  SimpleMemoComponent,
  SuspenseListComponent,
  ScopeComponent,
  OffscreenComponent,
  LegacyHiddenComponent,
} from './ReactWorkTags';
import { detachDeletedInstance } from './ReactFiberHostConfig';
import {
  NoFlags,
  ContentReset,
  Placement,
  PlacementAndUpdate,
  ChildDeletion,
  Snapshot,
  Update,
  Ref,
  Hydrating,
  HydratingAndUpdate,
  Passive,
  BeforeMutationMask,
  MutationMask,
  LayoutMask,
  PassiveMask,
  Visibility,
} from './ReactFiberFlags';
import getComponentNameFromFiber from 'react-reconciler/src/getComponentNameFromFiber';
import invariant from 'shared/invariant';
import {
  resetCurrentFiber as resetCurrentDebugFiberInDEV,
  setCurrentFiber as setCurrentDebugFiberInDEV,
} from './ReactCurrentFiber';
import { isDevToolsPresent } from './ReactFiberDevToolsHook.new';
import { onCommitUnmount } from './ReactFiberDevToolsHook.new';
import { resolveDefaultProps } from './ReactFiberLazyComponent.new';
import {
  isCurrentUpdateNested,
  getCommitTime,
  recordLayoutEffectDuration,
  startLayoutEffectTimer,
  recordPassiveEffectDuration,
  startPassiveEffectTimer,
} from './ReactProfilerTimer.new';
import { ConcurrentMode, NoMode, ProfileMode } from './ReactTypeOfMode';
import { commitUpdateQueue } from './ReactUpdateQueue.new';
import {
  getPublicInstance,
  supportsMutation,
  supportsPersistence,
  supportsHydration,
  commitMount,
  commitUpdate,
  resetTextContent,
  commitTextUpdate,
  appendChild,
  appendChildToContainer,
  insertBefore,
  insertInContainerBefore,
  removeChild,
  removeChildFromContainer,
  clearSuspenseBoundary,
  clearSuspenseBoundaryFromContainer,
  replaceContainerChildren,
  createContainerChildSet,
  hideInstance,
  hideTextInstance,
  unhideInstance,
  unhideTextInstance,
  commitHydratedContainer,
  commitHydratedSuspenseInstance,
  clearContainer,
  prepareScopeUpdate,
  prepareForCommit,
  beforeActiveInstanceBlur,
} from './ReactFiberHostConfig';
import {
  captureCommitPhaseError,
  resolveRetryWakeable,
  markCommitTimeOfFallback,
  enqueuePendingPassiveProfilerEffect,
  restorePendingUpdaters,
} from './ReactFiberWorkLoop.new';
import {
  NoFlags as NoHookEffect,
  HasEffect as HookHasEffect,
  Layout as HookLayout,
  Passive as HookPassive,
} from './ReactHookEffectTags';
import { didWarnAboutReassigningProps } from './ReactFiberBeginWork.new';
import { doesFiberContain } from './ReactFiberTreeReflection';
import { invokeGuardedCallback, clearCaughtError } from 'shared/ReactErrorUtils';

let didWarnAboutUndefinedSnapshotBeforeUpdate: Set<mixed> | null = null;
if (__DEV__) {
  didWarnAboutUndefinedSnapshotBeforeUpdate = new Set();
}

// Used during the commit phase to track the state of the Offscreen component stack.
// Allows us to avoid traversing the return path to find the nearest Offscreen ancestor.
// Only used when enableSuspenseLayoutEffectSemantics is enabled.
let offscreenSubtreeIsHidden: boolean = false;
let offscreenSubtreeWasHidden: boolean = false;

const PossiblyWeakSet = typeof WeakSet === 'function' ? WeakSet : Set;

let nextEffect: Fiber | null = null;

// Used for Profiling builds to track updaters.
let inProgressLanes: Lanes | null = null;
let inProgressRoot: FiberRoot | null = null;

function reportUncaughtErrorInDEV(error) {
  // Wrapping each small part of the commit phase into a guarded
  // callback is a bit too slow (https://github.com/facebook/react/pull/21666).
  // But we rely on it to surface errors to DEV tools like overlays
  // (https://github.com/facebook/react/issues/21712).
  // As a compromise, rethrow only caught errors in a guard.
  if (__DEV__) {
    invokeGuardedCallback(null, () => {
      throw error;
    });
    clearCaughtError();
  }
}

const callComponentWillUnmountWithTimer = function (current, instance) {
  instance.props = current.memoizedProps;
  instance.state = current.memoizedState;
  if (
    enableProfilerTimer &&
    enableProfilerCommitHooks &&
    current.mode & ProfileMode
  ) {
    try {
      startLayoutEffectTimer();
      instance.componentWillUnmount();
    } finally {
      recordLayoutEffectDuration(current);
    }
  } else {
    instance.componentWillUnmount();
  }
};

// Capture errors so they don't interrupt mounting.
function safelyCallCommitHookLayoutEffectListMount(
  current: Fiber,
  nearestMountedAncestor: Fiber | null,
) {
  try {
    commitHookEffectListMount(HookLayout, current);
  } catch (error) {
    reportUncaughtErrorInDEV(error);
    captureCommitPhaseError(current, nearestMountedAncestor, error);
  }
}

// Capture errors so they don't interrupt unmounting.
function safelyCallComponentWillUnmount(
  current: Fiber,
  nearestMountedAncestor: Fiber | null,
  instance: any,
) {
  try {
    callComponentWillUnmountWithTimer(current, instance);
  } catch (error) {
    reportUncaughtErrorInDEV(error);
    captureCommitPhaseError(current, nearestMountedAncestor, error);
  }
}

// Capture errors so they don't interrupt mounting.
function safelyCallComponentDidMount(
  current: Fiber,
  nearestMountedAncestor: Fiber | null,
  instance: any,
) {
  try {
    instance.componentDidMount();
  } catch (error) {
    reportUncaughtErrorInDEV(error);
    captureCommitPhaseError(current, nearestMountedAncestor, error);
  }
}

// Capture errors so they don't interrupt mounting.
function safelyAttachRef(current: Fiber, nearestMountedAncestor: Fiber | null) {
  try {
    commitAttachRef(current);
  } catch (error) {
    reportUncaughtErrorInDEV(error);
    captureCommitPhaseError(current, nearestMountedAncestor, error);
  }
}

function safelyDetachRef(current: Fiber, nearestMountedAncestor: Fiber | null) {
  const ref = current.ref;
  if (ref !== null) {
    if (typeof ref === 'function') {
      try {
        if (
          enableProfilerTimer &&
          enableProfilerCommitHooks &&
          current.mode & ProfileMode
        ) {
          try {
            startLayoutEffectTimer();
            ref(null);
          } finally {
            recordLayoutEffectDuration(current);
          }
        } else {
          ref(null);
        }
      } catch (error) {
        reportUncaughtErrorInDEV(error);
        captureCommitPhaseError(current, nearestMountedAncestor, error);
      }
    } else {
      ref.current = null;
    }
  }
}

function safelyCallDestroy(
  current: Fiber,
  nearestMountedAncestor: Fiber | null,
  destroy: () => void,
) {
  try {
    destroy();
  } catch (error) {
    reportUncaughtErrorInDEV(error);
    captureCommitPhaseError(current, nearestMountedAncestor, error);
  }
}

let focusedInstanceHandle: null | Fiber = null;
let shouldFireAfterActiveInstanceBlur: boolean = false;

// before mutation
// 递归调用 getSnapshotBeforeUpdate 函数
export function commitBeforeMutationEffects(
  root: FiberRoot,
  firstChild: Fiber,
) {
  focusedInstanceHandle = prepareForCommit(root.containerInfo);

  nextEffect = firstChild;
  commitBeforeMutationEffects_begin();

  // We no longer need to track the active instance fiber
  const shouldFire = shouldFireAfterActiveInstanceBlur;
  shouldFireAfterActiveInstanceBlur = false;
  focusedInstanceHandle = null;

  return shouldFire;
}

// commit 阶段： before mutation 开始
function commitBeforeMutationEffects_begin() {
  while (nextEffect !== null) {
    const fiber = nextEffect;

    // This phase is only used for beforeActiveInstanceBlur.
    // Let's skip the whole loop if it's off.
    if (enableCreateEventHandleAPI) {
      // TODO: Should wrap this in flags check, too, as optimization
      const deletions = fiber.deletions;
      if (deletions !== null) {
        for (let i = 0;i < deletions.length;i++) {
          const deletion = deletions[i];
          commitBeforeMutationEffectsDeletion(deletion);
        }
      }
    }

    const child = fiber.child;
    if (
      (fiber.subtreeFlags & BeforeMutationMask) !== NoFlags &&
      child !== null
    ) {
      ensureCorrectReturnPointer(child, fiber);
      nextEffect = child;
    } else {
      // 向下找到最后一个没有 Update Snapshot 的节点
      commitBeforeMutationEffects_complete();
    }
  }
}

// commit 阶段： before mutation 完成
function commitBeforeMutationEffects_complete() {
  while (nextEffect !== null) {
    const fiber = nextEffect;
    setCurrentDebugFiberInDEV(fiber);
    try {
      commitBeforeMutationEffectsOnFiber(fiber);
    } catch (error) {
      reportUncaughtErrorInDEV(error);
      captureCommitPhaseError(fiber, fiber.return, error);
    }
    resetCurrentDebugFiberInDEV();

    const sibling = fiber.sibling;
    if (sibling !== null) {
      ensureCorrectReturnPointer(sibling, fiber.return);
      nextEffect = sibling;
      return;
    }

    nextEffect = fiber.return;
  }
}

// commit 阶段： before mutation 具体执行内容
function commitBeforeMutationEffectsOnFiber(finishedWork: Fiber) {
  const current = finishedWork.alternate;
  const flags = finishedWork.flags;

  if (enableCreateEventHandleAPI) {
    if (!shouldFireAfterActiveInstanceBlur && focusedInstanceHandle !== null) {
      // Check to see if the focused element was inside of a hidden (Suspense) subtree.
      // TODO: Move this out of the hot path using a dedicated effect tag.
      if (
        finishedWork.tag === SuspenseComponent &&
        isSuspenseBoundaryBeingHidden(current, finishedWork) &&
        doesFiberContain(finishedWork, focusedInstanceHandle)
      ) {
        shouldFireAfterActiveInstanceBlur = true;
        beforeActiveInstanceBlur(finishedWork);
      }
    }
  }

  // class 组件里的 getSnapshotBeforeUpdate 生命周期
  if ((flags & Snapshot) !== NoFlags) {
    setCurrentDebugFiberInDEV(finishedWork);

    switch (finishedWork.tag) {
      case FunctionComponent:
      case ForwardRef:
      case SimpleMemoComponent: {
        break;
      }
      case ClassComponent: {
        if (current !== null) {
          const prevProps = current.memoizedProps;
          const prevState = current.memoizedState;
          const instance = finishedWork.stateNode;
          // We could update instance props and state here,
          // but instead we rely on them being set during last render.
          // TODO: revisit this when we implement resuming.
          if (__DEV__) {
            if (
              finishedWork.type === finishedWork.elementType &&
              !didWarnAboutReassigningProps
            ) {
              if (instance.props !== finishedWork.memoizedProps) {
                console.error(
                  'Expected %s props to match memoized props before ' +
                  'getSnapshotBeforeUpdate. ' +
                  'This might either be because of a bug in React, or because ' +
                  'a component reassigns its own `this.props`. ' +
                  'Please file an issue.',
                  getComponentNameFromFiber(finishedWork) || 'instance',
                );
              }
              if (instance.state !== finishedWork.memoizedState) {
                console.error(
                  'Expected %s state to match memoized state before ' +
                  'getSnapshotBeforeUpdate. ' +
                  'This might either be because of a bug in React, or because ' +
                  'a component reassigns its own `this.state`. ' +
                  'Please file an issue.',
                  getComponentNameFromFiber(finishedWork) || 'instance',
                );
              }
            }
          }
          const snapshot = instance.getSnapshotBeforeUpdate(
            finishedWork.elementType === finishedWork.type
              ? prevProps
              : resolveDefaultProps(finishedWork.type, prevProps),
            prevState,
          );
          if (__DEV__) {
            const didWarnSet = ((didWarnAboutUndefinedSnapshotBeforeUpdate: any): Set<mixed>);
            if (snapshot === undefined && !didWarnSet.has(finishedWork.type)) {
              didWarnSet.add(finishedWork.type);
              console.error(
                '%s.getSnapshotBeforeUpdate(): A snapshot value (or null) ' +
                'must be returned. You have returned undefined.',
                getComponentNameFromFiber(finishedWork),
              );
            }
          }
          instance.__reactInternalSnapshotBeforeUpdate = snapshot;
        }
        break;
      }
      case HostRoot: {
        if (supportsMutation) {
          const root = finishedWork.stateNode;
          clearContainer(root.containerInfo);
        }
        break;
      }
      case HostComponent:
      case HostText:
      case HostPortal:
      case IncompleteClassComponent:
        // Nothing to do for these component types
        break;
      default: {
        invariant(
          false,
          'This unit of work tag should not have side-effects. This error is ' +
          'likely caused by a bug in React. Please file an issue.',
        );
      }
    }

    resetCurrentDebugFiberInDEV();
  }
}

function commitBeforeMutationEffectsDeletion(deletion: Fiber) {
  if (enableCreateEventHandleAPI) {
    // TODO (effects) It would be nice to avoid calling doesFiberContain()
    // Maybe we can repurpose one of the subtreeFlags positions for this instead?
    // Use it to store which part of the tree the focused instance is in?
    // This assumes we can safely determine that instance during the "render" phase.
    if (doesFiberContain(deletion, ((focusedInstanceHandle: any): Fiber))) {
      shouldFireAfterActiveInstanceBlur = true;
      beforeActiveInstanceBlur(deletion);
    }
  }
}

// 循环执行 hooks 下的 destroy 方法
function commitHookEffectListUnmount(
  flags: HookFlags,
  finishedWork: Fiber,
  nearestMountedAncestor: Fiber | null,
) {
  const updateQueue: FunctionComponentUpdateQueue | null = (finishedWork.updateQueue: any);
  const lastEffect = updateQueue !== null ? updateQueue.lastEffect : null;
  // lastEffect 就是 函数组件上的 effect，存放的是 useEffect/useLayoutEffect里的函数
  // 执行 hooks 的 unmount
  if (lastEffect !== null) {
    const firstEffect = lastEffect.next;
    // 找到第一个 effect
    let effect = firstEffect;
    do {
      // 如果 tag 包含 flags
      if ((effect.tag & flags) === flags) {
        // Unmount
        const destroy = effect.destroy;
        effect.destroy = undefined;
        if (destroy !== undefined) {
          safelyCallDestroy(finishedWork, nearestMountedAncestor, destroy);
        }
      }
      effect = effect.next;
    } while (effect !== firstEffect);
  }
}

// 触发 hook 的 mount, 循环调用 create 方法
function commitHookEffectListMount(tag: number, finishedWork: Fiber) {
  const updateQueue: FunctionComponentUpdateQueue | null = (finishedWork.updateQueue: any);
  const lastEffect = updateQueue !== null ? updateQueue.lastEffect : null;
  if (lastEffect !== null) {
    const firstEffect = lastEffect.next;
    let effect = firstEffect;
    do {
      if ((effect.tag & tag) === tag) {
        // Mount
        const create = effect.create;
        effect.destroy = create();

        if (__DEV__) {
          const destroy = effect.destroy;
          if (destroy !== undefined && typeof destroy !== 'function') {
            let addendum;
            if (destroy === null) {
              addendum =
                ' You returned null. If your effect does not require clean ' +
                'up, return undefined (or nothing).';
            } else if (typeof destroy.then === 'function') {
              addendum =
                '\n\nIt looks like you wrote useEffect(async () => ...) or returned a Promise. ' +
                'Instead, write the async function inside your effect ' +
                'and call it immediately:\n\n' +
                'useEffect(() => {\n' +
                '  async function fetchData() {\n' +
                '    // You can await here\n' +
                '    const response = await MyAPI.getData(someId);\n' +
                '    // ...\n' +
                '  }\n' +
                '  fetchData();\n' +
                `}, [someId]); // Or [] if effect doesn't need props or state\n\n` +
                'Learn more about data fetching with Hooks: https://reactjs.org/link/hooks-data-fetching';
            } else {
              addendum = ' You returned: ' + destroy;
            }
            console.error(
              'An effect function must not return anything besides a function, ' +
              'which is used for clean-up.%s',
              addendum,
            );
          }
        }
      }
      effect = effect.next;
    } while (effect !== firstEffect);
  }
}

export function commitPassiveEffectDurations(
  finishedRoot: FiberRoot,
  finishedWork: Fiber,
): void {
  if (enableProfilerTimer && enableProfilerCommitHooks) {
    // Only Profilers with work in their subtree will have an Update effect scheduled.
    if ((finishedWork.flags & Update) !== NoFlags) {
      switch (finishedWork.tag) {
        case Profiler: {
          const { passiveEffectDuration } = finishedWork.stateNode;
          const { id, onPostCommit } = finishedWork.memoizedProps;

          // This value will still reflect the previous commit phase.
          // It does not get reset until the start of the next commit phase.
          const commitTime = getCommitTime();

          let phase = finishedWork.alternate === null ? 'mount' : 'update';
          if (enableProfilerNestedUpdatePhase) {
            if (isCurrentUpdateNested()) {
              phase = 'nested-update';
            }
          }

          if (typeof onPostCommit === 'function') {
            onPostCommit(id, phase, passiveEffectDuration, commitTime);
          }

          // Bubble times to the next nearest ancestor Profiler.
          // After we process that Profiler, we'll bubble further up.
          let parentFiber = finishedWork.return;
          outer: while (parentFiber !== null) {
            switch (parentFiber.tag) {
              case HostRoot:
                const root = parentFiber.stateNode;
                root.passiveEffectDuration += passiveEffectDuration;
                break outer;
              case Profiler:
                const parentStateNode = parentFiber.stateNode;
                parentStateNode.passiveEffectDuration += passiveEffectDuration;
                break outer;
            }
            parentFiber = parentFiber.return;
          }
          break;
        }
        default:
          break;
      }
    }
  }
}

function commitLayoutEffectOnFiber(
  finishedRoot: FiberRoot,
  current: Fiber | null,
  finishedWork: Fiber,
  committedLanes: Lanes,
): void {
  if ((finishedWork.flags & LayoutMask) !== NoFlags) {
    switch (finishedWork.tag) {
      case FunctionComponent:
      case ForwardRef:
      case SimpleMemoComponent: {
        if (
          !enableSuspenseLayoutEffectSemantics ||
          !offscreenSubtreeWasHidden
        ) {
          // At this point layout effects have already been destroyed (during mutation phase).
          // This is done to prevent sibling component effects from interfering with each other,
          // e.g. a destroy function in one component should never override a ref set
          // by a create function in another component during the same commit.
          if (
            enableProfilerTimer &&
            enableProfilerCommitHooks &&
            finishedWork.mode & ProfileMode
          ) {
            try {
              startLayoutEffectTimer();
              commitHookEffectListMount(
                HookLayout | HookHasEffect,
                finishedWork,
              );
            } finally {
              recordLayoutEffectDuration(finishedWork);
            }
          } else {
            // 在结束的时候，触发 mount 事件
            commitHookEffectListMount(HookLayout | HookHasEffect, finishedWork);
          }
        }
        break;
      }
      case ClassComponent: {
        const instance = finishedWork.stateNode;
        if (finishedWork.flags & Update) {
          if (!offscreenSubtreeWasHidden) {
            if (current === null) {
              // We could update instance props and state here,
              // but instead we rely on them being set during last render.
              // TODO: revisit this when we implement resuming.
              if (__DEV__) {
                if (
                  finishedWork.type === finishedWork.elementType &&
                  !didWarnAboutReassigningProps
                ) {
                  if (instance.props !== finishedWork.memoizedProps) {
                    console.error(
                      'Expected %s props to match memoized props before ' +
                      'componentDidMount. ' +
                      'This might either be because of a bug in React, or because ' +
                      'a component reassigns its own `this.props`. ' +
                      'Please file an issue.',
                      getComponentNameFromFiber(finishedWork) || 'instance',
                    );
                  }
                  if (instance.state !== finishedWork.memoizedState) {
                    console.error(
                      'Expected %s state to match memoized state before ' +
                      'componentDidMount. ' +
                      'This might either be because of a bug in React, or because ' +
                      'a component reassigns its own `this.state`. ' +
                      'Please file an issue.',
                      getComponentNameFromFiber(finishedWork) || 'instance',
                    );
                  }
                }
              }
              if (
                enableProfilerTimer &&
                enableProfilerCommitHooks &&
                finishedWork.mode & ProfileMode
              ) {
                try {
                  startLayoutEffectTimer();
                  instance.componentDidMount();
                } finally {
                  recordLayoutEffectDuration(finishedWork);
                }
              } else {
                instance.componentDidMount();
              }
            } else {
              const prevProps =
                finishedWork.elementType === finishedWork.type
                  ? current.memoizedProps
                  : resolveDefaultProps(
                    finishedWork.type,
                    current.memoizedProps,
                  );
              const prevState = current.memoizedState;
              // We could update instance props and state here,
              // but instead we rely on them being set during last render.
              // TODO: revisit this when we implement resuming.
              if (__DEV__) {
                if (
                  finishedWork.type === finishedWork.elementType &&
                  !didWarnAboutReassigningProps
                ) {
                  if (instance.props !== finishedWork.memoizedProps) {
                    console.error(
                      'Expected %s props to match memoized props before ' +
                      'componentDidUpdate. ' +
                      'This might either be because of a bug in React, or because ' +
                      'a component reassigns its own `this.props`. ' +
                      'Please file an issue.',
                      getComponentNameFromFiber(finishedWork) || 'instance',
                    );
                  }
                  if (instance.state !== finishedWork.memoizedState) {
                    console.error(
                      'Expected %s state to match memoized state before ' +
                      'componentDidUpdate. ' +
                      'This might either be because of a bug in React, or because ' +
                      'a component reassigns its own `this.state`. ' +
                      'Please file an issue.',
                      getComponentNameFromFiber(finishedWork) || 'instance',
                    );
                  }
                }
              }
              if (
                enableProfilerTimer &&
                enableProfilerCommitHooks &&
                finishedWork.mode & ProfileMode
              ) {
                try {
                  startLayoutEffectTimer();
                  instance.componentDidUpdate(
                    prevProps,
                    prevState,
                    instance.__reactInternalSnapshotBeforeUpdate,
                  );
                } finally {
                  recordLayoutEffectDuration(finishedWork);
                }
              } else {
                instance.componentDidUpdate(
                  prevProps,
                  prevState,
                  instance.__reactInternalSnapshotBeforeUpdate,
                );
              }
            }
          }
        }

        // TODO: I think this is now always non-null by the time it reaches the
        // commit phase. Consider removing the type check.
        const updateQueue: UpdateQueue<
          *,
          > | null = (finishedWork.updateQueue: any);
        if (updateQueue !== null) {
          if (__DEV__) {
            if (
              finishedWork.type === finishedWork.elementType &&
              !didWarnAboutReassigningProps
            ) {
              if (instance.props !== finishedWork.memoizedProps) {
                console.error(
                  'Expected %s props to match memoized props before ' +
                  'processing the update queue. ' +
                  'This might either be because of a bug in React, or because ' +
                  'a component reassigns its own `this.props`. ' +
                  'Please file an issue.',
                  getComponentNameFromFiber(finishedWork) || 'instance',
                );
              }
              if (instance.state !== finishedWork.memoizedState) {
                console.error(
                  'Expected %s state to match memoized state before ' +
                  'processing the update queue. ' +
                  'This might either be because of a bug in React, or because ' +
                  'a component reassigns its own `this.state`. ' +
                  'Please file an issue.',
                  getComponentNameFromFiber(finishedWork) || 'instance',
                );
              }
            }
          }
          // We could update instance props and state here,
          // but instead we rely on them being set during last render.
          // TODO: revisit this when we implement resuming.
          // 找到 queue 里面的 effects 里的 callback，并依次执行。
          commitUpdateQueue(finishedWork, updateQueue, instance);
        }
        break;
      }
      case HostRoot: {
        // TODO: I think this is now always non-null by the time it reaches the
        // commit phase. Consider removing the type check.
        const updateQueue: UpdateQueue<
          *,
          > | null = (finishedWork.updateQueue: any);
        if (updateQueue !== null) {
          let instance = null;
          if (finishedWork.child !== null) {
            switch (finishedWork.child.tag) {
              case HostComponent:
                instance = getPublicInstance(finishedWork.child.stateNode);
                break;
              case ClassComponent:
                instance = finishedWork.child.stateNode;
                break;
            }
          }
          commitUpdateQueue(finishedWork, updateQueue, instance);
        }
        break;
      }
      case HostComponent: {
        const instance: Instance = finishedWork.stateNode;

        // Renderers may schedule work to be done after host components are mounted
        // (eg DOM renderer may schedule auto-focus for inputs and form controls).
        // These effects should only be committed when components are first mounted,
        // aka when there is no current/alternate.
        if (current === null && finishedWork.flags & Update) {
          const type = finishedWork.type;
          const props = finishedWork.memoizedProps;
          commitMount(instance, type, props, finishedWork);
        }

        break;
      }
      case HostText: {
        // We have no life-cycles associated with text.
        break;
      }
      case HostPortal: {
        // We have no life-cycles associated with portals.
        break;
      }
      case Profiler: {
        if (enableProfilerTimer) {
          const { onCommit, onRender } = finishedWork.memoizedProps;
          const { effectDuration } = finishedWork.stateNode;

          const commitTime = getCommitTime();

          let phase = current === null ? 'mount' : 'update';
          if (enableProfilerNestedUpdatePhase) {
            if (isCurrentUpdateNested()) {
              phase = 'nested-update';
            }
          }

          if (typeof onRender === 'function') {
            onRender(
              finishedWork.memoizedProps.id,
              phase,
              finishedWork.actualDuration,
              finishedWork.treeBaseDuration,
              finishedWork.actualStartTime,
              commitTime,
            );
          }

          if (enableProfilerCommitHooks) {
            if (typeof onCommit === 'function') {
              onCommit(
                finishedWork.memoizedProps.id,
                phase,
                effectDuration,
                commitTime,
              );
            }

            // Schedule a passive effect for this Profiler to call onPostCommit hooks.
            // This effect should be scheduled even if there is no onPostCommit callback for this Profiler,
            // because the effect is also where times bubble to parent Profilers.
            enqueuePendingPassiveProfilerEffect(finishedWork);

            // Propagate layout effect durations to the next nearest Profiler ancestor.
            // Do not reset these values until the next render so DevTools has a chance to read them first.
            let parentFiber = finishedWork.return;
            outer: while (parentFiber !== null) {
              switch (parentFiber.tag) {
                case HostRoot:
                  const root = parentFiber.stateNode;
                  root.effectDuration += effectDuration;
                  break outer;
                case Profiler:
                  const parentStateNode = parentFiber.stateNode;
                  parentStateNode.effectDuration += effectDuration;
                  break outer;
              }
              parentFiber = parentFiber.return;
            }
          }
        }
        break;
      }
      case SuspenseComponent: {
        commitSuspenseHydrationCallbacks(finishedRoot, finishedWork);
        break;
      }
      case SuspenseListComponent:
      case IncompleteClassComponent:
      case ScopeComponent:
      case OffscreenComponent:
      case LegacyHiddenComponent:
        break;
      default:
        invariant(
          false,
          'This unit of work tag should not have side-effects. This error is ' +
          'likely caused by a bug in React. Please file an issue.',
        );
    }
  }

  if (!enableSuspenseLayoutEffectSemantics || !offscreenSubtreeWasHidden) {
    if (enableScopeAPI) {
      // TODO: This is a temporary solution that allowed us to transition away
      // from React Flare on www.
      if (finishedWork.flags & Ref && finishedWork.tag !== ScopeComponent) {
        commitAttachRef(finishedWork);
      }
    } else {
      if (finishedWork.flags & Ref) {
        commitAttachRef(finishedWork);
      }
    }
  }
}

function reappearLayoutEffectsOnFiber(node: Fiber) {
  // Turn on layout effects in a tree that previously disappeared.
  // TODO (Offscreen) Check: flags & LayoutStatic
  switch (node.tag) {
    case FunctionComponent:
    case ForwardRef:
    case SimpleMemoComponent: {
      if (
        enableProfilerTimer &&
        enableProfilerCommitHooks &&
        node.mode & ProfileMode
      ) {
        try {
          startLayoutEffectTimer();
          safelyCallCommitHookLayoutEffectListMount(node, node.return);
        } finally {
          recordLayoutEffectDuration(node);
        }
      } else {
        safelyCallCommitHookLayoutEffectListMount(node, node.return);
      }
      break;
    }
    case ClassComponent: {
      const instance = node.stateNode;
      if (typeof instance.componentDidMount === 'function') {
        safelyCallComponentDidMount(node, node.return, instance);
      }
      safelyAttachRef(node, node.return);
      break;
    }
    case HostComponent: {
      safelyAttachRef(node, node.return);
      break;
    }
  }
}

// 找到该 fiber 下的第一层的真实节点，
// 根据 isHidden 设置这些节点显示与否。
function hideOrUnhideAllChildren(finishedWork, isHidden) {
  // Only hide or unhide the top-most host nodes.
  let hostSubtreeRoot = null;

  if (supportsMutation) {
    // We only have the top Fiber that was inserted but we need to recurse down its
    // children to find all the terminal nodes.
    let node: Fiber = finishedWork;
    while (true) {
      if (node.tag === HostComponent) {
        if (hostSubtreeRoot === null) {
          hostSubtreeRoot = node;

          const instance = node.stateNode;
          if (isHidden) {
            hideInstance(instance);
          } else {
            unhideInstance(node.stateNode, node.memoizedProps);
          }
        }
      } else if (node.tag === HostText) {
        if (hostSubtreeRoot === null) {
          const instance = node.stateNode;
          if (isHidden) {
            hideTextInstance(instance);
          } else {
            unhideTextInstance(instance, node.memoizedProps);
          }
        }
      } else if (
        (node.tag === OffscreenComponent ||
          node.tag === LegacyHiddenComponent) &&
        (node.memoizedState: OffscreenState) !== null &&
          node !== finishedWork
      ) {
        // Found a nested Offscreen component that is hidden.
        // Don't search any deeper. This tree should remain hidden.
      } else if (node.child !== null) {
        node.child.return = node;
        node = node.child;
        continue;
      }

      if (node === finishedWork) {
        return;
      }
      while (node.sibling === null) {
        if (node.return === null || node.return === finishedWork) {
          return;
        }

        if (hostSubtreeRoot === node) {
          hostSubtreeRoot = null;
        }

        node = node.return;
      }

      if (hostSubtreeRoot === node) {
        hostSubtreeRoot = null;
      }

      node.sibling.return = node.return;
      node = node.sibling;
    }
  }
}

function commitAttachRef(finishedWork: Fiber) {
  const ref = finishedWork.ref;
  if (ref !== null) {
    const instance = finishedWork.stateNode;
    let instanceToUse;
    switch (finishedWork.tag) {
      case HostComponent:
        instanceToUse = getPublicInstance(instance);
        break;
      default:
        instanceToUse = instance;
    }
    // Moved outside to ensure DCE works with this flag
    if (enableScopeAPI && finishedWork.tag === ScopeComponent) {
      instanceToUse = instance;
    }
    if (typeof ref === 'function') {
      if (
        enableProfilerTimer &&
        enableProfilerCommitHooks &&
        finishedWork.mode & ProfileMode
      ) {
        try {
          startLayoutEffectTimer();
          ref(instanceToUse);
        } finally {
          recordLayoutEffectDuration(finishedWork);
        }
      } else {
        ref(instanceToUse);
      }
    } else {
      if (__DEV__) {
        if (!ref.hasOwnProperty('current')) {
          console.error(
            'Unexpected ref object provided for %s. ' +
            'Use either a ref-setter function or React.createRef().',
            getComponentNameFromFiber(finishedWork),
          );
        }
      }

      ref.current = instanceToUse;
    }
  }
}

// 将 ref 置空
function commitDetachRef(current: Fiber) {
  const currentRef = current.ref;
  if (currentRef !== null) {
    if (typeof currentRef === 'function') {
      if (
        enableProfilerTimer &&
        enableProfilerCommitHooks &&
        current.mode & ProfileMode
      ) {
        try {
          startLayoutEffectTimer();
          currentRef(null);
        } finally {
          recordLayoutEffectDuration(current);
        }
      } else {
        currentRef(null);
      }
    } else {
      currentRef.current = null;
    }
  }
}

// User-originating errors (lifecycles and refs) should not interrupt
// deletion, so don't let them throw. Host-originating errors should
// interrupt deletion, so it's okay
// 清除 fiber.ref, 执行 fiber 的卸载方法(useLayoutEffect / componentWillUnmount)
function commitUnmount(
  finishedRoot: FiberRoot,
  current: Fiber,
  nearestMountedAncestor: Fiber,
): void {
  onCommitUnmount(current);

  switch (current.tag) {
    case FunctionComponent:
    case ForwardRef:
    case MemoComponent:
    case SimpleMemoComponent: {
      // 循环执行 hook 里的 destroy 方法
      // 执行 layout 的 destroy，也就是 useLayoutEffect
      const updateQueue: FunctionComponentUpdateQueue | null = (current.updateQueue: any);
      if (updateQueue !== null) {
        const lastEffect = updateQueue.lastEffect;
        if (lastEffect !== null) {
          const firstEffect = lastEffect.next;

          let effect = firstEffect;
          do {
            const { destroy, tag } = effect;
            if (destroy !== undefined) {
              // 执行 layout 的 destroy，也就是 useLayoutEffect
              if ((tag & HookLayout) !== NoHookEffect) {
                if (
                  enableProfilerTimer &&
                  enableProfilerCommitHooks &&
                  current.mode & ProfileMode
                ) {
                  startLayoutEffectTimer();
                  safelyCallDestroy(current, nearestMountedAncestor, destroy);
                  recordLayoutEffectDuration(current);
                } else {
                  safelyCallDestroy(current, nearestMountedAncestor, destroy);
                }
              }
            }
            effect = effect.next;
          } while (effect !== firstEffect);
        }
      }
      return;
    }
    case ClassComponent: {
      // 清除 ref，调用 componentWillUnmount
      safelyDetachRef(current, nearestMountedAncestor);
      const instance = current.stateNode;
      if (typeof instance.componentWillUnmount === 'function') {
        safelyCallComponentWillUnmount(
          current,
          nearestMountedAncestor,
          instance,
        );
      }
      return;
    }
    case HostComponent: {
      // 移除 ref
      safelyDetachRef(current, nearestMountedAncestor);
      return;
    }
    case HostPortal: {
      // TODO: this is recursive.
      // We are also not using this parent because
      // the portal will get pushed immediately.
      if (supportsMutation) {
        unmountHostComponents(finishedRoot, current, nearestMountedAncestor);
      } else if (supportsPersistence) {
        emptyPortalContainer(current);
      }
      return;
    }
    case DehydratedFragment: {
      if (enableSuspenseCallback) {
        const hydrationCallbacks = finishedRoot.hydrationCallbacks;
        if (hydrationCallbacks !== null) {
          const onDeleted = hydrationCallbacks.onDeleted;
          if (onDeleted) {
            onDeleted((current.stateNode: SuspenseInstance));
          }
        }
      }
      return;
    }
    case ScopeComponent: {
      if (enableScopeAPI) {
        safelyDetachRef(current, nearestMountedAncestor);
      }
      return;
    }
  }
}

// 向下递归执卸载方法。(useLayoutEffect / componentWillUnmount)
function commitNestedUnmounts(
  finishedRoot: FiberRoot,
  root: Fiber, // 这里的 root 表示需要卸载的 fiber
  nearestMountedAncestor: Fiber,
): void {
  // While we're inside a removed host node we don't want to call
  // removeChild on the inner nodes because they're removed by the top
  // call anyway. We also want to call componentWillUnmount on all
  // composites before this host node is removed from the tree. Therefore
  // we do an inner loop while we're still inside the host node.
  let node: Fiber = root;
  while (true) {
    commitUnmount(finishedRoot, node, nearestMountedAncestor);
    // Visit children because they may contain more composite or host nodes.
    // Skip portals because commitUnmount() currently visits them recursively.
    if (
      node.child !== null &&
      // If we use mutation we drill down into portals using commitUnmount above.
      // If we don't use mutation we drill down into portals here instead.
      (!supportsMutation || node.tag !== HostPortal)
    ) {
      // 执行 child unmount
      node.child.return = node;
      node = node.child;
      continue;
    }
    if (node === root) {
      return;
    }
    while (node.sibling === null) {
      if (node.return === null || node.return === root) {
        return;
      }
      node = node.return;
    }
    node.sibling.return = node.return;
    node = node.sibling;
  }
}

function detachFiberMutation(fiber: Fiber) {
  // Cut off the return pointer to disconnect it from the tree.
  // This enables us to detect and warn against state updates on an unmounted component.
  // It also prevents events from bubbling from within disconnected components.
  //
  // Ideally, we should also clear the child pointer of the parent alternate to let this
  // get GC:ed but we don't know which for sure which parent is the current
  // one so we'll settle for GC:ing the subtree of this child.
  // This child itself will be GC:ed when the parent updates the next time.
  //
  // Note that we can't clear child or sibling pointers yet.
  // They're needed for passive effects and for findDOMNode.
  // We defer those fields, and all other cleanup, to the passive phase (see detachFiberAfterEffects).
  //
  // Don't reset the alternate yet, either. We need that so we can detach the
  // alternate's fields in the passive phase. Clearing the return pointer is
  // sufficient for findDOMNode semantics.
  const alternate = fiber.alternate;
  if (alternate !== null) {
    alternate.return = null;
  }
  fiber.return = null;
}

// 将 fiber 内容置空
function detachFiberAfterEffects(fiber: Fiber) {
  const alternate = fiber.alternate;
  if (alternate !== null) {
    fiber.alternate = null;
    detachFiberAfterEffects(alternate);
  }

  // Note: Defensively using negation instead of < in case
  // `deletedTreeCleanUpLevel` is undefined.
  if (!(deletedTreeCleanUpLevel >= 2)) {
    // This is the default branch (level 0).
    fiber.child = null;
    fiber.deletions = null;
    fiber.dependencies = null;
    fiber.memoizedProps = null;
    fiber.memoizedState = null;
    fiber.pendingProps = null;
    fiber.sibling = null;
    fiber.stateNode = null;
    fiber.updateQueue = null;

    if (__DEV__) {
      fiber._debugOwner = null;
    }
  } else {
    // Clear cyclical Fiber fields. This level alone is designed to roughly
    // approximate the planned Fiber refactor. In that world, `setState` will be
    // bound to a special "instance" object instead of a Fiber. The Instance
    // object will not have any of these fields. It will only be connected to
    // the fiber tree via a single link at the root. So if this level alone is
    // sufficient to fix memory issues, that bodes well for our plans.
    fiber.child = null;
    fiber.deletions = null;
    fiber.sibling = null;

    // The `stateNode` is cyclical because on host nodes it points to the host
    // tree, which has its own pointers to children, parents, and siblings.
    // The other host nodes also point back to fibers, so we should detach that
    // one, too.
    if (fiber.tag === HostComponent) {
      const hostInstance: Instance = fiber.stateNode;
      if (hostInstance !== null) {
        detachDeletedInstance(hostInstance);
      }
    }
    fiber.stateNode = null;

    // I'm intentionally not clearing the `return` field in this level. We
    // already disconnect the `return` pointer at the root of the deleted
    // subtree (in `detachFiberMutation`). Besides, `return` by itself is not
    // cyclical — it's only cyclical when combined with `child`, `sibling`, and
    // `alternate`. But we'll clear it in the next level anyway, just in case.

    if (__DEV__) {
      fiber._debugOwner = null;
    }

    if (deletedTreeCleanUpLevel >= 3) {
      // Theoretically, nothing in here should be necessary, because we already
      // disconnected the fiber from the tree. So even if something leaks this
      // particular fiber, it won't leak anything else
      //
      // The purpose of this branch is to be super aggressive so we can measure
      // if there's any difference in memory impact. If there is, that could
      // indicate a React leak we don't know about.
      fiber.return = null;
      fiber.dependencies = null;
      fiber.memoizedProps = null;
      fiber.memoizedState = null;
      fiber.pendingProps = null;
      fiber.stateNode = null;
      // TODO: Move to `commitPassiveUnmountInsideDeletedTreeOnFiber` instead.
      fiber.updateQueue = null;
    }
  }
}

function emptyPortalContainer(current: Fiber) {
  if (!supportsPersistence) {
    return;
  }

  const portal: {
    containerInfo: Container,
    pendingChildren: ChildSet,
    ...
} = current.stateNode;
const { containerInfo } = portal;
const emptyChildSet = createContainerChildSet(containerInfo);
replaceContainerChildren(containerInfo, emptyChildSet);
}

function commitContainer(finishedWork: Fiber) {
  if (!supportsPersistence) {
    return;
  }

  switch (finishedWork.tag) {
    case ClassComponent:
    case HostComponent:
    case HostText: {
      return;
    }
    case HostRoot:
    case HostPortal: {
      const portalOrRoot: {
        containerInfo: Container,
        pendingChildren: ChildSet,
        ...
    } = finishedWork.stateNode;
      const { containerInfo, pendingChildren } = portalOrRoot;
      replaceContainerChildren(containerInfo, pendingChildren);
      return;
  }
}
invariant(
  false,
  'This unit of work tag should not have side-effects. This error is ' +
  'likely caused by a bug in React. Please file an issue.',
);
}

// 找到第一个 host parent fiber
function getHostParentFiber(fiber: Fiber): Fiber {
  let parent = fiber.return;
  while (parent !== null) {
    if (isHostParent(parent)) {
      return parent;
    }
    parent = parent.return;
  }
  invariant(
    false,
    'Expected to find a host parent. This error is likely caused by a bug ' +
    'in React. Please file an issue.',
  );
}

// 能为真实节点的 fiber
function isHostParent(fiber: Fiber): boolean {
  return (
    fiber.tag === HostComponent ||
    fiber.tag === HostRoot ||
    fiber.tag === HostPortal
  );
}

// 寻找 sibling
function getHostSibling(fiber: Fiber): ?Instance {
  // We're going to search forward into the tree until we find a sibling host
  // node. Unfortunately, if multiple insertions are done in a row we have to
  // search past them. This leads to exponential search for the next sibling.
  // TODO: Find a more efficient way to do this.
  let node: Fiber = fiber;
  siblings: while (true) {
    // If we didn't find anything, let's try the next sibling.
    // 向上查找，如果一直都没有 sibling 返回 null
    while (node.sibling === null) {
      if (node.return === null || isHostParent(node.return)) {
        // If we pop out of the root or hit the parent the fiber we are the
        // last sibling.
        return null;
      }
      node = node.return;
    }
    node.sibling.return = node.return;
    // 获取 sibling
    node = node.sibling;
    // 向下查找，查找合适的主节点
    while (
      node.tag !== HostComponent &&
      node.tag !== HostText &&
      node.tag !== DehydratedFragment
    ) {
      // If it is not host node and, we might have a host node inside it.
      // Try to search down until we find one.
      if (node.flags & Placement) {
        // If we don't have a child, try the siblings instead.
        continue siblings;
      }
      // If we don't have a child, try the siblings instead.
      // We also skip portals because they are not part of this host tree.
      if (node.child === null || node.tag === HostPortal) {
        continue siblings;
      } else {
        node.child.return = node;
        node = node.child;
      }
    }
    // Check if this host node is stable or about to be placed.
    // 如果找到的主节点没有更新，则返回该节点。
    if (!(node.flags & Placement)) {
      // Found it!
      return node.stateNode;
    }
  }
}

// 提交 placement
function commitPlacement(finishedWork: Fiber): void {
  if (!supportsMutation) {
    return;
  }

  // Recursively insert all host nodes into the parent.
  // 这里的 finishedWork 算是偏向于根的fiber
  const parentFiber = getHostParentFiber(finishedWork);

  // Note: these two variables *must* always be updated together.
  let parent;
  let isContainer;
  const parentStateNode = parentFiber.stateNode;
  // 找到真实父节点
  switch (parentFiber.tag) {
    case HostComponent:
      parent = parentStateNode;
      isContainer = false;
      break;
    case HostRoot:
      // 注意这里是添加到根节点上去了。
      parent = parentStateNode.containerInfo;
      isContainer = true;
      break;
    case HostPortal:
      // 注意这里是添加到根节点上去了。
      parent = parentStateNode.containerInfo;
      isContainer = true;
      break;
    // eslint-disable-next-line-no-fallthrough
    default:
      invariant(
        false,
        'Invalid host parent fiber. This error is likely caused by a bug ' +
        'in React. Please file an issue.',
      );
  }
  if (parentFiber.flags & ContentReset) {
    // Reset the text content of the parent before doing any insertions
    resetTextContent(parent);
    // Clear ContentReset from the effect tag
    parentFiber.flags &= ~ContentReset;
  }

  // 找到后一个兄弟结点
  // 由于fiber里会存在一些非渲染的结构，所以这个查找过程还比较复杂。
  const before = getHostSibling(finishedWork);
  // We only have the top Fiber that was inserted but we need to recurse down its
  // children to find all the terminal nodes.
  if (isContainer) {
    insertOrAppendPlacementNodeIntoContainer(finishedWork, before, parent);
  } else {
    insertOrAppendPlacementNode(finishedWork, before, parent);
  }
}

// 插入节点
function insertOrAppendPlacementNodeIntoContainer(
  node: Fiber,
  before: ?Instance,
  parent: Container,
): void {
  const { tag } = node;
  const isHost = tag === HostComponent || tag === HostText;
  if (isHost) {
    // 如果是主节点，插入
    const stateNode = node.stateNode;
    if (before) {
      insertInContainerBefore(parent, stateNode, before);
    } else {
      appendChildToContainer(parent, stateNode);
    }
  } else if (tag === HostPortal) {
    // If the insertion itself is a portal, then we don't want to traverse
    // down its children. Instead, we'll get insertions from each child in
    // the portal directly.
  } else {
    // 将结点均插入
    const child = node.child;
    if (child !== null) {
      insertOrAppendPlacementNodeIntoContainer(child, before, parent);
      let sibling = child.sibling;
      while (sibling !== null) {
        insertOrAppendPlacementNodeIntoContainer(sibling, before, parent);
        sibling = sibling.sibling;
      }
    }
  }
}

// 插入节点
function insertOrAppendPlacementNode(
  node: Fiber,
  before: ?Instance,
  parent: Instance,
): void {
  const { tag } = node;
  const isHost = tag === HostComponent || tag === HostText;
  if (isHost) {
    const stateNode = node.stateNode;
    if (before) {
      insertBefore(parent, stateNode, before);
    } else {
      appendChild(parent, stateNode);
    }
  } else if (tag === HostPortal) {
    // If the insertion itself is a portal, then we don't want to traverse
    // down its children. Instead, we'll get insertions from each child in
    // the portal directly.
  } else {
    const child = node.child;
    if (child !== null) {
      insertOrAppendPlacementNode(child, before, parent);
      let sibling = child.sibling;
      while (sibling !== null) {
        insertOrAppendPlacementNode(sibling, before, parent);
        sibling = sibling.sibling;
      }
    }
  }
}

// 向下递归触发事件，并移除真实节点
function unmountHostComponents(
  finishedRoot: FiberRoot,
  current: Fiber,
  nearestMountedAncestor: Fiber,
): void {
  // We only have the top Fiber that was deleted but we need to recurse down its
  // children to find all the terminal nodes.
  let node: Fiber = current;

  // Each iteration, currentParent is populated with node's host parent if not
  // currentParentIsValid.
  let currentParentIsValid = false;

  // Note: these two variables *must* always be updated together.
  let currentParent;
  let currentParentIsContainer;

  while (true) {
    // 找到合法的 parentNode，为真实节点。
    // 并标记是否为 rootContainer
    if (!currentParentIsValid) {
      let parent = node.return;
      findParent: while (true) {
        invariant(
          parent !== null,
          'Expected to find a host parent. This error is likely caused by ' +
          'a bug in React. Please file an issue.',
        );
        const parentStateNode = parent.stateNode;
        switch (parent.tag) {
          case HostComponent:
            currentParent = parentStateNode;
            currentParentIsContainer = false;
            break findParent;
          case HostRoot:
            currentParent = parentStateNode.containerInfo;
            currentParentIsContainer = true;
            break findParent;
          case HostPortal:
            currentParent = parentStateNode.containerInfo;
            currentParentIsContainer = true;
            break findParent;
        }
        parent = parent.return;
      }
      currentParentIsValid = true;
    }

    // 触发事件，并移除子节点
    if (node.tag === HostComponent || node.tag === HostText) {
      // 1. 递归触发卸载事件。(useLayoutEffect/componentWillUnmount)
      commitNestedUnmounts(finishedRoot, node, nearestMountedAncestor);
      // After all the children have unmounted, it is now safe to remove the
      // node from the tree.
      // 2. 触发完事件，就需要移除真实节点
      if (currentParentIsContainer) {
        removeChildFromContainer(
          ((currentParent: any): Container),
          (node.stateNode: Instance | TextInstance),
        );
      } else {
        // 移除真实节点
        removeChild(
          ((currentParent: any): Instance),
          (node.stateNode: Instance | TextInstance),
        );
      }
      // Don't visit children because we already visited them.
    } else if (
      enableSuspenseServerRenderer &&
      node.tag === DehydratedFragment
    ) {
      if (enableSuspenseCallback) {
        const hydrationCallbacks = finishedRoot.hydrationCallbacks;
        if (hydrationCallbacks !== null) {
          const onDeleted = hydrationCallbacks.onDeleted;
          if (onDeleted) {
            onDeleted((node.stateNode: SuspenseInstance));
          }
        }
      }

      // Delete the dehydrated suspense boundary and all of its content.
      if (currentParentIsContainer) {
        clearSuspenseBoundaryFromContainer(
          ((currentParent: any): Container),
          (node.stateNode: SuspenseInstance),
        );
      } else {
        clearSuspenseBoundary(
          ((currentParent: any): Instance),
          (node.stateNode: SuspenseInstance),
        );
      }
    } else if (node.tag === HostPortal) {
      if (node.child !== null) {
        // When we go into a portal, it becomes the parent to remove from.
        // We will reassign it back when we pop the portal on the way up.
        // 如果当前是 Portal ，且具有child
        currentParent = node.stateNode.containerInfo;
        currentParentIsContainer = true;
        // Visit children because portals might contain host components.
        // 处理它的孩子节点
        node.child.return = node;
        node = node.child;
        continue;
      }
    } else {
      // 其他节点，由于不存在真实节点，所以不需要移除真实节点
      // 如果有事件，触发节点 unmount 事件，然后寻找下一个子节点
      commitUnmount(finishedRoot, node, nearestMountedAncestor);
      // Visit children because we may find more host components below.
      if (node.child !== null) {
        node.child.return = node;
        node = node.child;
        continue;
      }
    }

    // node === current 的时候终止递归。
    if (node === current) {
      return;
    }
    while (node.sibling === null) {
      // 
      if (node.return === null || node.return === current) {
        return;
      }
      // sibling 不存在 =》 父亲
      node = node.return;
      if (node.tag === HostPortal) {
        // When we go out of the portal, we need to restore the parent.
        // Since we don't keep a stack of them, we will search for it.
        currentParentIsValid = false;
      }
    }
    // 如果 sibling 存在 => sibling
    node.sibling.return = node.return;
    node = node.sibling;
  }
}

// 提交删除
function commitDeletion(
  finishedRoot: FiberRoot,
  current: Fiber,
  nearestMountedAncestor: Fiber, // 最近的祖先
): void {
  if (supportsMutation) {
    // Recursively delete all host nodes from the parent.
    // Detach refs and call componentWillUnmount() on the whole subtree.
    unmountHostComponents(finishedRoot, current, nearestMountedAncestor);
  } else {
    // Detach refs and call componentWillUnmount() on the whole subtree.
    commitNestedUnmounts(finishedRoot, current, nearestMountedAncestor);
  }

  detachFiberMutation(current);
}

// 主要工作是 更新了属性
function commitWork(current: Fiber | null, finishedWork: Fiber): void {
  if (!supportsMutation) {
    switch (finishedWork.tag) {
      case FunctionComponent:
      case ForwardRef:
      case MemoComponent:
      case SimpleMemoComponent: {
        // Layout effects are destroyed during the mutation phase so that all
        // destroy functions for all fibers are called before any create functions.
        // This prevents sibling component effects from interfering with each other,
        // e.g. a destroy function in one component should never override a ref set
        // by a create function in another component during the same commit.
        // TODO: Check if we're inside an Offscreen subtree that disappeared
        // during this commit. If so, we would have already unmounted its
        // layout hooks. (However, since we null out the `destroy` function
        // right before calling it, the behavior is already correct, so this
        // would mostly be for modeling purposes.)
        if (
          enableProfilerTimer &&
          enableProfilerCommitHooks &&
          finishedWork.mode & ProfileMode
        ) {
          try {
            startLayoutEffectTimer();
            commitHookEffectListUnmount(
              HookLayout | HookHasEffect,
              finishedWork,
              finishedWork.return,
            );
          } finally {
            recordLayoutEffectDuration(finishedWork);
          }
        } else {
          commitHookEffectListUnmount(
            HookLayout | HookHasEffect,
            finishedWork,
            finishedWork.return,
          );
        }
        return;
      }
      case Profiler: {
        return;
      }
      case SuspenseComponent: {
        commitSuspenseCallback(finishedWork);
        attachSuspenseRetryListeners(finishedWork);
        return;
      }
      case SuspenseListComponent: {
        attachSuspenseRetryListeners(finishedWork);
        return;
      }
      case HostRoot: {
        if (supportsHydration) {
          const root: FiberRoot = finishedWork.stateNode;
          if (root.hydrate) {
            // We've just hydrated. No need to hydrate again.
            root.hydrate = false;
            commitHydratedContainer(root.containerInfo);
          }
        }
        break;
      }
      case OffscreenComponent:
      case LegacyHiddenComponent: {
        return;
      }
    }

    commitContainer(finishedWork);
    return;
  }

  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case MemoComponent:
    case SimpleMemoComponent: {
      // Layout effects are destroyed during the mutation phase so that all
      // destroy functions for all fibers are called before any create functions.
      // This prevents sibling component effects from interfering with each other,
      // e.g. a destroy function in one component should never override a ref set
      // by a create function in another component during the same commit.
      if (
        enableProfilerTimer &&
        enableProfilerCommitHooks &&
        finishedWork.mode & ProfileMode
      ) {
        try {
          startLayoutEffectTimer();
          commitHookEffectListUnmount(
            HookLayout | HookHasEffect,
            finishedWork,
            finishedWork.return,
          );
        } finally {
          recordLayoutEffectDuration(finishedWork);
        }
      } else {
        // 触发了 useLayoutEffect 的 umount
        // todo 为什么要在更新的时候触发这个呢？
        commitHookEffectListUnmount(
          HookLayout | HookHasEffect,
          finishedWork,
          finishedWork.return,
        );
      }
      return;
    }
    case ClassComponent: {
      return;
    }
    case HostComponent: {
      const instance: Instance = finishedWork.stateNode;
      if (instance != null) {
        // Commit the work prepared earlier.
        const newProps = finishedWork.memoizedProps;
        // For hydration we reuse the update path but we treat the oldProps
        // as the newProps. The updatePayload will contain the real change in
        // this case.
        const oldProps = current !== null ? current.memoizedProps : newProps;
        const type = finishedWork.type;
        // TODO: Type the updateQueue to be specific to host components.
        const updatePayload: null | UpdatePayload = (finishedWork.updateQueue: any);
        // 如果有属性被更新了
        finishedWork.updateQueue = null;
        if (updatePayload !== null) {
          // 更新真实节点的属性
          commitUpdate(
            instance,
            updatePayload,
            type,
            oldProps,
            newProps,
            finishedWork,
          );
        }
      }
      return;
    }
    case HostText: {
      invariant(
        finishedWork.stateNode !== null,
        'This should have a text node initialized. This error is likely ' +
        'caused by a bug in React. Please file an issue.',
      );
      const textInstance: TextInstance = finishedWork.stateNode;
      const newText: string = finishedWork.memoizedProps;
      // For hydration we reuse the update path but we treat the oldProps
      // as the newProps. The updatePayload will contain the real change in
      // this case.
      const oldText: string =
        current !== null ? current.memoizedProps : newText;
      commitTextUpdate(textInstance, oldText, newText);
      return;
    }
    case HostRoot: {
      if (supportsHydration) {
        const root: FiberRoot = finishedWork.stateNode;
        if (root.hydrate) {
          // We've just hydrated. No need to hydrate again.
          root.hydrate = false;
          commitHydratedContainer(root.containerInfo);
        }
      }
      return;
    }
    case Profiler: {
      return;
    }
    case SuspenseComponent: {
      commitSuspenseCallback(finishedWork);
      attachSuspenseRetryListeners(finishedWork);
      return;
    }
    case SuspenseListComponent: {
      attachSuspenseRetryListeners(finishedWork);
      return;
    }
    case IncompleteClassComponent: {
      return;
    }
    case ScopeComponent: {
      if (enableScopeAPI) {
        const scopeInstance = finishedWork.stateNode;
        prepareScopeUpdate(scopeInstance, finishedWork);
        return;
      }
      break;
    }
  }
  invariant(
    false,
    'This unit of work tag should not have side-effects. This error is ' +
    'likely caused by a bug in React. Please file an issue.',
  );
}

function commitSuspenseCallback(finishedWork: Fiber) {
  // TODO: Move this to passive phase
  const newState: SuspenseState | null = finishedWork.memoizedState;
  if (enableSuspenseCallback && newState !== null) {
    const suspenseCallback = finishedWork.memoizedProps.suspenseCallback;
    if (typeof suspenseCallback === 'function') {
      const wakeables: Set<Wakeable> | null = (finishedWork.updateQueue: any);
      if (wakeables !== null) {
        suspenseCallback(new Set(wakeables));
      }
    } else if (__DEV__) {
      if (suspenseCallback !== undefined) {
        console.error('Unexpected type for suspenseCallback.');
      }
    }
  }
}

function commitSuspenseHydrationCallbacks(
  finishedRoot: FiberRoot,
  finishedWork: Fiber,
) {
  if (!supportsHydration) {
    return;
  }
  const newState: SuspenseState | null = finishedWork.memoizedState;
  if (newState === null) {
    const current = finishedWork.alternate;
    if (current !== null) {
      const prevState: SuspenseState | null = current.memoizedState;
      if (prevState !== null) {
        const suspenseInstance = prevState.dehydrated;
        if (suspenseInstance !== null) {
          commitHydratedSuspenseInstance(suspenseInstance);
          if (enableSuspenseCallback) {
            const hydrationCallbacks = finishedRoot.hydrationCallbacks;
            if (hydrationCallbacks !== null) {
              const onHydrated = hydrationCallbacks.onHydrated;
              if (onHydrated) {
                onHydrated(suspenseInstance);
              }
            }
          }
        }
      }
    }
  }
}

function attachSuspenseRetryListeners(finishedWork: Fiber) {
  // If this boundary just timed out, then it will have a set of wakeables.
  // For each wakeable, attach a listener so that when it resolves, React
  // attempts to re-render the boundary in the primary (pre-timeout) state.
  const wakeables: Set<Wakeable> | null = (finishedWork.updateQueue: any);
  if (wakeables !== null) {
    finishedWork.updateQueue = null;
    let retryCache = finishedWork.stateNode;
    if (retryCache === null) {
      retryCache = finishedWork.stateNode = new PossiblyWeakSet();
    }
    wakeables.forEach(wakeable => {
      // Memoize using the boundary fiber to prevent redundant listeners.
      const retry = resolveRetryWakeable.bind(null, finishedWork, wakeable);
      if (!retryCache.has(wakeable)) {
        retryCache.add(wakeable);

        if (enableUpdaterTracking) {
          if (isDevToolsPresent) {
            if (inProgressLanes !== null && inProgressRoot !== null) {
              // If we have pending work still, associate the original updaters with it.
              restorePendingUpdaters(inProgressRoot, inProgressLanes);
            } else {
              throw Error(
                'Expected finished root and lanes to be set. This is a bug in React.',
              );
            }
          }
        }

        wakeable.then(retry, retry);
      }
    });
  }
}

// This function detects when a Suspense boundary goes from visible to hidden.
// It returns false if the boundary is already hidden.
// TODO: Use an effect tag.
export function isSuspenseBoundaryBeingHidden(
  current: Fiber | null,
  finishedWork: Fiber,
): boolean {
  if (current !== null) {
    const oldState: SuspenseState | null = current.memoizedState;
    if (oldState === null || oldState.dehydrated !== null) {
      const newState: SuspenseState | null = finishedWork.memoizedState;
      return newState !== null && newState.dehydrated === null;
    }
  }
  return false;
}

function commitResetTextContent(current: Fiber) {
  if (!supportsMutation) {
    return;
  }
  resetTextContent(current.stateNode);
}

// commit 阶段：mutation
export function commitMutationEffects(
  root: FiberRoot,
  firstChild: Fiber,
  committedLanes: Lanes,
) {
  inProgressLanes = committedLanes;
  inProgressRoot = root;
  nextEffect = firstChild;

  commitMutationEffects_begin(root);

  inProgressLanes = null;
  inProgressRoot = null;
}

// commit 阶段：mutation 开始
function commitMutationEffects_begin(root: FiberRoot) {
  while (nextEffect !== null) {
    const fiber = nextEffect;

    // TODO: Should wrap this in flags check, too, as optimization

    // 这些 deletions 在 beginWork 的时候添加的，
    // 在 flushPassiveEffect 的时候有调用
    // 为要删除的子 fiber 的数组

    // 由于当前节点已经被复用了，那么需要删除标记为删除的节点
    // 这里的删除只针对 真实节点。
    const deletions = fiber.deletions;
    if (deletions !== null) {
      for (let i = 0;i < deletions.length;i++) {
        const childToDelete = deletions[i];
        try {
          commitDeletion(root, childToDelete, fiber);
        } catch (error) {
          reportUncaughtErrorInDEV(error);
          captureCommitPhaseError(childToDelete, fiber, error);
        }
      }
    }

    const child = fiber.child;
    // 找到有变动的 child
    if ((fiber.subtreeFlags & MutationMask) !== NoFlags && child !== null) {
      ensureCorrectReturnPointer(child, fiber);
      nextEffect = child;
    } else {
      // 直到找到没有变动的 child 时，nextEffect 为这个child
      commitMutationEffects_complete(root);
    }
  }
}

// commit 阶段：mutation 完成
function commitMutationEffects_complete(root: FiberRoot) {
  // 依次向上递归进行 commit
  while (nextEffect !== null) {
    const fiber = nextEffect;
    setCurrentDebugFiberInDEV(fiber);
    try {
      commitMutationEffectsOnFiber(fiber, root);
    } catch (error) {
      reportUncaughtErrorInDEV(error);
      captureCommitPhaseError(fiber, fiber.return, error);
    }
    resetCurrentDebugFiberInDEV();

    const sibling = fiber.sibling;
    if (sibling !== null) {
      ensureCorrectReturnPointer(sibling, fiber.return);
      nextEffect = sibling;
      return;
    }

    nextEffect = fiber.return;
  }
}

// commit 阶段：mutation 具体执行
// 根据标签不同的做不同的处理
// todo 
function commitMutationEffectsOnFiber(finishedWork: Fiber, root: FiberRoot) {
  // TODO: The factoring of this phase could probably be improved. Consider
  // switching on the type of work before checking the flags. That's what
  // we do in all the other phases. I think this one is only different
  // because of the shared reconciliation logic below.
  const flags = finishedWork.flags;

  if (flags & ContentReset) {
    // 将 text 内容置为 空
    commitResetTextContent(finishedWork);
  }

  if (flags & Ref) {
    const current = finishedWork.alternate;
    // 如果有 ref，那么将之前的 ref 置空，切断引用
    if (current !== null) {
      commitDetachRef(current);
    }
    if (enableScopeAPI) {
      // TODO: This is a temporary solution that allowed us to transition away
      // from React Flare on www.
      if (finishedWork.tag === ScopeComponent) {
        commitAttachRef(finishedWork);
      }
    }
  }

  // suspense offscreen 中的状态如果为 visibility
  // todo
  if (flags & Visibility) {
    switch (finishedWork.tag) {
      case SuspenseComponent: {
        const newState: OffscreenState | null = finishedWork.memoizedState;
        const isHidden = newState !== null;
        // isHidden 表示 primary hidden 此时需要 fallback 显示
        if (isHidden) {
          const current = finishedWork.alternate;
          // current 存在且 state 存在，表示之前 fallback 存在
          const wasHidden = current !== null && current.memoizedState !== null;
          if (!wasHidden) {
            // TODO: Move to passive phase
            // 如果之前 fallback 不存在，那么进行显示
            markCommitTimeOfFallback();
          }
        }
        break;
      }
      // 例如 suspense 里面的 primary children
      case OffscreenComponent: {
        const newState: OffscreenState | null = finishedWork.memoizedState;
        // primary children 是否hidden
        const isHidden = newState !== null;
        const current = finishedWork.alternate;
        const wasHidden = current !== null && current.memoizedState !== null;
        const offscreenBoundary: Fiber = finishedWork;

        if (supportsMutation) {
          // TODO: This needs to run whenever there's an insertion or update
          // inside a hidden Offscreen tree.
          // 控制节点显示与否
          hideOrUnhideAllChildren(offscreenBoundary, isHidden);
        }

        if (enableSuspenseLayoutEffectSemantics) {
          // 转换过程 primary children => fallback children
          // 现在需要显示
          if (isHidden) {
            // 之前没有被显示
            if (!wasHidden) {
              if ((offscreenBoundary.mode & ConcurrentMode) !== NoMode) {
                nextEffect = offscreenBoundary;
                let offscreenChild = offscreenBoundary.child;
                // offscreen 下一层的 节点进行 disappear layout effect
                // 隐藏的过程相当于 卸载，触发子节点相应的事件
                while (offscreenChild !== null) {
                  nextEffect = offscreenChild;
                  disappearLayoutEffects_begin(offscreenChild);
                  offscreenChild = offscreenChild.sibling;
                }
              }
            }
          } else {
            if (wasHidden) {
              // TODO: Move re-appear call here for symmetry?
            }
          }
          break;
        }
      }
    }
  }

  // The following switch statement is only concerned about placement,
  // updates, and deletions. To avoid needing to add a case for every possible
  // bitmap value, we remove the secondary effects from the effect tag and
  // switch on that value.
  const primaryFlags = flags & (Placement | Update | Hydrating);
  outer: switch (primaryFlags) {
    case Placement: {
      // 找到父元素和兄弟元素，然后插入节点即可
      commitPlacement(finishedWork);
      // Clear the "placement" from effect tag so that we know that this is
      // inserted, before any life-cycles like componentDidMount gets called.
      // TODO: findDOMNode doesn't rely on this any more but isMounted does
      // and isMounted is deprecated anyway so we should be able to kill this.
      finishedWork.flags &= ~Placement;
      break;
    }
    case PlacementAndUpdate: {
      // Placement
      commitPlacement(finishedWork);
      // Clear the "placement" from effect tag so that we know that this is
      // inserted, before any life-cycles like componentDidMount gets called.
      finishedWork.flags &= ~Placement;

      // Update
      const current = finishedWork.alternate;
      commitWork(current, finishedWork);
      break;
    }
    case Hydrating: {
      finishedWork.flags &= ~Hydrating;
      break;
    }
    case HydratingAndUpdate: {
      finishedWork.flags &= ~Hydrating;

      // Update
      const current = finishedWork.alternate;
      commitWork(current, finishedWork);
      break;
    }
    case Update: {
      const current = finishedWork.alternate;
      // 更新属性
      commitWork(current, finishedWork);
      break;
    }
  }
}

// commit 阶段 layout
export function commitLayoutEffects(
  finishedWork: Fiber,
  root: FiberRoot,
  committedLanes: Lanes,
): void {
  inProgressLanes = committedLanes;
  inProgressRoot = root;
  nextEffect = finishedWork;

  commitLayoutEffects_begin(finishedWork, root, committedLanes);

  inProgressLanes = null;
  inProgressRoot = null;
}

function commitLayoutEffects_begin(
  subtreeRoot: Fiber,
  root: FiberRoot,
  committedLanes: Lanes,
) {
  // Suspense layout effects semantics don't change for legacy roots.
  const isModernRoot = (subtreeRoot.mode & ConcurrentMode) !== NoMode;

  while (nextEffect !== null) {
    const fiber = nextEffect;
    const firstChild = fiber.child;

    if (
      enableSuspenseLayoutEffectSemantics &&
      fiber.tag === OffscreenComponent &&
      isModernRoot
    ) {
      // Keep track of the current Offscreen stack's state.
      const isHidden = fiber.memoizedState !== null;
      const newOffscreenSubtreeIsHidden = isHidden || offscreenSubtreeIsHidden;
      if (newOffscreenSubtreeIsHidden) {
        // The Offscreen tree is hidden. Skip over its layout effects.
        commitLayoutMountEffects_complete(subtreeRoot, root, committedLanes);
        continue;
      } else {
        // TODO (Offscreen) Also check: subtreeFlags & LayoutMask
        const current = fiber.alternate;
        const wasHidden = current !== null && current.memoizedState !== null;
        const newOffscreenSubtreeWasHidden =
          wasHidden || offscreenSubtreeWasHidden;
        const prevOffscreenSubtreeIsHidden = offscreenSubtreeIsHidden;
        const prevOffscreenSubtreeWasHidden = offscreenSubtreeWasHidden;

        // Traverse the Offscreen subtree with the current Offscreen as the root.
        offscreenSubtreeIsHidden = newOffscreenSubtreeIsHidden;
        offscreenSubtreeWasHidden = newOffscreenSubtreeWasHidden;

        if (offscreenSubtreeWasHidden && !prevOffscreenSubtreeWasHidden) {
          // This is the root of a reappearing boundary. Turn its layout effects
          // back on.
          nextEffect = fiber;
          reappearLayoutEffects_begin(fiber);
        }

        let child = firstChild;
        while (child !== null) {
          nextEffect = child;
          commitLayoutEffects_begin(
            child, // New root; bubble back up to here and stop.
            root,
            committedLanes,
          );
          child = child.sibling;
        }

        // Restore Offscreen state and resume in our-progress traversal.
        nextEffect = fiber;
        offscreenSubtreeIsHidden = prevOffscreenSubtreeIsHidden;
        offscreenSubtreeWasHidden = prevOffscreenSubtreeWasHidden;
        commitLayoutMountEffects_complete(subtreeRoot, root, committedLanes);

        continue;
      }
    }

    if ((fiber.subtreeFlags & LayoutMask) !== NoFlags && firstChild !== null) {
      ensureCorrectReturnPointer(firstChild, fiber);
      nextEffect = firstChild;
    } else {
      commitLayoutMountEffects_complete(subtreeRoot, root, committedLanes);
    }
  }
}

function commitLayoutMountEffects_complete(
  subtreeRoot: Fiber,
  root: FiberRoot,
  committedLanes: Lanes,
) {
  // 向上递归执行 layout effect
  while (nextEffect !== null) {
    const fiber = nextEffect;
    if ((fiber.flags & LayoutMask) !== NoFlags) {
      const current = fiber.alternate;
      setCurrentDebugFiberInDEV(fiber);
      try {
        commitLayoutEffectOnFiber(root, current, fiber, committedLanes);
      } catch (error) {
        reportUncaughtErrorInDEV(error);
        captureCommitPhaseError(fiber, fiber.return, error);
      }
      resetCurrentDebugFiberInDEV();
    }

    if (fiber === subtreeRoot) {
      nextEffect = null;
      return;
    }

    const sibling = fiber.sibling;
    if (sibling !== null) {
      ensureCorrectReturnPointer(sibling, fiber.return);
      nextEffect = sibling;
      return;
    }

    nextEffect = fiber.return;
  }
}

// 当 disappear 的时候，触发相应的事件
function disappearLayoutEffects_begin(subtreeRoot: Fiber) {
  while (nextEffect !== null) {
    const fiber = nextEffect;
    const firstChild = fiber.child;

    // TODO (Offscreen) Check: flags & (RefStatic | LayoutStatic)
    switch (fiber.tag) {
      case FunctionComponent:
      case ForwardRef:
      case MemoComponent:
      case SimpleMemoComponent: {
        if (
          enableProfilerTimer &&
          enableProfilerCommitHooks &&
          fiber.mode & ProfileMode
        ) {
          try {
            startLayoutEffectTimer();
            commitHookEffectListUnmount(HookLayout, fiber, fiber.return);
          } finally {
            recordLayoutEffectDuration(fiber);
          }
        } else {
          commitHookEffectListUnmount(HookLayout, fiber, fiber.return);
        }
        break;
      }
      case ClassComponent: {
        // TODO (Offscreen) Check: flags & RefStatic
        safelyDetachRef(fiber, fiber.return);

        const instance = fiber.stateNode;
        if (typeof instance.componentWillUnmount === 'function') {
          safelyCallComponentWillUnmount(fiber, fiber.return, instance);
        }
        break;
      }
      case HostComponent: {
        safelyDetachRef(fiber, fiber.return);
        break;
      }
      case OffscreenComponent: {
        // Check if this is a
        const isHidden = fiber.memoizedState !== null;
        if (isHidden) {
          // Nested Offscreen tree is already hidden. Don't disappear
          // its effects.
          disappearLayoutEffects_complete(subtreeRoot);
          continue;
        }
        break;
      }
    }

    // TODO (Offscreen) Check: subtreeFlags & LayoutStatic
    if (firstChild !== null) {
      firstChild.return = fiber;
      nextEffect = firstChild;
    } else {
      disappearLayoutEffects_complete(subtreeRoot);
    }
  }
}

function disappearLayoutEffects_complete(subtreeRoot: Fiber) {
  while (nextEffect !== null) {
    const fiber = nextEffect;

    if (fiber === subtreeRoot) {
      nextEffect = null;
      return;
    }

    const sibling = fiber.sibling;
    if (sibling !== null) {
      sibling.return = fiber.return;
      nextEffect = sibling;
      return;
    }

    nextEffect = fiber.return;
  }
}

function reappearLayoutEffects_begin(subtreeRoot: Fiber) {
  while (nextEffect !== null) {
    const fiber = nextEffect;
    const firstChild = fiber.child;

    if (fiber.tag === OffscreenComponent) {
      const isHidden = fiber.memoizedState !== null;
      if (isHidden) {
        // Nested Offscreen tree is still hidden. Don't re-appear its effects.
        reappearLayoutEffects_complete(subtreeRoot);
        continue;
      }
    }

    // TODO (Offscreen) Check: subtreeFlags & LayoutStatic
    if (firstChild !== null) {
      // This node may have been reused from a previous render, so we can't
      // assume its return pointer is correct.
      firstChild.return = fiber;
      nextEffect = firstChild;
    } else {
      reappearLayoutEffects_complete(subtreeRoot);
    }
  }
}

function reappearLayoutEffects_complete(subtreeRoot: Fiber) {
  while (nextEffect !== null) {
    const fiber = nextEffect;

    // TODO (Offscreen) Check: flags & LayoutStatic
    setCurrentDebugFiberInDEV(fiber);
    try {
      reappearLayoutEffectsOnFiber(fiber);
    } catch (error) {
      reportUncaughtErrorInDEV(error);
      captureCommitPhaseError(fiber, fiber.return, error);
    }
    resetCurrentDebugFiberInDEV();

    if (fiber === subtreeRoot) {
      nextEffect = null;
      return;
    }

    const sibling = fiber.sibling;
    if (sibling !== null) {
      // This node may have been reused from a previous render, so we can't
      // assume its return pointer is correct.
      sibling.return = fiber.return;
      nextEffect = sibling;
      return;
    }

    nextEffect = fiber.return;
  }
}

// mount begin
export function commitPassiveMountEffects(
  root: FiberRoot,
  finishedWork: Fiber,
): void {
  nextEffect = finishedWork;
  commitPassiveMountEffects_begin(finishedWork, root);
}

function commitPassiveMountEffects_begin(subtreeRoot: Fiber, root: FiberRoot) {
  while (nextEffect !== null) {
    const fiber = nextEffect;
    const firstChild = fiber.child;
    if ((fiber.subtreeFlags & PassiveMask) !== NoFlags && firstChild !== null) {
      ensureCorrectReturnPointer(firstChild, fiber);
      nextEffect = firstChild;
    } else {
      // 向下找到第一个不是 PassiveMask 的 fiber
      commitPassiveMountEffects_complete(subtreeRoot, root);
    }
  }
}

// 从下至上调用 mount
function commitPassiveMountEffects_complete(
  subtreeRoot: Fiber,
  root: FiberRoot,
) {
  while (nextEffect !== null) {
    const fiber = nextEffect;
    if ((fiber.flags & Passive) !== NoFlags) {
      setCurrentDebugFiberInDEV(fiber);
      try {
        commitPassiveMountOnFiber(root, fiber);
      } catch (error) {
        reportUncaughtErrorInDEV(error);
        captureCommitPhaseError(fiber, fiber.return, error);
      }
      resetCurrentDebugFiberInDEV();
    }

    if (fiber === subtreeRoot) {
      nextEffect = null;
      return;
    }

    const sibling = fiber.sibling;
    if (sibling !== null) {
      ensureCorrectReturnPointer(sibling, fiber.return);
      nextEffect = sibling;
      return;
    }

    nextEffect = fiber.return;
  }
}

// 触发 mount
function commitPassiveMountOnFiber(
  finishedRoot: FiberRoot,
  finishedWork: Fiber,
): void {
  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case SimpleMemoComponent: {
      if (
        enableProfilerTimer &&
        enableProfilerCommitHooks &&
        finishedWork.mode & ProfileMode
      ) {
        startPassiveEffectTimer();
        try {
          commitHookEffectListMount(HookPassive | HookHasEffect, finishedWork);
        } finally {
          recordPassiveEffectDuration(finishedWork);
        }
      } else {
        commitHookEffectListMount(HookPassive | HookHasEffect, finishedWork);
      }
      break;
    }
  }
}

// 触发 unmount
export function commitPassiveUnmountEffects(firstChild: Fiber): void {
  nextEffect = firstChild;
  commitPassiveUnmountEffects_begin();
}

// 触发 unmount begin
function commitPassiveUnmountEffects_begin() {
  while (nextEffect !== null) {
    const fiber = nextEffect;
    const child = fiber.child;

    // 如果有 deletions，deletions存放的是老 fiber。
    //  将 deletions 下的遇到 function component，
    // 全部按照深度遍历的方式调用 destroy
    if ((nextEffect.flags & ChildDeletion) !== NoFlags) {
      const deletions = fiber.deletions;
      if (deletions !== null) {
        for (let i = 0;i < deletions.length;i++) {
          const fiberToDelete = deletions[i];
          nextEffect = fiberToDelete;
          // 进行具体 delete
          commitPassiveUnmountEffectsInsideOfDeletedTree_begin(
            fiberToDelete,
            fiber,
          );
        }

        // 将 alternate 上对应的 fiber 也置空
        if (deletedTreeCleanUpLevel >= 1) {
          // A fiber was deleted from this parent fiber, but it's still part of
          // the previous (alternate) parent fiber's list of children. Because
          // children are a linked list, an earlier sibling that's still alive
          // will be connected to the deleted fiber via its `alternate`:
          //
          //   live fiber
          //   --alternate--> previous live fiber
          //   --sibling--> deleted fiber
          //
          // We can't disconnect `alternate` on nodes that haven't been deleted
          // yet, but we can disconnect the `sibling` and `child` pointers.
          const previousFiber = fiber.alternate;
          if (previousFiber !== null) {
            let detachedChild = previousFiber.child;
            if (detachedChild !== null) {
              previousFiber.child = null;
              do {
                const detachedSibling = detachedChild.sibling;
                detachedChild.sibling = null;
                detachedChild = detachedSibling;
              } while (detachedChild !== null);
            }
          }
        }

        nextEffect = fiber;
      }
    }

    // 如果孩子有 ChildDeletion 或者 Passive，那么 child 也要执行 unmount
    if ((fiber.subtreeFlags & PassiveMask) !== NoFlags && child !== null) {
      ensureCorrectReturnPointer(child, fiber);
      nextEffect = child;
    } else {
      // 向下查找直到没有 passive childDeletions 为止
      commitPassiveUnmountEffects_complete();
    }
  }
}

// 开始 passive 的 unmount 调用，这里是自下而上调用 unmount
function commitPassiveUnmountEffects_complete() {
  while (nextEffect !== null) {
    const fiber = nextEffect;
    if ((fiber.flags & Passive) !== NoFlags) {
      setCurrentDebugFiberInDEV(fiber);
      // 循环执行 unmount 下的 destroy 方法
      commitPassiveUnmountOnFiber(fiber);
      resetCurrentDebugFiberInDEV();
    }

    const sibling = fiber.sibling;
    if (sibling !== null) {
      ensureCorrectReturnPointer(sibling, fiber.return);
      nextEffect = sibling;
      return;
    }

    nextEffect = fiber.return;
  }
}

// 循环执行 unmount 下的 destroy 方法
function commitPassiveUnmountOnFiber(finishedWork: Fiber): void {
  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case SimpleMemoComponent: {
      if (
        enableProfilerTimer &&
        enableProfilerCommitHooks &&
        finishedWork.mode & ProfileMode
      ) {
        startPassiveEffectTimer();
        commitHookEffectListUnmount(
          HookPassive | HookHasEffect,
          finishedWork,
          finishedWork.return,
        );
        recordPassiveEffectDuration(finishedWork);
      } else {
        commitHookEffectListUnmount(
          HookPassive | HookHasEffect,
          finishedWork,
          finishedWork.return,
        );
      }
      break;
    }
  }
}

// deletions 里面的 unmount
// 也是按照深度遍历来执行的，parent -> child -> child -> sibling -> ...
function commitPassiveUnmountEffectsInsideOfDeletedTree_begin(
  deletedSubtreeRoot: Fiber,
  nearestMountedAncestor: Fiber | null,
) {
  while (nextEffect !== null) {
    const fiber = nextEffect;

    // Deletion effects fire in parent -> child order
    // TODO: Check if fiber has a PassiveStatic flag
    setCurrentDebugFiberInDEV(fiber);
    // 如果是 functionComponent 调用 destroy
    commitPassiveUnmountInsideDeletedTreeOnFiber(fiber, nearestMountedAncestor);
    resetCurrentDebugFiberInDEV();

    const child = fiber.child;
    // TODO: Only traverse subtree if it has a PassiveStatic flag. (But, if we
    // do this, still need to handle `deletedTreeCleanUpLevel` correctly.)
    if (child !== null) {
      ensureCorrectReturnPointer(child, fiber);
      nextEffect = child;
    } else {
      commitPassiveUnmountEffectsInsideOfDeletedTree_complete(
        deletedSubtreeRoot,
      );
    }
  }
}

// detachFiberAfterEffects 将对应删除的 fiber 置空
function commitPassiveUnmountEffectsInsideOfDeletedTree_complete(
  deletedSubtreeRoot: Fiber,
) {
  while (nextEffect !== null) {
    const fiber = nextEffect;
    const sibling = fiber.sibling;
    const returnFiber = fiber.return;

    if (deletedTreeCleanUpLevel >= 2) {
      // Recursively traverse the entire deleted tree and clean up fiber fields.
      // This is more aggressive than ideal, and the long term goal is to only
      // have to detach the deleted tree at the root.
      // 将 fiber 内容置空
      detachFiberAfterEffects(fiber);
      if (fiber === deletedSubtreeRoot) {
        nextEffect = null;
        return;
      }
    } else {
      // This is the default branch (level 0). We do not recursively clear all
      // the fiber fields. Only the root of the deleted subtree.
      if (fiber === deletedSubtreeRoot) {
        detachFiberAfterEffects(fiber);
        nextEffect = null;
        return;
      }
    }

    if (sibling !== null) {
      ensureCorrectReturnPointer(sibling, returnFiber);
      nextEffect = sibling;
      return;
    }

    nextEffect = returnFiber;
  }
}

// 如果是 function component，调用它们的 destroy
function commitPassiveUnmountInsideDeletedTreeOnFiber(
  current: Fiber,
  nearestMountedAncestor: Fiber | null,
): void {
  switch (current.tag) {
    case FunctionComponent:
    case ForwardRef:
    case SimpleMemoComponent: {
      if (
        enableProfilerTimer &&
        enableProfilerCommitHooks &&
        current.mode & ProfileMode
      ) {
        startPassiveEffectTimer();
        commitHookEffectListUnmount(
          HookPassive,
          current,
          nearestMountedAncestor,
        );
        recordPassiveEffectDuration(current);
      } else {
        commitHookEffectListUnmount(
          HookPassive,
          current,
          nearestMountedAncestor,
        );
      }
      break;
    }
  }
}

let didWarnWrongReturnPointer = false;
function ensureCorrectReturnPointer(fiber, expectedReturnFiber) {
  if (__DEV__) {
    if (!didWarnWrongReturnPointer && fiber.return !== expectedReturnFiber) {
      didWarnWrongReturnPointer = true;
      console.error(
        'Internal React error: Return pointer is inconsistent ' +
        'with parent.',
      );
    }
  }

  // TODO: Remove this assignment once we're confident that it won't break
  // anything, by checking the warning logs for the above invariant
  fiber.return = expectedReturnFiber;
}

// TODO: Reuse reappearLayoutEffects traversal here?
function invokeLayoutEffectMountInDEV(fiber: Fiber): void {
  if (__DEV__ && enableStrictEffects) {
    // We don't need to re-check StrictEffectsMode here.
    // This function is only called if that check has already passed.
    switch (fiber.tag) {
      case FunctionComponent:
      case ForwardRef:
      case SimpleMemoComponent: {
        try {
          commitHookEffectListMount(HookLayout | HookHasEffect, fiber);
        } catch (error) {
          reportUncaughtErrorInDEV(error);
          captureCommitPhaseError(fiber, fiber.return, error);
        }
        break;
      }
      case ClassComponent: {
        const instance = fiber.stateNode;
        try {
          instance.componentDidMount();
        } catch (error) {
          reportUncaughtErrorInDEV(error);
          captureCommitPhaseError(fiber, fiber.return, error);
        }
        break;
      }
    }
  }
}

function invokePassiveEffectMountInDEV(fiber: Fiber): void {
  if (__DEV__ && enableStrictEffects) {
    // We don't need to re-check StrictEffectsMode here.
    // This function is only called if that check has already passed.
    switch (fiber.tag) {
      case FunctionComponent:
      case ForwardRef:
      case SimpleMemoComponent: {
        try {
          commitHookEffectListMount(HookPassive | HookHasEffect, fiber);
        } catch (error) {
          reportUncaughtErrorInDEV(error);
          captureCommitPhaseError(fiber, fiber.return, error);
        }
        break;
      }
    }
  }
}

function invokeLayoutEffectUnmountInDEV(fiber: Fiber): void {
  if (__DEV__ && enableStrictEffects) {
    // We don't need to re-check StrictEffectsMode here.
    // This function is only called if that check has already passed.
    switch (fiber.tag) {
      case FunctionComponent:
      case ForwardRef:
      case SimpleMemoComponent: {
        try {
          commitHookEffectListUnmount(
            HookLayout | HookHasEffect,
            fiber,
            fiber.return,
          );
        } catch (error) {
          reportUncaughtErrorInDEV(error);
          captureCommitPhaseError(fiber, fiber.return, error);
        }
        break;
      }
      case ClassComponent: {
        const instance = fiber.stateNode;
        if (typeof instance.componentWillUnmount === 'function') {
          safelyCallComponentWillUnmount(fiber, fiber.return, instance);
        }
        break;
      }
    }
  }
}

function invokePassiveEffectUnmountInDEV(fiber: Fiber): void {
  if (__DEV__ && enableStrictEffects) {
    // We don't need to re-check StrictEffectsMode here.
    // This function is only called if that check has already passed.
    switch (fiber.tag) {
      case FunctionComponent:
      case ForwardRef:
      case SimpleMemoComponent: {
        try {
          commitHookEffectListUnmount(
            HookPassive | HookHasEffect,
            fiber,
            fiber.return,
          );
        } catch (error) {
          reportUncaughtErrorInDEV(error);
          captureCommitPhaseError(fiber, fiber.return, error);
        }
      }
    }
  }
}

export {
  commitResetTextContent,
  commitPlacement,
  commitDeletion,
  commitWork,
  commitAttachRef,
  commitDetachRef,
  invokeLayoutEffectMountInDEV,
  invokeLayoutEffectUnmountInDEV,
  invokePassiveEffectMountInDEV,
  invokePassiveEffectUnmountInDEV,
};
