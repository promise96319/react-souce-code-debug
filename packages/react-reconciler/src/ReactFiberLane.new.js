/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type { FiberRoot } from './ReactInternalTypes';

// TODO: Ideally these types would be opaque but that doesn't work well with
// our reconciler fork infra, since these leak into non-reconciler packages.

export type Lanes = number;
export type Lane = number;
export type LaneMap<T> = Array<T>;

import {
  enableCache,
  enableSchedulingProfiler,
  enableUpdaterTracking,
  allowConcurrentByDefault,
} from 'shared/ReactFeatureFlags';
import { isDevToolsPresent } from './ReactFiberDevToolsHook.new';
import { ConcurrentUpdatesByDefaultMode, NoMode } from './ReactTypeOfMode';

// Lane values below should be kept in sync with getLabelForLane(), used by react-devtools-scheduling-profiler.
// If those values are changed that package should be rebuilt and redeployed.

export const TotalLanes = 31;

// 没有 lane
export const NoLanes: Lanes = /*                        */ 0b0000000000000000000000000000000;
export const NoLane: Lane = /*                          */ 0b0000000000000000000000000000000;

// 同步 lane，比如 click 事件
export const SyncLane: Lane = /*                        */ 0b0000000000000000000000000000001;

// 用户连续输入 lane，比如 drag 事件
export const InputContinuousHydrationLane: Lane = /*    */ 0b0000000000000000000000000000010;
export const InputContinuousLane: Lanes = /*            */ 0b0000000000000000000000000000100;

// 默认 lane，比如 setTimeout 后设置
export const DefaultHydrationLane: Lane = /*            */ 0b0000000000000000000000000001000;
export const DefaultLane: Lanes = /*                    */ 0b0000000000000000000000000010000;

// useTransition lane
const TransitionHydrationLane: Lane = /*                */ 0b0000000000000000000000000100000;
const TransitionLanes: Lanes = /*                       */ 0b0000000001111111111111111000000;
const TransitionLane1: Lane = /*                        */ 0b0000000000000000000000001000000;
const TransitionLane2: Lane = /*                        */ 0b0000000000000000000000010000000;
const TransitionLane3: Lane = /*                        */ 0b0000000000000000000000100000000;
const TransitionLane4: Lane = /*                        */ 0b0000000000000000000001000000000;
const TransitionLane5: Lane = /*                        */ 0b0000000000000000000010000000000;
const TransitionLane6: Lane = /*                        */ 0b0000000000000000000100000000000;
const TransitionLane7: Lane = /*                        */ 0b0000000000000000001000000000000;
const TransitionLane8: Lane = /*                        */ 0b0000000000000000010000000000000;
const TransitionLane9: Lane = /*                        */ 0b0000000000000000100000000000000;
const TransitionLane10: Lane = /*                       */ 0b0000000000000001000000000000000;
const TransitionLane11: Lane = /*                       */ 0b0000000000000010000000000000000;
const TransitionLane12: Lane = /*                       */ 0b0000000000000100000000000000000;
const TransitionLane13: Lane = /*                       */ 0b0000000000001000000000000000000;
const TransitionLane14: Lane = /*                       */ 0b0000000000010000000000000000000;
const TransitionLane15: Lane = /*                       */ 0b0000000000100000000000000000000;
const TransitionLane16: Lane = /*                       */ 0b0000000001000000000000000000000;

// 出错后重试 lane
const RetryLanes: Lanes = /*                            */ 0b0000111110000000000000000000000;
const RetryLane1: Lane = /*                             */ 0b0000000010000000000000000000000;
const RetryLane2: Lane = /*                             */ 0b0000000100000000000000000000000;
const RetryLane3: Lane = /*                             */ 0b0000001000000000000000000000000;
const RetryLane4: Lane = /*                             */ 0b0000010000000000000000000000000;
const RetryLane5: Lane = /*                             */ 0b0000100000000000000000000000000;

