import { useMemo, useState } from 'react';
import {
  App,
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DeleteOutlined, NodeIndexOutlined, SaveOutlined, ThunderboltOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import StatusBadge from '../components/common/StatusBadge';
import EmptyState from '../components/common/EmptyState';
import { usePointStore } from '../stores/pointStore';
import { useRouteStore, type DraftSegment } from '../stores/routeStore';
import type { RouteSegment, RouteVerdict } from '../types/route';
import type { PointClosure } from '../types/closure';
import { buildVerdict, judgeSegment, CURB_FAIL, CURB_PASS } from '../utils/routeCheck';
import {
  closureEffectiveEnd,
  isClosedOn,
  routeClosureImpacts,
  type ClosureImpact,
} from '../utils/closure';
import { todayStr } from '../utils/format';

export default function Routes() {
  const { message } = App.useApp();
  const points = usePointStore((s) => s.points);
  const closures = usePointStore((s) => s.closures);
  const {
    segments,
    draftName,
    planDate,
    chain,
    draftSegments,
    verdict,
    setDraftName,
    setPlanDate,
    setChain,
    buildChainSegments,
    updateDraftSegment,
    removeDraftSegment,
    computeVerdict,
    saveRoute,
    resetDraft,
  } = useRouteStore();
  const [saving, setSaving] = useState(false);

  /** 计划通行日期当天处于停用期的点位 */
  const closedOnPlan = useMemo(() => {
    const map = new Map<string, PointClosure>();
    for (const c of closures) {
      if (isClosedOn(c, planDate) && !map.has(c.pointId)) map.set(c.pointId, c);
    }
    return map;
  }, [closures, planDate]);

  const pointOptions = useMemo(
    () =>
      points.map((p) => {
        const cl = closedOnPlan.get(p.id);
        return {
          value: p.id,
          label: cl
            ? `${p.code} ${p.name}（${planDate} 停用，至 ${closureEffectiveEnd(cl)}）`
            : `${p.code} ${p.name}`,
          disabled: Boolean(cl),
        };
      }),
    [points, closedOnPlan, planDate],
  );
  const nameOf = (id: string) => points.find((p) => p.id === id)?.name ?? id;

  /** 选点链中仍残留的停用点（例如改日期后未重选） */
  const chainClosedIds = useMemo(() => chain.filter((id) => closedOnPlan.has(id)), [chain, closedOnPlan]);

  /** 编制中路段的停用影响 */
  const draftImpacts = useMemo(
    () => routeClosureImpacts(draftSegments, closures, planDate),
    [draftSegments, closures, planDate],
  );

  const impactText = (imp: ClosureImpact, date: string) => {
    const alt = imp.closure.alternatePointId ? nameOf(imp.closure.alternatePointId) : '';
    return (
      `第 ${imp.orders.join('、')} 段端点「${nameOf(imp.pointId)}」在 ${date} 处于停用期` +
      `（${imp.closure.startDate} ~ ${closureEffectiveEnd(imp.closure)}` +
      `${imp.closure.reason ? `，${imp.closure.reason}` : ''}）` +
      (alt ? `，替代点：${alt}` : '，未登记替代点')
    );
  };

  const draftVerdict = verdict ?? null;
  const draftBlocked = draftImpacts.length > 0;

  const handleBuild = () => {
    if (chain.length < 2) {
      message.warning('请至少选择起点与终点两个点位');
      return;
    }
    if (chainClosedIds.length) {
      message.error(
        `计划通行日期 ${planDate} 内「${chainClosedIds.map(nameOf).join('、')}」停用，请改选替代点`,
      );
      return;
    }
    buildChainSegments(points);
    message.success(`已自动串联 ${chain.length - 1} 段路段`);
  };

  const handleSave = async () => {
    if (!draftSegments.length) {
      message.warning('请先串联路段');
      return;
    }
    if (draftBlocked) {
      message.error('计划通行日期内有点位停用，请调整日期或改选替代点后再保存');
      return;
    }
    setSaving(true);
    try {
      const n = await saveRoute();
      message.success(`已保存 ${n} 段路线（计划通行日期 ${planDate}）`);
      resetDraft();
    } catch (e) {
      message.error(`路线保存失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const draftColumns: ColumnsType<DraftSegment> = [
    { title: '段序', dataIndex: 'order', width: 60 },
    { title: '起点', dataIndex: 'fromPointId', render: (v: string) => nameOf(v) },
    { title: '终点', dataIndex: 'toPointId', render: (v: string) => nameOf(v) },
    {
      title: '长度(m)',
      dataIndex: 'length',
      width: 110,
      render: (v: number, row) => (
        <InputNumber
          aria-label={`长度-${row.order}`}
          min={1}
          max={100000}
          value={v}
          onChange={(nv) => updateDraftSegment(row.key, { length: Number(nv ?? 0) })}
          style={{ width: 100 }}
        />
      ),
    },
    {
      title: '沿途障碍数',
      dataIndex: 'obstacleCount',
      width: 120,
      render: (v: number, row) => (
        <InputNumber
          aria-label={`障碍数-${row.order}`}
          min={0}
          max={50}
          value={v}
          onChange={(nv) => updateDraftSegment(row.key, { obstacleCount: Number(nv ?? 0) })}
          style={{ width: 100 }}
        />
      ),
    },
    {
      title: '台阶数',
      dataIndex: 'stepCount',
      width: 110,
      render: (v: number, row) => (
        <InputNumber
          aria-label={`台阶数-${row.order}`}
          min={0}
          max={50}
          value={v}
          onChange={(nv) => updateDraftSegment(row.key, { stepCount: Number(nv ?? 0) })}
          style={{ width: 100 }}
        />
      ),
    },
    {
      title: '路缘高差(cm)',
      dataIndex: 'curbHeight',
      width: 130,
      render: (v: number, row) => (
        <InputNumber
          aria-label={`路缘高差-${row.order}`}
          min={0}
          max={60}
          step={0.5}
          value={v}
          onChange={(nv) => updateDraftSegment(row.key, { curbHeight: Number(nv ?? 0) })}
          style={{ width: 110 }}
        />
      ),
    },
    {
      title: '段判定',
      width: 110,
      render: (_, row) => (
        <StatusBadge value={judgeSegment(row).passable ? '可通行' : '不可通行'} kind="route" />
      ),
    },
    {
      title: '操作',
      width: 80,
      render: (_, row) => (
        <Button
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={() => removeDraftSegment(row.key)}
          data-testid={`remove-segment-${row.order}`}
        />
      ),
    },
  ];

  const savedColumns: ColumnsType<RouteSegment> = [
    { title: '路线名称', dataIndex: 'routeName', width: 200 },
    { title: '段序', dataIndex: 'order', width: 70 },
    { title: '起点', dataIndex: 'fromPointId', render: (v: string) => nameOf(v) },
    { title: '终点', dataIndex: 'toPointId', render: (v: string) => nameOf(v) },
    { title: '长度(m)', dataIndex: 'length', width: 100 },
    { title: '障碍数', dataIndex: 'obstacleCount', width: 90 },
    { title: '台阶数', dataIndex: 'stepCount', width: 90 },
    { title: '路缘高差(cm)', dataIndex: 'curbHeight', width: 120 },
    {
      title: '计划通行日期',
      dataIndex: 'planDate',
      width: 130,
      render: (v: string) => v || <Typography.Text type="secondary">未指定</Typography.Text>,
    },
    {
      title: '可轮椅通行',
      dataIndex: 'wheelchairPassable',
      width: 120,
      render: (v: boolean) => <StatusBadge value={v ? '可通行' : '不可通行'} kind="route" />,
    },
  ];

  /** 已保存路线按各自的计划通行日期（历史数据回退为今天）做停用影响判定 */
  const savedRows = useMemo(() => {
    const byName = new Map<string, RouteSegment[]>();
    for (const s of segments) {
      const list = byName.get(s.routeName) ?? [];
      list.push(s);
      byName.set(s.routeName, list);
    }
    const rows: { verdict: RouteVerdict; impacts: ClosureImpact[]; date: string }[] = [];
    byName.forEach((list, name) => {
      const date = list.find((s) => s.planDate)?.planDate || todayStr();
      rows.push({
        verdict: buildVerdict(name, list),
        impacts: routeClosureImpacts(list, closures, date),
        date,
      });
    });
    return rows;
  }, [segments, closures]);

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <h1 className="gb-page-title">通行路线编制</h1>
          <Typography.Text type="secondary">
            选定计划通行日期后选点自动串联路段；落在停用期内的点位不可选，已保存路线按计划日期重算通行性。
          </Typography.Text>
        </div>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card title="路线编制" size="small">
            <Form layout="vertical">
              <Row gutter={12}>
                <Col xs={24} md={8}>
                  <Form.Item label="路线名称">
                    <Input
                      id="routeName"
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      placeholder="如 东单—王府井轮椅通道"
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={6}>
                  <Form.Item label="计划通行日期">
                    <DatePicker
                      id="planDate"
                      style={{ width: '100%' }}
                      value={planDate ? dayjs(planDate) : null}
                      onChange={(d) => setPlanDate(d ? d.format('YYYY-MM-DD') : '')}
                      allowClear={false}
                      data-testid="plan-date"
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={10}>
                  <Form.Item label="按顺序选择点位（起点 → 途经 → 终点）">
                    <Select
                      id="chain"
                      mode="multiple"
                      value={chain}
                      onChange={(v) => setChain(v)}
                      options={pointOptions}
                      placeholder="先选起点，再依次选择终点"
                      style={{ width: '100%' }}
                      maxTagCount={3}
                    />
                  </Form.Item>
                </Col>
              </Row>
              {chainClosedIds.length ? (
                <Alert
                  type="error"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message={`计划通行日期 ${planDate} 内有点位停用`}
                  description={`「${chainClosedIds
                    .map(nameOf)
                    .join('、')}」在 ${planDate} 处于停用期，请从选点链中移除并改选替代点。`}
                  data-testid="chain-closed-alert"
                />
              ) : null}
              <Space wrap>
                <Button
                  type="primary"
                  icon={<NodeIndexOutlined />}
                  onClick={handleBuild}
                  data-testid="build-route"
                >
                  自动串联路段
                </Button>
                <Button
                  icon={<ThunderboltOutlined />}
                  onClick={() => {
                    if (!draftSegments.length) {
                      message.warning('请先串联路段');
                      return;
                    }
                    computeVerdict();
                  }}
                  data-testid="compute-verdict"
                >
                  输出全线判定
                </Button>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  loading={saving}
                  onClick={handleSave}
                  data-testid="save-route"
                >
                  保存路线
                </Button>
                <Button onClick={resetDraft} data-testid="reset-route">
                  清空编制
                </Button>
              </Space>
            </Form>

            <div style={{ marginTop: 16 }} data-testid="draft-segments">
              {draftSegments.length ? (
                <Table<DraftSegment>
                  rowKey="key"
                  size="small"
                  pagination={false}
                  dataSource={draftSegments}
                  columns={draftColumns}
                />
              ) : (
                <EmptyState
                  title="尚未串联路段"
                  description="选择至少两个点位后点击「自动串联路段」"
                  compact
                />
              )}
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card title="全线判定" size="small" data-testid="verdict-card">
            {draftVerdict ? (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Space size={8} wrap>
                  <StatusBadge
                    value={draftVerdict.passable && !draftBlocked ? '可通行' : '不可通行'}
                    kind="route"
                    bordered
                  />
                  <Typography.Text strong data-testid="verdict-name">
                    {draftVerdict.routeName}
                  </Typography.Text>
                  <Tag>计划通行 {planDate}</Tag>
                </Space>
                <Row gutter={12}>
                  <Col span={12}>
                    <Statistic title="全线长度" value={draftVerdict.totalLength} suffix="m" />
                  </Col>
                  <Col span={12}>
                    <Statistic title="沿途障碍" value={draftVerdict.totalObstacles} suffix="处" />
                  </Col>
                  <Col span={12}>
                    <Statistic title="台阶总数" value={draftVerdict.totalSteps} suffix="级" />
                  </Col>
                  <Col span={12}>
                    <Statistic title="最大路缘高差" value={draftVerdict.maxCurbHeight} suffix="cm" />
                  </Col>
                </Row>
                {draftVerdict.passable && !draftBlocked ? (
                  <Alert type="success" showIcon message="全线满足轮椅通行条件" />
                ) : (
                  <Alert
                    type="warning"
                    showIcon
                    message="存在不可通行路段"
                    description={
                      <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                        {draftVerdict.reasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                        {draftImpacts.map((imp) => (
                          <li key={`closure-${imp.pointId}`}>{impactText(imp, planDate)}</li>
                        ))}
                      </ul>
                    }
                  />
                )}
                <Typography.Text type="secondary" className="gb-muted">
                  判定阈值：路缘高差 ≤ {CURB_PASS}cm 可通行，&gt; {CURB_FAIL}cm 判定不可通行；存在台阶即需绕行。
                </Typography.Text>
              </Space>
            ) : (
              <EmptyState
                title="尚未输出判定"
                description="串联路段并填写实测值后点击「输出全线判定」"
                compact
              />
            )}
          </Card>

          <Card title="已编制路线判定" size="small" style={{ marginTop: 16 }}>
            {savedRows.length ? (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {savedRows.map(({ verdict: v, impacts, date }) => (
                  <div key={v.routeName}>
                    <Space size={8} wrap>
                      <StatusBadge
                        value={v.passable && !impacts.length ? '可通行' : '不可通行'}
                        kind="route"
                      />
                      <Typography.Text>{v.routeName}</Typography.Text>
                      <Tag>计划通行 {date}</Tag>
                      <Tag>{v.totalLength} m</Tag>
                      <Tag>台阶 {v.totalSteps}</Tag>
                      <Tag>障碍 {v.totalObstacles}</Tag>
                    </Space>
                    {impacts.length ? (
                      <Alert
                        type="error"
                        showIcon
                        style={{ marginTop: 8 }}
                        message="路线受点位停用影响，判为不可通行"
                        description={
                          <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                            {impacts.map((imp) => (
                              <li key={`saved-closure-${imp.pointId}`}>{impactText(imp, date)}</li>
                            ))}
                          </ul>
                        }
                        data-testid={`saved-impacts-${v.routeName}`}
                      />
                    ) : null}
                  </div>
                ))}
              </Space>
            ) : (
              <EmptyState title="暂无已保存路线" compact />
            )}
          </Card>
        </Col>
      </Row>

      <Card title="已保存路段明细" size="small" style={{ marginTop: 16 }}>
        {segments.length ? (
          <Table<RouteSegment>
            rowKey="id"
            size="small"
            pagination={{ pageSize: 8, hideOnSinglePage: true }}
            dataSource={segments}
            columns={savedColumns}
          />
        ) : (
          <EmptyState title="暂无路段记录" description="编制并保存后在此查看" compact />
        )}
      </Card>
    </div>
  );
}
