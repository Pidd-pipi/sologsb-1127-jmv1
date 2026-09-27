import { create } from 'zustand';
import { db, ensureSeed } from '../db';
import type { AccessPoint, AccessPointDraft } from '../types/point';
import type { Inspection, InspectionDraft } from '../types/inspection';
import type { RectifyPlan, RectifyPlanDraft } from '../types/rectify';
import type { PointClosure, PointClosureDraft } from '../types/closure';
import { makeId, toPlain, todayStr } from '../utils/format';
import { closureEffectiveEnd, findOverlap } from '../utils/closure';

interface PointState {
  points: AccessPoint[];
  inspections: Inspection[];
  rectifies: RectifyPlan[];
  closures: PointClosure[];
  loading: boolean;
  loaded: boolean;
  error: string;
  load: () => Promise<void>;
  addPoint: (draft: AccessPointDraft) => Promise<AccessPoint>;
  addInspection: (draft: InspectionDraft) => Promise<Inspection>;
  addRectify: (draft: RectifyPlanDraft) => Promise<RectifyPlan>;
  updateRectify: (id: string, patch: Partial<RectifyPlan>) => Promise<void>;
  addClosure: (draft: PointClosureDraft) => Promise<PointClosure>;
  liftClosure: (id: string, actualEnd: string) => Promise<void>;
  getPoint: (id: string) => AccessPoint | undefined;
  inspectionsOf: (pointId: string) => Inspection[];
  rectifiesOf: (pointId: string) => RectifyPlan[];
  closuresOf: (pointId: string) => PointClosure[];
}

export const usePointStore = create<PointState>((set, get) => ({
  points: [],
  inspections: [],
  rectifies: [],
  closures: [],
  loading: false,
  loaded: false,
  error: '',

  load: async () => {
    set({ loading: true, error: '' });
    try {
      await ensureSeed();
      const [points, inspections, rectifies, closures] = await Promise.all([
        db.points.toArray(),
        db.inspections.toArray(),
        db.rectifies.toArray(),
        db.closures.toArray(),
      ]);
      set({
        points: points.sort((a, b) => a.code.localeCompare(b.code)),
        inspections: inspections.sort((a, b) => (a.date < b.date ? 1 : -1)),
        rectifies: [...rectifies].sort((a, b) => (a.deadline < b.deadline ? -1 : 1)),
        closures: closures.sort((a, b) => (a.startDate < b.startDate ? 1 : -1)),
        loading: false,
        loaded: true,
      });
    } catch (e) {
      set({ loading: false, loaded: true, error: e instanceof Error ? e.message : String(e) });
    }
  },

  addPoint: async (draft) => {
    const now = new Date().toISOString();
    const point: AccessPoint = toPlain({
      ...draft,
      id: makeId('pt'),
      createdAt: now,
      updatedAt: now,
    });
    await db.points.put(point);
    set((s) => ({ points: [...s.points, point].sort((a, b) => a.code.localeCompare(b.code)) }));
    return point;
  },

  addInspection: async (draft) => {
    const inspection: Inspection = toPlain({
      ...draft,
      id: makeId('ins'),
      createdAt: new Date().toISOString(),
    });
    await db.inspections.put(inspection);
    set((s) => ({
      inspections: [inspection, ...s.inspections].sort((a, b) => (a.date < b.date ? 1 : -1)),
    }));
    // 结论为不合格时自动生成整改条目，形成闭环
    if (inspection.conclusion === '不合格') {
      const exists = get().rectifies.some(
        (r) => r.pointId === inspection.pointId && r.status !== '已整改',
      );
      if (!exists) {
        await get().addRectify({
          pointId: inspection.pointId,
          requirement: `按 ${inspection.date} 核验结论整改：${inspection.problem || '坡度、净宽或占用问题'}`,
          unit: '待指派责任单位',
          deadline: todayStr(),
          recheckDate: '',
          status: '待整改',
        });
      }
    }
    return inspection;
  },

  addRectify: async (draft) => {
    const plan: RectifyPlan = toPlain({
      ...draft,
      id: makeId('rct'),
      createdAt: new Date().toISOString(),
    });
    await db.rectifies.put(plan);
    set((s) => ({
      rectifies: [...s.rectifies, plan].sort((a, b) => (a.deadline < b.deadline ? -1 : 1)),
    }));
    return plan;
  },

  updateRectify: async (id, patch) => {
    const plain = toPlain(patch);
    await db.rectifies.update(id, plain);
    set((s) => ({
      rectifies: s.rectifies.map((r) => (r.id === id ? { ...r, ...plain } : r)),
    }));
  },

  /** 登记停用：同一点位的停用段（按有效截止日）不允许重叠 */
  addClosure: async (draft) => {
    if (!draft.startDate || !draft.endDate) {
      throw new Error('请选择停用起止日期');
    }
    if (draft.endDate < draft.startDate) {
      throw new Error('计划恢复日期不能早于停用开始日期');
    }
    const conflict = findOverlap(get().closures, draft.pointId, draft.startDate, draft.endDate);
    if (conflict) {
      throw new Error(
        `停用段与既有记录（${conflict.startDate} ~ ${closureEffectiveEnd(conflict)}）重叠，请调整日期`,
      );
    }
    const closure: PointClosure = toPlain({
      ...draft,
      id: makeId('cls'),
      createdAt: new Date().toISOString(),
    });
    await db.closures.put(closure);
    set((s) => ({
      closures: [...s.closures, closure].sort((a, b) => (a.startDate < b.startDate ? 1 : -1)),
    }));
    return closure;
  },

  /** 提前恢复：只登记实际恢复日期，原计划恢复日期保留备查 */
  liftClosure: async (id, actualEnd) => {
    const target = get().closures.find((c) => c.id === id);
    if (!target) throw new Error('未找到停用记录');
    if (!actualEnd) throw new Error('请选择实际恢复日期');
    if (actualEnd < target.startDate) {
      throw new Error('实际恢复日期不能早于停用开始日期');
    }
    await db.closures.update(id, { actualEnd });
    set((s) => ({
      closures: s.closures.map((c) => (c.id === id ? { ...c, actualEnd } : c)),
    }));
  },

  getPoint: (id) => get().points.find((p) => p.id === id),

  inspectionsOf: (pointId) =>
    get()
      .inspections.filter((i) => i.pointId === pointId)
      .sort((a, b) => (a.date < b.date ? 1 : -1)),

  rectifiesOf: (pointId) =>
    get()
      .rectifies.filter((r) => r.pointId === pointId)
      .sort((a, b) => (a.deadline < b.deadline ? -1 : 1)),

  closuresOf: (pointId) =>
    get()
      .closures.filter((c) => c.pointId === pointId)
      .sort((a, b) => (a.startDate < b.startDate ? 1 : -1)),
}));