export const SomeRetryLane: Lane = RetryLane1;

export const SelectiveHydrationLane: Lane = /*          */ 0b0001000000000000000000000000000;

// 非空闲 lane
const NonIdleLanes = /*                                 */ 0b0001111111111111111111111111111;


export const IdleHydrationLane: Lane = /*               */ 0b0010000000000000000000000000000;
// 空闲 lane
export const IdleLane: Lanes = /*                       */ 0b0100000000000000000000000000000;
// 离屏 lane
export const OffscreenLane: Lane = /*                   */ 0b1000000000000000000000000000000;

// This function is used for the experimental scheduling profiler (react-devtools-scheduling-profiler)
// It should be kept in sync with the Lanes values above.
export function getLabelForLane(lane: Lane): string | void {
  if (enableSchedulingProfiler) {
    if (lane & SyncLane) {
      return 'Sync';
    }
    if (lane & InputContinuousHydrationLane) {
      return 'InputContinuousHydration';
    }
    if (lane & InputContinuousLane) {
      return 'InputContinuous';
    }
    if (lane & DefaultHydrationLane) {
      return 'DefaultHydration';
    }
    if (lane & DefaultLane) {
      return 'Default';
    }
    if (lane & TransitionHydrationLane) {
      return 'TransitionHydration';
    }
    if (lane & TransitionLanes) {
      return 'Transition';
    }
    if (lane & RetryLanes) {
      return 'Retry';
    }
    if (lane & SelectiveHydrationLane) {
      return 'SelectiveHydration';
    }
    if (lane & IdleHydrationLane) {
      return 'IdleHydration';
    }
    if (lane & IdleLane) {
      return 'Idle';
    }
    if (lane & OffscreenLane) {
      return 'Offscreen';
    }
  }
}

export const NoTimestamp = -1;
// 默认为 第一条transition lane
let nextTransitionLane: Lane = TransitionLane1;
let nextRetryLane: Lane = RetryLane1;

// 获取 lanes 中的最高优先级的 lane
function getHighestPriorityLanes(lanes: Lanes | Lane): Lanes {
  switch (getHighestPriorityLane(lanes)) {
    case SyncLane:
      return SyncLane;
    case InputContinuousHydrationLane:
      return InputContinuousHydrationLane;
    case InputContinuousLane:
      return InputContinuousLane;
    case DefaultHydrationLane:
      return DefaultHydrationLane;
    case DefaultLane:
      return DefaultLane;
    case TransitionHydrationLane:
      return TransitionHydrationLane;
    case TransitionLane1:
    case TransitionLane2:
    case TransitionLane3:
    case TransitionLane4:
    case TransitionLane5:
    case TransitionLane6:
    case TransitionLane7:
    case TransitionLane8:
    case TransitionLane9:
    case TransitionLane10:
    case TransitionLane11:
    case TransitionLane12:
    case TransitionLane13:
    case TransitionLane14:
    case TransitionLane15:
    case TransitionLane16:
      return lanes & TransitionLanes;
    case RetryLane1:
    case RetryLane2:
    case RetryLane3:
    case RetryLane4:
    case RetryLane5:
      return lanes & RetryLanes;
    case SelectiveHydrationLane:
      return SelectiveHydrationLane;
    case IdleHydrationLane:
      return IdleHydrationLane;
    case IdleLane:
      return IdleLane;
    case OffscreenLane:
      return OffscreenLane;
    default:
      if (__DEV__) {
        console.error(
          'Should have found matching lanes. This is a bug in React.',
        );
      }
      // This shouldn't be reachable, but as a fallback, return the entire bitmask.
      return lanes;
  }
}

