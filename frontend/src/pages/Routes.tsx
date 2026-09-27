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
import { buildVerdict, judgeSegment, CURB_FAIL, CURB_PASS } from '../utils/routeCheck';
import { activeOutageOn, routeOutageImpact } from '../utils/outage';
import { todayStr } from '../utils/format';

export default function Routes() {
  const { message } = App.useApp();
  const points = usePointStore((s) => s.points);
  const outages = usePointStore((s) => s.outages);
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
    clearDraftSegments,
    resetDraft,
  } = useRouteStore();
  const [saving, setSaving] = useState(false);

  /** 计划通行日落入停用期的点位不可选，并在选项上标注停用时段 */
  const pointOptions = useMemo(
    () =>
      points.map((p) => {
        const outage = activeOutageOn(outages, p.id, planDate);
        return {
          value: p.id,
          disabled: Boolean(outage),
          label: outage
            ? `${p.code} ${p.name}（${planDate} 停用中，至 ${outage.actualEnd || outage.endDate}）`
            : `${p.code} ${p.name}`,
        };
      }),
    [points, outages, planDate],
  );
  const nameOf = (id: string) => points.find((p) => p.id === id)?.name ?? id;

  const draftVerdict = verdict ?? null;

  /** 切换计划通行日期时，把落入停用期的点位从选点链中剔除 */
  const handlePlanDateChange = (date: dayjs.Dayjs | null) => {
    const next = date ? date.format('YYYY-MM-DD') : todayStr();
    setPlanDate(next);
    const blocked = chain.filter((id) => activeOutageOn(outages, id, next));
    if (blocked.length) {
      setChain(chain.filter((id) => !blocked.includes(id)));
      // 已串联草稿可能引用被停用点位，作废后需重新串联
      if (draftSegments.length) clearDraftSegments();
      message.warning(
        `${next} 处于停用期，已移出选点链：${blocked.map((id) => nameOf(id)).join('、')}，请重新串联路段`,
      );
    }
  };

  const handleBuild = () => {
    if (chain.length < 2) {
      message.warning('请至少选择起点与终点两个点位');
      return;
    }
    const blocked = chain.filter((id) => activeOutageOn(outages, id, planDate));
    if (blocked.length) {
      message.error(
        `以下点位在 ${planDate} 处于停用期，不能进入选点链：${blocked.map((id) => nameOf(id)).join('、')}`,
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
    const blockedIds = new Set(
      chain.filter((id) => activeOutageOn(outages, id, planDate)),
    );
    if (blockedIds.size) {
      message.error(
        `${planDate} 有 ${blockedIds.size} 个点位处于停用期，不能保存：${[...blockedIds]
          .map((id) => nameOf(id))
          .join('、')}`,
      );
      return;
    }
    setSaving(true);
    try {
      const n = await saveRoute();
      message.success(`已保存 ${n} 段路线`);
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

  const renderPointCell = (v: string) => {
    const outage = activeOutageOn(outages, v, planDate);
    return (
      <Space size={4} wrap>
        {nameOf(v)}
        {outage && <Tag color="error" data-testid={`saved-point-blocked-${v}`}>停用</Tag>}
      </Space>
    );
  };

  const savedColumns: ColumnsType<RouteSegment> = [
    { title: '路线名称', dataIndex: 'routeName', width: 200 },
    { title: '段序', dataIndex: 'order', width: 70 },
    { title: '起点', dataIndex: 'fromPointId', render: renderPointCell },
    { title: '终点', dataIndex: 'toPointId', render: renderPointCell },
    { title: '长度(m)', dataIndex: 'length', width: 100 },
    { title: '障碍数', dataIndex: 'obstacleCount', width: 90 },
    { title: '台阶数', dataIndex: 'stepCount', width: 90 },
    { title: '路缘高差(cm)', dataIndex: 'curbHeight', width: 120 },
    {
      title: '可轮椅通行',
      dataIndex: 'wheelchairPassable',
      width: 120,
      render: (v: boolean) => <StatusBadge value={v ? '可通行' : '不可通行'} kind="route" />,
    },
  ];

  const savedVerdicts = useMemo(() => {
    const byName = new Map<string, RouteSegment[]>();
    for (const s of segments) {
      const list = byName.get(s.routeName) ?? [];
      list.push(s);
      byName.set(s.routeName, list);
    }
    const rows: { verdict: RouteVerdict; items: ReturnType<typeof routeOutageImpact>['items'] }[] = [];
    byName.forEach((list, name) => {
      const impact = routeOutageImpact(name, list, outages, points, planDate);
      rows.push({
        verdict: buildVerdict(name, list),
        items: impact.items,
      });
    });
    return rows;
  }, [segments, outages, points, planDate]);

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <h1 className="gb-page-title">通行路线编制</h1>
          <Typography.Text type="secondary">
            先选定计划通行日期：日期落在停用期内的设施不进入选点链；既有路线按该日期复算，命中停用即判为不可通行并给出替代点。
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
                <Col xs={24} md={7}>
                  <Form.Item
                    label="计划通行日期"
                    tooltip="日期落在停用期内的设施不会进入选点链；既有路线也按此日期复算"
                  >
                    <DatePicker
                      id="planDate"
                      value={dayjs(planDate)}
                      onChange={handlePlanDateChange}
                      allowClear={false}
                      style={{ width: '100%' }}
                      data-testid="plan-date"
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={9}>
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
                    value={draftVerdict.passable ? '可通行' : '不可通行'}
                    kind="route"
                    bordered
                  />
                  <Typography.Text strong data-testid="verdict-name">
                    {draftVerdict.routeName}
                  </Typography.Text>
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
                {draftVerdict.passable ? (
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

          <Card
            title={`已编制路线判定（按 ${planDate} 通行日复算）`}
            size="small"
            style={{ marginTop: 16 }}
          >
            {savedVerdicts.length ? (
              <Space direction="vertical" size={12} style={{ width: '100%' }} data-testid="saved-verdicts">
                {savedVerdicts.map(({ verdict: v, items }) => {
                  const blocked = items.length > 0;
                  const passable = v.passable && !blocked;
                  return (
                    <div key={v.routeName}>
                      <Space size={8} wrap>
                        <StatusBadge value={passable ? '可通行' : '不可通行'} kind="route" />
                        <Typography.Text>{v.routeName}</Typography.Text>
                        <Tag>{v.totalLength} m</Tag>
                        <Tag>台阶 {v.totalSteps}</Tag>
                        <Tag>障碍 {v.totalObstacles}</Tag>
                      </Space>
                      {blocked && (
                        <Alert
                          type="error"
                          showIcon
                          style={{ marginTop: 6 }}
                          message={`${planDate} 通行日有 ${items.length} 处点位停用，路线不可通行`}
                          description={
                            <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                              {items.map((it) => (
                                <li key={it.pointId} data-testid={`impact-${v.routeName}-${it.pointId}`}>
                                  第 {it.segmentOrders.join('、')} 段端点「{it.pointName}」停用
                                  （{it.outage.startDate} ~ {it.outage.actualEnd || it.outage.endDate}
                                  {it.outage.actualEnd ? '，已提前恢复' : ''}）
                                  {it.alternateName
                                    ? `，替代点：${it.alternateName}`
                                    : '，未登记替代点'}
                                </li>
                              ))}
                            </ul>
                          }
                        />
                      )}
                    </div>
                  );
                })}
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
