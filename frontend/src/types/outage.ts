/** 点位停用期（施工等原因临时停用登记） */
export interface Outage {
  id: string;
  pointId: string;
  /** 停用开始日期 YYYY-MM-DD */
  startDate: string;
  /** 原计划恢复日期 YYYY-MM-DD；提前恢复时仍保留原计划 */
  endDate: string;
  /** 停用原因 */
  reason: string;
  /** 替代点位 id，可为空字符串表示未指定 */
  alternatePointId: string;
  /** 实际恢复日期；空表示尚未恢复。提前恢复时填写，endDate 不动 */
  actualEnd: string;
  createdAt: string;
}

export type OutageDraft = Omit<Outage, 'id' | 'createdAt'>;