// 根据 pendingLanes/suspendedLanes/pingedLanes/entanglements 来计算 nextLane.
// 如果当前新增的 lane 优先级比 wipLanes 高，则有可能将 当前lane 置为 nextLane
export function getNextLanes(root: FiberRoot, wipLanes: Lanes): Lanes {
  // Early bailout if there's no pending work left.
  const pendingLanes = root.pendingLanes;
  if (pendingLanes === NoLanes) {
    return NoLanes;
  }

  let nextLanes = NoLanes;

  const suspendedLanes = root.suspendedLanes;
  const pingedLanes = root.pingedLanes;

  // Do not work on any idle work until all the non-idle work has finished,
  // even if the work is suspended.
  const nonIdlePendingLanes = pendingLanes & NonIdleLanes;
  // 存在不是空闲的 lanes
  // todo suspendedLanes / pingedLanes 是什么？
  // pingedLanes 是 懒加载完成后的更新 lane
  if (nonIdlePendingLanes !== NoLanes) {
    const nonIdleUnblockedLanes = nonIdlePendingLanes & ~suspendedLanes;
    if (nonIdleUnblockedLanes !== NoLanes) {
      nextLanes = getHighestPriorityLanes(nonIdleUnblockedLanes);
    } else {
      const nonIdlePingedLanes = nonIdlePendingLanes & pingedLanes;
      if (nonIdlePingedLanes !== NoLanes) {
        nextLanes = getHighestPriorityLanes(nonIdlePingedLanes);
      }
    }
  } else {
    // The only remaining work is Idle.
    // 剩余的都是 空闲的 lanes
    const unblockedLanes = pendingLanes & ~suspendedLanes;
    if (unblockedLanes !== NoLanes) {
      nextLanes = getHighestPriorityLanes(unblockedLanes);
    } else {
      if (pingedLanes !== NoLanes) {
        nextLanes = getHighestPriorityLanes(pingedLanes);
      }
    }
  }

  if (nextLanes === NoLanes) {
    // This should only be reachable if we're suspended
    // TODO: Consider warning in this path if a fallback timer is not scheduled.
    return NoLanes;
  }

  // If we're already in the middle of a render, switching lanes will interrupt
  // it and we'll lose our progress. We should only do this if the new lanes are
  // higher priority.
  // 当 nextLanes 优先级更高时，可以打断 wipLanes
  if (
    wipLanes !== NoLanes &&
    wipLanes !== nextLanes &&
    // If we already suspended with a delay, then interrupting is fine. Don't
    // bother waiting until the root is complete.
    (wipLanes & suspendedLanes) === NoLanes
  ) {
    const nextLane = getHighestPriorityLane(nextLanes);
    const wipLane = getHighestPriorityLane(wipLanes);
    if (
      // Tests whether the next lane is equal or lower priority than the wip
      // one. This works because the bits decrease in priority as you go left.
      nextLane >= wipLane ||
      // Default priority updates should not interrupt transition updates. The
      // only difference between default updates and transition updates is that
      // default updates do not support refresh transitions.
      // 默认的 lanes 无法打断 transitions。transitions 无法 refresh
      (nextLane === DefaultLane && (wipLane & TransitionLanes) !== NoLanes)
    ) {
      // Keep working on the existing in-progress tree. Do not interrupt.
      return wipLanes;
    }
  }

  // 如果 nextLine 优先级比 wipLane 优先级高
  if (
    allowConcurrentByDefault &&
    (root.current.mode & ConcurrentUpdatesByDefaultMode) !== NoMode
  ) {
    // Do nothing, use the lanes as they were assigned.
  } else if ((nextLanes & InputContinuousLane) !== NoLanes) {
    // When updates are sync by default, we entangle continuous priority updates
    // and default updates, so they render in the same batch. The only reason
    // they use separate lanes is because continuous updates should interrupt
    // transitions, but default updates should not.
    // todo 为什么要加 default lane?
    nextLanes |= pendingLanes & DefaultLane;
  }

  // Check for entangled lanes and add them to the batch.
  //
  // A lane is said to be entangled with another when it's not allowed to render
  // in a batch that does not also include the other lane. Typically we do this
  // when multiple updates have the same source, and we only want to respond to
  // the most recent event from that source.
  //
  // Note that we apply entanglements *after* checking for partial work above.
  // This means that if a lane is entangled during an interleaved event while
  // it's already rendering, we won't interrupt it. This is intentional, since
  // entanglement is usually "best effort": we'll try our best to render the
  // lanes in the same batch, but it's not worth throwing out partially
  // completed work in order to do it.
  // TODO: Reconsider this. The counter-argument is that the partial work
  // represents an intermediate state, which we don't want to show to the user.
  // And by spending extra time finishing it, we're increasing the amount of
  // time it takes to show the final state, which is what they are actually
  // waiting for.
  //
  // For those exceptions where entanglement is semantically important, like
  // useMutableSource, we should ensure that there is no partial work at the
  // time we apply the entanglement.
  // todo entangledLanes 是什么呢？
  const entangledLanes = root.entangledLanes;
  if (entangledLanes !== NoLanes) {
    const entanglements = root.entanglements;
    let lanes = nextLanes & entangledLanes;

    // 将 transition lane 加入到 nextLanes 中
    while (lanes > 0) {
      const index = pickArbitraryLaneIndex(lanes);
      const lane = 1 << index;

      nextLanes |= entanglements[index];

      lanes &= ~lane;
    }
  }

  return nextLanes;
}

