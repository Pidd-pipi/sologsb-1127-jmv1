/** 点位停用记录（施工等原因临时停用，登记替代点） */
export interface PointClosure {
  id: string;
  pointId: string;
  /** 停用开始日期 YYYY-MM-DD */
  startDate: string;
  /** 计划恢复日期 YYYY-MM-DD；提前恢复后仍保留原计划 */
  endDate: string;
  /** 实际恢复日期 YYYY-MM-DD，提前解除停用时登记；为空表示尚未恢复 */
  actualEnd: string;
  /** 替代点位 id，未登记为空字符串 */
  alternatePointId: string;
  /** 停用原因，如路口施工 */
  reason: string;
  createdAt: string;
}

export type PointClosureDraft = Omit<PointClosure, 'id' | 'createdAt'>;
