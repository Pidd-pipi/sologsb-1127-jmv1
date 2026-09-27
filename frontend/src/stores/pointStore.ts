import { create } from 'zustand';
import { db, ensureSeed } from '../db';
import type { AccessPoint, AccessPointDraft } from '../types/point';
import type { Inspection, InspectionDraft } from '../types/inspection';
import type { RectifyPlan, RectifyPlanDraft } from '../types/rectify';
import type { Outage, OutageDraft } from '../types/outage';
import { makeId, toPlain, todayStr } from '../utils/format';
import { findOverlap } from '../utils/outage';

interface PointState {
  points: AccessPoint[];
  inspections: Inspection[];
  rectifies: RectifyPlan[];
  outages: Outage[];
  loading: boolean;
  loaded: boolean;
  error: string;
  load: () => Promise<void>;
  addPoint: (draft: AccessPointDraft) => Promise<AccessPoint>;
  addInspection: (draft: InspectionDraft) => Promise<Inspection>;
  addRectify: (draft: RectifyPlanDraft) => Promise<RectifyPlan>;
  updateRectify: (id: string, patch: Partial<RectifyPlan>) => Promise<void>;
  addOutage: (draft: OutageDraft) => Promise<Outage>;
  liftOutage: (id: string, actualEnd?: string) => Promise<void>;
  getPoint: (id: string) => AccessPoint | undefined;
  inspectionsOf: (pointId: string) => Inspection[];
  rectifiesOf: (pointId: string) => RectifyPlan[];
  outagesOf: (pointId: string) => Outage[];
}

export const usePointStore = create<PointState>((set, get) => ({
  points: [],
  inspections: [],
  rectifies: [],
  outages: [],
  loading: false,
  loaded: false,
  error: '',

  load: async () => {
    set({ loading: true, error: '' });
    try {
      await ensureSeed();
      const [points, inspections, rectifies, outages] = await Promise.all([
        db.points.toArray(),
        db.inspections.toArray(),
        db.rectifies.toArray(),
        db.outages.toArray(),
      ]);
      set({
        points: points.sort((a, b) => a.code.localeCompare(b.code)),
        inspections: inspections.sort((a, b) => (a.date < b.date ? 1 : -1)),
        rectifies: [...rectifies].sort((a, b) => (a.deadline < b.deadline ? -1 : 1)),
        outages: outages.sort((a, b) => (a.startDate < b.startDate ? 1 : -1)),
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

  addOutage: async (draft) => {
    if (!draft.startDate || !draft.endDate) {
      throw new Error('请填写停用开始与计划恢复日期');
    }
    if (draft.endDate < draft.startDate) {
      throw new Error('计划恢复日期不能早于停用开始日期');
    }
    // 同一点位的停用段不允许重叠（按原计划起止比较）
    const conflict = findOverlap(get().outages, draft);
    if (conflict) {
      throw new Error(`与既有停用段 ${conflict.startDate} ~ ${conflict.endDate} 重叠`);
    }
    const outage: Outage = toPlain({
      ...draft,
      id: makeId('out'),
      createdAt: new Date().toISOString(),
    });
    await db.outages.put(outage);
    set((s) => ({
      outages: [...s.outages, outage].sort((a, b) => (a.startDate < b.startDate ? 1 : -1)),
    }));
    return outage;
  },

  /** 解除停用：只写实际恢复日，原计划恢复日保留备查 */
  liftOutage: async (id, actualEnd) => {
    const outage = get().outages.find((o) => o.id === id);
    if (!outage) throw new Error('未找到该停用记录');
    const end = actualEnd || todayStr();
    if (end < outage.startDate) {
      throw new Error('实际恢复日期不能早于停用开始日期');
    }
    await db.outages.update(id, { actualEnd: end });
    set((s) => ({
      outages: s.outages.map((o) => (o.id === id ? { ...o, actualEnd: end } : o)),
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

  outagesOf: (pointId) =>
    get()
      .outages.filter((o) => o.pointId === pointId)
      .sort((a, b) => (a.startDate < b.startDate ? 1 : -1)),
}));