export function getMostRecentEventTime(root: FiberRoot, lanes: Lanes): number {
  const eventTimes = root.eventTimes;

  let mostRecentEventTime = NoTimestamp;
  while (lanes > 0) {
    const index = pickArbitraryLaneIndex(lanes);
    const lane = 1 << index;

    const eventTime = eventTimes[index];
    if (eventTime > mostRecentEventTime) {
      mostRecentEventTime = eventTime;
    }

    lanes &= ~lane;
  }

  return mostRecentEventTime;
}

// 根据优先级 lane 和 当前时间 计算 过期时间
function computeExpirationTime(lane: Lane, currentTime: number) {
  switch (lane) {
    case SyncLane:
    case InputContinuousHydrationLane:
    case InputContinuousLane:
      // User interactions should expire slightly more quickly.
      //
      // NOTE: This is set to the corresponding constant as in Scheduler.js.
      // When we made it larger, a product metric in www regressed, suggesting
      // there's a user interaction that's being starved by a series of
      // synchronous updates. If that theory is correct, the proper solution is
      // to fix the starvation. However, this scenario supports the idea that
      // expiration times are an important safeguard when starvation
      // does happen.
      return currentTime + 250;
    case DefaultHydrationLane:
    case DefaultLane:
    case TransitionHydrationLane:
    case TransitionLane1:
    case TransitionLane2:
    case TransitionLane3:
    case TransitionLane4:
    case TransitionLane5:
    case TransitionLane6:
    case TransitionLane7:
    case TransitionLane8:
    case TransitionLane9:
    case TransitionLane10:
    case TransitionLane11:
    case TransitionLane12:
    case TransitionLane13:
    case TransitionLane14:
    case TransitionLane15:
    case TransitionLane16:
      return currentTime + 5000;
    case RetryLane1:
    case RetryLane2:
    case RetryLane3:
    case RetryLane4:
    case RetryLane5:
      // TODO: Retries should be allowed to expire if they are CPU bound for
      // too long, but when I made this change it caused a spike in browser
      // crashes. There must be some other underlying bug; not super urgent but
      // ideally should figure out why and fix it. Unfortunately we don't have
      // a repro for the crashes, only detected via production metrics.
      return NoTimestamp;
    case SelectiveHydrationLane:
    case IdleHydrationLane:
    case IdleLane:
    case OffscreenLane:
      // Anything idle priority or lower should never expire.
      return NoTimestamp;
    default:
      if (__DEV__) {
        console.error(
          'Should have found matching lanes. This is a bug in React.',
        );
      }
      return NoTimestamp;
  }
}

