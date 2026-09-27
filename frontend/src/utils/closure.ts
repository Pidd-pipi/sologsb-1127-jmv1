import type { PointClosure } from '../types/closure';
import type { RouteSegment } from '../types/route';
import { todayStr } from './format';

/** 停用记录的有效截止日：提前恢复按实际恢复日，否则按计划恢复日 */
export function closureEffectiveEnd(c: PointClosure): string {
  return c.actualEnd || c.endDate;
}

/** 判断某日期（含起止当日）是否落在停用期内 */
export function isClosedOn(c: PointClosure, date: string): boolean {
  if (!date) return false;
  return c.startDate <= date && date <= closureEffectiveEnd(c);
}

/** 两个日期段是否重叠（含端点相接） */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** 同一点位的停用段不允许重叠：返回与新段冲突的既有记录 */
export function findOverlap(
  closures: PointClosure[],
  pointId: string,
  startDate: string,
  endDate: string,
  excludeId = '',
): PointClosure | undefined {
  return closures.find(
    (c) =>
      c.pointId === pointId &&
      c.id !== excludeId &&
      rangesOverlap(startDate, endDate, c.startDate, closureEffectiveEnd(c)),
  );
}

export type ClosureState = '计划停用' | '停用中' | '已恢复';

/** 停用记录当前状态 */
export function closureState(c: PointClosure, today: string = todayStr()): ClosureState {
  if (today < c.startDate) return '计划停用';
  if (isClosedOn(c, today)) return '停用中';
  return '已恢复';
}

/** 路线上的停用影响：命中的点位、停用记录与受影响的段序 */
export interface ClosureImpact {
  pointId: string;
  closure: PointClosure;
  /** 该点位作为端点出现的段序，升序 */
  orders: number[];
}

/**
 * 按计划通行日期检查一条路线（draft 段或已保存段），
 * 找出落在停用期内的端点及其影响位置；停用解除后重算自然恢复。
 */
export function routeClosureImpacts(
  segments: Pick<RouteSegment, 'fromPointId' | 'toPointId' | 'order'>[],
  closures: PointClosure[],
  planDate: string,
): ClosureImpact[] {
  if (!planDate || !segments.length) return [];
  const closedByPoint = new Map<string, PointClosure>();
  for (const c of closures) {
    if (isClosedOn(c, planDate) && !closedByPoint.has(c.pointId)) {
      closedByPoint.set(c.pointId, c);
    }
  }
  if (!closedByPoint.size) return [];
  const ordersByPoint = new Map<string, number[]>();
  for (const s of segments) {
    for (const pid of [s.fromPointId, s.toPointId]) {
      if (!closedByPoint.has(pid)) continue;
      const list = ordersByPoint.get(pid) ?? [];
      if (!list.includes(s.order)) list.push(s.order);
      ordersByPoint.set(pid, list);
    }
  }
  return [...ordersByPoint.entries()].map(([pointId, orders]) => ({
    pointId,
    closure: closedByPoint.get(pointId) as PointClosure,
    orders: orders.sort((a, b) => a - b),
  }));
}
