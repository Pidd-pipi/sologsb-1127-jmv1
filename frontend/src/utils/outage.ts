import type { Outage } from '../types/outage';
import type { AccessPoint } from '../types/point';
import type { RouteSegment } from '../types/route';

/**
 * 停用段在某日期是否生效。
 * 实际恢复日（提前恢复）优先于原计划恢复日；起止当日都算停用。
 */
export function outageActiveOn(
  outage: Pick<Outage, 'startDate' | 'endDate' | 'actualEnd'>,
  date: string,
): boolean {
  if (!date) return false;
  if (date < outage.startDate) return false;
  const end = outage.actualEnd || outage.endDate;
  return !end || date <= end;
}

/** 某点位在指定日期是否处于停用期，命中则返回该停用段 */
export function activeOutageOn(
  outages: Outage[],
  pointId: string,
  date: string,
): Outage | undefined {
  return outages.find((o) => o.pointId === pointId && outageActiveOn(o, date));
}

/** 两段日期区间是否重叠（端点相接也算重叠） */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * 同一点位的停用段不允许重叠。
 * 按原计划起止比较：即使旧段提前恢复，原计划占用的时段也不允许再排新段。
 */
export function findOverlap(
  outages: Outage[],
  candidate: Pick<Outage, 'pointId' | 'startDate' | 'endDate'>,
  ignoreId?: string,
): Outage | undefined {
  return outages.find(
    (o) =>
      o.id !== ignoreId &&
      o.pointId === candidate.pointId &&
      rangesOverlap(o.startDate, o.endDate, candidate.startDate, candidate.endDate),
  );
}

export interface OutageImpactItem {
  pointId: string;
  pointName: string;
  outage: Outage;
  alternatePointId: string;
  alternateName: string;
  /** 受影响的段序（该点位作为起点或终点出现的段），升序 */
  segmentOrders: number[];
}

export interface RouteOutageImpact {
  routeName: string;
  items: OutageImpactItem[];
}

/**
 * 既有路线在计划通行日的停用影响：
 * 找出落在停用期内的端点点位、受影响的段序与替代点。
 * 返回空 items 表示该路线在通行日不受停用影响（停用解除后自动恢复）。
 */
export function routeOutageImpact(
  routeName: string,
  segments: Pick<RouteSegment, 'fromPointId' | 'toPointId' | 'order'>[],
  outages: Outage[],
  points: AccessPoint[],
  planDate: string,
): RouteOutageImpact {
  const nameOf = (id: string) => points.find((p) => p.id === id)?.name ?? id;
  const byPoint = new Map<string, OutageImpactItem>();
  for (const seg of segments) {
    for (const pid of [seg.fromPointId, seg.toPointId]) {
      const outage = activeOutageOn(outages, pid, planDate);
      if (!outage) continue;
      let item = byPoint.get(pid);
      if (!item) {
        item = {
          pointId: pid,
          pointName: nameOf(pid),
          outage,
          alternatePointId: outage.alternatePointId,
          alternateName: outage.alternatePointId ? nameOf(outage.alternatePointId) : '',
          segmentOrders: [],
        };
        byPoint.set(pid, item);
      }
      if (!item.segmentOrders.includes(seg.order)) item.segmentOrders.push(seg.order);
    }
  }
  const items = [...byPoint.values()].map((it) => ({
    ...it,
    segmentOrders: it.segmentOrders.sort((a, b) => a - b),
  }));
  return { routeName, items };
}