// 计算所有lane 的过期时间，并将饥饿的 lanes 置为过期： pendingLanes => expiredLanes
export function markStarvedLanesAsExpired(
  root: FiberRoot,
  currentTime: number,
): void {
  // TODO: This gets called every time we yield. We can optimize by storing
  // the earliest expiration time on the root. Then use that to quickly bail out
  // of this function.

  // markRootUpdated 里会将新的 lane 添加到 pending 上。
  const pendingLanes = root.pendingLanes;
  const suspendedLanes = root.suspendedLanes;
  const pingedLanes = root.pingedLanes;
  const expirationTimes = root.expirationTimes;

  // Iterate through the pending lanes and check if we've reached their
  // expiration time. If so, we'll assume the update is being starved and mark
  // it as expired to force it to finish.
  let lanes = pendingLanes;
  // 遍历 pending lanes，看是否有过期时间
  // 如果有过期时间，看是否已经过期
  // 如果过期了，那么放入到 expiredLanes 中
  while (lanes > 0) {
    // 找到 pendingLanes 的位置
    const index = pickArbitraryLaneIndex(lanes);
    // 计算最大的 lane
    const lane = 1 << index;
    // 之前存放在的 lane 的过期时间，默认是 NoTimestamp
    // todo 之前不都是 eventTimes 存放 time 的吗？为什么是 expirationTimes？
    const expirationTime = expirationTimes[index];
    // lane 默认是 NoTimestamp
    if (expirationTime === NoTimestamp) {
      // Found a pending lane with no expiration time. If it's not suspended, or
      // if it's pinged, assume it's CPU-bound. Compute a new expiration time
      // using the current time.
      if (
        (lane & suspendedLanes) === NoLanes ||
        (lane & pingedLanes) !== NoLanes
      ) {
        // Assumes timestamps are monotonically increasing.
        // 计算过期时间，并且存放到 expirationTimes 中
        expirationTimes[index] = computeExpirationTime(lane, currentTime);
      }
    } else if (expirationTime <= currentTime) {
      // This lane expired
      // 如果之前有过期时间，且相较于现在的这个任务时间。
      // 如果是已经过期了，那么将以前的 lane 推到 expiredLanes 中
      root.expiredLanes |= lane;
    }

    // 移除以前的 lane，找下一个 lane做同样的处理
    // 这里的处理lane的顺序是由大到小，也就是低优先级到高优先级。
    lanes &= ~lane;
  }
}

// This returns the highest priority pending lanes regardless of whether they
// are suspended.
export function getHighestPriorityPendingLanes(root: FiberRoot) {
  return getHighestPriorityLanes(root.pendingLanes);
}

export function getLanesToRetrySynchronouslyOnError(root: FiberRoot): Lanes {
  const everythingButOffscreen = root.pendingLanes & ~OffscreenLane;
  if (everythingButOffscreen !== NoLanes) {
    return everythingButOffscreen;
  }
  if (everythingButOffscreen & OffscreenLane) {
    return OffscreenLane;
  }
  return NoLanes;
}

export function includesNonIdleWork(lanes: Lanes) {
  return (lanes & NonIdleLanes) !== NoLanes;
}
export function includesOnlyRetries(lanes: Lanes) {
  return (lanes & RetryLanes) === lanes;
}
export function includesOnlyTransitions(lanes: Lanes) {
  return (lanes & TransitionLanes) === lanes;
}

// 判断是否应该开启时间切片模式
export function shouldTimeSlice(root: FiberRoot, lanes: Lanes) {
  // 如果当前 lanes 里存在 expiredLanes
  if ((lanes & root.expiredLanes) !== NoLanes) {
    // At least one of these lanes expired. To prevent additional starvation,
    // finish rendering without yielding execution.
    return false;
  }

  if (
    allowConcurrentByDefault &&
    (root.current.mode & ConcurrentUpdatesByDefaultMode) !== NoMode
  ) {
    // Concurrent updates by default always use time slicing.
    return true;
  }

  const SyncDefaultLanes =
    InputContinuousHydrationLane |
    InputContinuousLane |
    DefaultHydrationLane |
    DefaultLane;
  // 如果有用户输入的 lanes，或者是默认lane(在首次渲染时)
  // 如果不存在同步lanes，那么就是使用切片，否则使用同步的形式。
  // todo 剩余的不就是 transition 等 lane 了吗
  return (lanes & SyncDefaultLanes) === NoLanes;
}

export function isTransitionLane(lane: Lane) {
  return (lane & TransitionLanes) !== 0;
}

// 请求下一条 transition lane
export function claimNextTransitionLane(): Lane {
  // Cycle through the lanes, assigning each new transition to the next lane.
  // In most cases, this means every transition gets its own lane, until we
  // run out of lanes and cycle back to the beginning.
  // 默认第一条 transition lane
  const lane = nextTransitionLane;
  // 向后移动一位
  nextTransitionLane <<= 1;
  // 如果移动后超出了 transition lane，那么又回到第一条 lane
  if ((nextTransitionLane & TransitionLanes) === 0) {
    nextTransitionLane = TransitionLane1;
  }
  return lane;
}

export function claimNextRetryLane(): Lane {
  const lane = nextRetryLane;
  nextRetryLane <<= 1;
  if ((nextRetryLane & RetryLanes) === 0) {
    nextRetryLane = RetryLane1;
  }
  return lane;
}

// 获取最后一位1 如： 11100100 获取 100 也就是 4
// 这样就能获取 lanes 中优先级最高的 lane 了
export function getHighestPriorityLane(lanes: Lanes): Lane {
  return lanes & -lanes;
}

export function pickArbitraryLane(lanes: Lanes): Lane {
  // This wrapper function gets inlined. Only exists so to communicate that it
  // doesn't matter which bit is selected; you can pick any bit without
  // affecting the algorithms where its used. Here I'm using
  // getHighestPriorityLane because it requires the fewest operations.
  return getHighestPriorityLane(lanes);
}

function pickArbitraryLaneIndex(lanes: Lanes) {
  return 31 - clz32(lanes);
}

// Math.clz32() 函数返回一个数字在转换成 32 无符号整形数字的二进制形式后, 开头的 0 的个数
// 相当于通过当前的 lane 值找到在 32 位中对应的 index
function laneToIndex(lane: Lane) {
  return pickArbitraryLaneIndex(lane);
}

export function includesSomeLane(a: Lanes | Lane, b: Lanes | Lane) {
  return (a & b) !== NoLanes;
}

export function isSubsetOfLanes(set: Lanes, subset: Lanes | Lane) {
  return (set & subset) === subset;
}

export function mergeLanes(a: Lanes | Lane, b: Lanes | Lane): Lanes {
  return a | b;
}

export function removeLanes(set: Lanes, subset: Lanes | Lane): Lanes {
  return set & ~subset;
}

export function intersectLanes(a: Lanes | Lane, b: Lanes | Lane): Lanes {
  return a & b;
}

// Seems redundant, but it changes the type from a single lane (used for
// updates) to a group of lanes (used for flushing work).
export function laneToLanes(lane: Lane): Lanes {
  return lane;
}

export function higherPriorityLane(a: Lane, b: Lane) {
  // This works because the bit ranges decrease in priority as you go left.
  return a !== NoLane && a < b ? a : b;
}

export function createLaneMap<T>(initial: T): LaneMap<T> {
  // Intentionally pushing one by one.
  // https://v8.dev/blog/elements-kinds#avoid-creating-holes
  const laneMap = [];
  for (let i = 0;i < TotalLanes;i++) {
    laneMap.push(initial);
  }
  return laneMap;
}

export function markRootUpdated(
  root: FiberRoot,
  updateLane: Lane,
  eventTime: number,
) {
  // 在 pendingLanes 中增加当前的 updateLane，
  root.pendingLanes |= updateLane;

  // If there are any suspended transitions, it's possible this new update
  // could unblock them. Clear the suspended lanes so that we can try rendering
  // them again.
  //
  // TODO: We really only need to unsuspend only lanes that are in the
  // `subtreeLanes` of the updated fiber, or the update lanes of the return
  // path. This would exclude suspended updates in an unrelated sibling tree,
  // since there's no way for this update to unblock it.
  //
  // We don't do this if the incoming update is idle, because we never process
  // idle updates until after all the regular updates have finished; there's no
  // way it could unblock a transition.
  if (updateLane !== IdleLane) {
    root.suspendedLanes = NoLanes;
    root.pingedLanes = NoLanes;
  }

  const eventTimes = root.eventTimes;
  // 找到当前 lane 对应的 index
  const index = laneToIndex(updateLane);
  // We can always overwrite an existing timestamp because we prefer the most
  // recent event, and we assume time is monotonically increasing.
  eventTimes[index] = eventTime;
}

// 增加对应的lane，并清除过期时间
export function markRootSuspended(root: FiberRoot, suspendedLanes: Lanes) {
  root.suspendedLanes |= suspendedLanes;
  root.pingedLanes &= ~suspendedLanes;

  // The suspended lanes are no longer CPU-bound. Clear their expiration times.
  const expirationTimes = root.expirationTimes;
  let lanes = suspendedLanes;
  while (lanes > 0) {
    const index = pickArbitraryLaneIndex(lanes);
    const lane = 1 << index;

    expirationTimes[index] = NoTimestamp;

    lanes &= ~lane;
  }
}

export function markRootPinged(
  root: FiberRoot,
  pingedLanes: Lanes,
  eventTime: number,
) {
  root.pingedLanes |= root.suspendedLanes & pingedLanes;
}

export function markRootMutableRead(root: FiberRoot, updateLane: Lane) {
  root.mutableReadLanes |= updateLane & root.pendingLanes;
}

export function markRootFinished(root: FiberRoot, remainingLanes: Lanes) {
  const noLongerPendingLanes = root.pendingLanes & ~remainingLanes;

  root.pendingLanes = remainingLanes;

  // Let's try everything again
  root.suspendedLanes = 0;
  root.pingedLanes = 0;

  root.expiredLanes &= remainingLanes;
  root.mutableReadLanes &= remainingLanes;

  root.entangledLanes &= remainingLanes;

  if (enableCache) {
    const pooledCacheLanes = (root.pooledCacheLanes &= remainingLanes);
    if (pooledCacheLanes === NoLanes) {
      // None of the remaining work relies on the cache pool. Clear it so
      // subsequent requests get a new cache.
      root.pooledCache = null;
    }
  }

  const entanglements = root.entanglements;
  const eventTimes = root.eventTimes;
  const expirationTimes = root.expirationTimes;

  // Clear the lanes that no longer have pending work
  let lanes = noLongerPendingLanes;
  while (lanes > 0) {
    const index = pickArbitraryLaneIndex(lanes);
    const lane = 1 << index;

    entanglements[index] = NoLanes;
    eventTimes[index] = NoTimestamp;
    expirationTimes[index] = NoTimestamp;

    lanes &= ~lane;
  }
}

export function markRootEntangled(root: FiberRoot, entangledLanes: Lanes) {
  // In addition to entangling each of the given lanes with each other, we also
  // have to consider _transitive_ entanglements. For each lane that is already
  // entangled with *any* of the given lanes, that lane is now transitively
  // entangled with *all* the given lanes.
  //
  // Translated: If C is entangled with A, then entangling A with B also
  // entangles C with B.
  //
  // If this is hard to grasp, it might help to intentionally break this
  // function and look at the tests that fail in ReactTransition-test.js. Try
  // commenting out one of the conditions below.

  const rootEntangledLanes = (root.entangledLanes |= entangledLanes);
  const entanglements = root.entanglements;
  let lanes = rootEntangledLanes;
  while (lanes) {
    const index = pickArbitraryLaneIndex(lanes);
    const lane = 1 << index;
    if (
      // Is this one of the newly entangled lanes?
      (lane & entangledLanes) |
      // Is this lane transitively entangled with the newly entangled lanes?
      (entanglements[index] & entangledLanes)
    ) {
      entanglements[index] |= entangledLanes;
    }
    lanes &= ~lane;
  }
}

export function getBumpedLaneForHydration(
  root: FiberRoot,
  renderLanes: Lanes,
): Lane {
  const renderLane = getHighestPriorityLane(renderLanes);

  let lane;
  switch (renderLane) {
    case InputContinuousLane:
      lane = InputContinuousHydrationLane;
      break;
    case DefaultLane:
      lane = DefaultHydrationLane;
      break;
    case TransitionLane1:
    case TransitionLane2:
    case TransitionLane3:
    case TransitionLane4:
    case TransitionLane5:
    case TransitionLane6:
    case TransitionLane7:
    case TransitionLane8:
    case TransitionLane9:
    case TransitionLane10:
    case TransitionLane11:
    case TransitionLane12:
    case TransitionLane13:
    case TransitionLane14:
    case TransitionLane15:
    case TransitionLane16:
    case RetryLane1:
    case RetryLane2:
    case RetryLane3:
    case RetryLane4:
    case RetryLane5:
      lane = TransitionHydrationLane;
      break;
    case IdleLane:
      lane = IdleHydrationLane;
      break;
    default:
      // Everything else is already either a hydration lane, or shouldn't
      // be retried at a hydration lane.
      lane = NoLane;
      break;
  }

  // Check if the lane we chose is suspended. If so, that indicates that we
  // already attempted and failed to hydrate at that level. Also check if we're
  // already rendering that lane, which is rare but could happen.
  if ((lane & (root.suspendedLanes | renderLanes)) !== NoLane) {
    // Give up trying to hydrate and fall back to client render.
    return NoLane;
  }

  return lane;
}

export function addFiberToLanesMap(
  root: FiberRoot,
  fiber: Fiber,
  lanes: Lanes | Lane,
) {
  if (!enableUpdaterTracking) {
    return;
  }
  if (!isDevToolsPresent) {
    return;
  }
  const pendingUpdatersLaneMap = root.pendingUpdatersLaneMap;
  while (lanes > 0) {
    const index = laneToIndex(lanes);
    const lane = 1 << index;

    const updaters = pendingUpdatersLaneMap[index];
    updaters.add(fiber);

    lanes &= ~lane;
  }
}

export function movePendingFibersToMemoized(root: FiberRoot, lanes: Lanes) {
  if (!enableUpdaterTracking) {
    return;
  }
  if (!isDevToolsPresent) {
    return;
  }
  const pendingUpdatersLaneMap = root.pendingUpdatersLaneMap;
  const memoizedUpdaters = root.memoizedUpdaters;
  while (lanes > 0) {
    const index = laneToIndex(lanes);
    const lane = 1 << index;

    const updaters = pendingUpdatersLaneMap[index];
    if (updaters.size > 0) {
      updaters.forEach(fiber => {
        const alternate = fiber.alternate;
        if (alternate === null || !memoizedUpdaters.has(alternate)) {
          memoizedUpdaters.add(fiber);
        }
      });
      updaters.clear();
    }

    lanes &= ~lane;
  }
}

const clz32 = Math.clz32 ? Math.clz32 : clz32Fallback;

// Count leading zeros. Only used on lanes, so assume input is an integer.
// Based on:
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/clz32
const log = Math.log;
const LN2 = Math.LN2;
function clz32Fallback(lanes: Lanes | Lane) {
  if (lanes === 0) {
    return 32;
  }
  return (31 - ((log(lanes) / LN2) | 0)) | 0;
}
