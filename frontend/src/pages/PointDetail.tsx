import { useMemo, useState } from 'react';
import {
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Divider,
  Form,
  Input,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, SaveOutlined, ReloadOutlined } from '@ant-design/icons';
import { Link, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import MapPanel from '../components/common/MapPanel';
import MeasureInput from '../components/common/MeasureInput';
import StatusBadge from '../components/common/StatusBadge';
import FacilityIcon from '../components/common/FacilityIcon';
import EmptyState from '../components/common/EmptyState';
import { usePointStore } from '../stores/pointStore';
import { OCCUPIED_LEVELS, type Inspection, type OccupiedLevel } from '../types/inspection';
import type { RectifyPlan } from '../types/rectify';
import type { Outage } from '../types/outage';
import { judgeInspection } from '../utils/routeCheck';
import { addDays, isOverdue, todayStr } from '../utils/format';
import { outageActiveOn } from '../utils/outage';

interface InlineInspection {
  date: string;
  inspector: string;
  slope: number;
  clearWidth: number;
  hasHandrail: boolean;
  tactileContinuous: boolean;
  occupied: OccupiedLevel;
  problem: string;
}

interface OutageForm {
  startDate: string;
  endDate: string;
  reason: string;
  alternatePointId: string;
}

export default function PointDetail() {
  const { id = '' } = useParams();
  const { message } = App.useApp();
  const points = usePointStore((s) => s.points);
  const inspections = usePointStore((s) => s.inspections);
  const rectifies = usePointStore((s) => s.rectifies);
  const outages = usePointStore((s) => s.outages);
  const loaded = usePointStore((s) => s.loaded);
  const addInspection = usePointStore((s) => s.addInspection);
  const addRectify = usePointStore((s) => s.addRectify);
  const addOutage = usePointStore((s) => s.addOutage);
  const liftOutage = usePointStore((s) => s.liftOutage);

  const point = useMemo(() => points.find((p) => p.id === id), [points, id]);
  const history = useMemo(
    () =>
      inspections
        .filter((i) => i.pointId === id)
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [inspections, id],
  );
  const plans = useMemo(
    () =>
      rectifies.filter((r) => r.pointId === id).sort((a, b) => (a.deadline < b.deadline ? -1 : 1)),
    [rectifies, id],
  );

  const [form, setForm] = useState<InlineInspection>(() => ({
    date: todayStr(),
    inspector: '督导员 李维',
    slope: 2.5,
    clearWidth: 150,
    hasHandrail: true,
    tactileContinuous: true,
    occupied: '无',
    problem: '',
  }));
  const [saving, setSaving] = useState(false);

  const pointOutages = useMemo(
    () =>
      outages
        .filter((o) => o.pointId === id)
        .sort((a, b) => (a.startDate < b.startDate ? 1 : -1)),
    [outages, id],
  );
  const [outageForm, setOutageForm] = useState<OutageForm>(() => ({
    startDate: todayStr(),
    endDate: addDays(todayStr(), 30),
    reason: '',
    alternatePointId: '',
  }));

  const judgement = useMemo(
    () =>
      judgeInspection({
        slope: form.slope,
        clearWidth: form.clearWidth,
        hasHandrail: form.hasHandrail,
        tactileContinuous: form.tactileContinuous,
        occupied: form.occupied,
      }),
    [form],
  );

  if (!loaded) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin size="large" />
        <div style={{ marginTop: 12 }}>
          <Typography.Text type="secondary">正在读取本地点位数据…</Typography.Text>
        </div>
      </div>
    );
  }

  if (!point) {
    return (
      <EmptyState
        title={`未找到点位 ${id}`}
        description="该点位可能已被删除，请返回总览重新选择"
        extra={
          <Link to="/">
            <Button type="primary">返回核验总览</Button>
          </Link>
        }
      />
    );
  }

  const handleSaveInspection = async () => {
    setSaving(true);
    try {
      await addInspection({
        pointId: point.id,
        date: form.date || todayStr(),
        inspector: form.inspector.trim() || '未署名督导员',
        slope: form.slope,
        clearWidth: form.clearWidth,
        hasHandrail: form.hasHandrail,
        tactileContinuous: form.tactileContinuous,
        occupied: form.occupied,
        conclusion: judgement.conclusion,
        problem: form.problem.trim(),
      });
      message.success(`已新增核验记录（${judgement.conclusion}）`);
      setForm((cur) => ({ ...cur, problem: '', date: todayStr() }));
    } catch (e) {
      message.error(`核验记录保存失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateRectify = async () => {
    try {
      await addRectify({
        pointId: point.id,
        requirement: judgement.conclusion === '合格' ? '保持现状，纳入下一轮复核' : judgement.reasons.join('；'),
        unit: point.maintainUnit,
        deadline: addDays(todayStr(), 30),
        recheckDate: '',
        status: '待整改',
      });
      message.success('已生成整改条目');
    } catch (e) {
      message.error(`整改条目创建失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const outageStatusOf = (o: Outage): string => {
    if (o.actualEnd) return '已恢复';
    return outageActiveOn(o, todayStr()) ? '停用中' : '已结束';
  };

  const handleAddOutage = async () => {
    if (!outageForm.startDate || !outageForm.endDate) {
      message.warning('请选择停用开始与计划恢复日期');
      return;
    }
    if (outageForm.endDate < outageForm.startDate) {
      message.warning('计划恢复日期不能早于停用开始日期');
      return;
    }
    try {
      await addOutage({
        pointId: point.id,
        startDate: outageForm.startDate,
        endDate: outageForm.endDate,
        reason: outageForm.reason.trim() || '施工停用',
        alternatePointId: outageForm.alternatePointId,
        actualEnd: '',
      });
      message.success('已登记停用期，停用期间该点位不进入路线选点链');
      setOutageForm((c) => ({ ...c, reason: '', alternatePointId: '' }));
    } catch (e) {
      message.error(`停用期登记失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleLiftOutage = async (o: Outage) => {
    try {
      await liftOutage(o.id);
      message.success('已记录实际恢复，原计划恢复日期保留；相关路线将按通行日重新计算');
    } catch (e) {
      message.error(`解除停用失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const outageColumns: ColumnsType<Outage> = [
    { title: '停用开始', dataIndex: 'startDate', width: 110 },
    {
      title: '原计划恢复',
      dataIndex: 'endDate',
      width: 110,
      render: (v: string) => <Typography.Text delete={false}>{v}</Typography.Text>,
    },
    {
      title: '实际恢复',
      dataIndex: 'actualEnd',
      width: 170,
      render: (v: string, row) =>
        v ? (
          <Space size={4}>
            {v}
            {v < row.endDate && <Tag color="warning">提前恢复</Tag>}
          </Space>
        ) : (
          <Typography.Text type="secondary">未恢复</Typography.Text>
        ),
    },
    {
      title: '状态',
      width: 90,
      render: (_, row) => <StatusBadge value={outageStatusOf(row)} kind="generic" />,
    },
    {
      title: '替代点',
      dataIndex: 'alternatePointId',
      width: 200,
      render: (v: string) =>
        v ? (
          <Link to={`/points/${v}`}>{points.find((p) => p.id === v)?.name ?? v}</Link>
        ) : (
          <Typography.Text type="secondary">未指定</Typography.Text>
        ),
    },
    { title: '停用原因', dataIndex: 'reason', ellipsis: true },
    {
      title: '操作',
      width: 100,
      render: (_, row) =>
        row.actualEnd ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          <Popconfirm
            title="确认该点位已恢复使用？"
            description="将记录实际恢复日，原计划恢复日期保留备查。"
            onConfirm={() => handleLiftOutage(row)}
            okText="确认恢复"
            cancelText="取消"
          >
            <Button size="small" type="link" data-testid={`lift-outage-${row.id}`}>
              解除停用
            </Button>
          </Popconfirm>
        ),
    },
  ];

  const inspectionColumns: ColumnsType<Inspection> = [
    { title: '核验日期', dataIndex: 'date', width: 120, sorter: (a, b) => (a.date < b.date ? -1 : 1) },
    { title: '核验人', dataIndex: 'inspector', width: 130 },
    { title: '坡度', dataIndex: 'slope', width: 80, render: (v: number) => `${v}%` },
    { title: '净宽', dataIndex: 'clearWidth', width: 90, render: (v: number) => `${v} cm` },
    { title: '扶手', dataIndex: 'hasHandrail', width: 70, render: (v: boolean) => (v ? '有' : '无') },
    {
      title: '盲道',
      dataIndex: 'tactileContinuous',
      width: 80,
      render: (v: boolean) => (v ? '连续' : '断续'),
    },
    { title: '占用情况', dataIndex: 'occupied', width: 100 },
    {
      title: '结论',
      dataIndex: 'conclusion',
      width: 110,
      render: (v: string) => <StatusBadge value={v} kind="conclusion" />,
    },
    {
      title: '问题描述',
      dataIndex: 'problem',
      ellipsis: true,
      render: (v: string) => v || <Typography.Text type="secondary">无</Typography.Text>,
    },
  ];

  const rectifyColumns: ColumnsType<RectifyPlan> = [
    { title: '整改要求', dataIndex: 'requirement', ellipsis: true },
    { title: '责任单位', dataIndex: 'unit', width: 170 },
    {
      title: '整改期限',
      dataIndex: 'deadline',
      width: 130,
      render: (d: string, row) =>
        isOverdue(d, row.status) ? (
          <Space size={4}>
            {d}
            <Tag color="error">逾期</Tag>
          </Space>
        ) : (
          d
        ),
    },
    {
      title: '复检日期',
      dataIndex: 'recheckDate',
      width: 120,
      render: (v: string) => v || <Typography.Text type="secondary">未复检</Typography.Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => <StatusBadge value={v} kind="rectify" />,
    },
  ];

  const latest = history[0];

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <Space size={10} align="center">
            <FacilityIcon type={point.facilityType} size={26} />
            <h1 className="gb-page-title" data-testid="point-name">
              {point.name}
            </h1>
            <StatusBadge value={latest?.conclusion ?? '未核验'} kind="conclusion" bordered />
          </Space>
          <Typography.Text type="secondary">
            {point.code} · {point.district} · {point.location || '未填写所在道路或建筑'}
          </Typography.Text>
        </div>
        <Space>
          <Link to="/map">
            <Button>在地图中查看</Button>
          </Link>
          <Link to="/points/new">
            <Button type="primary" icon={<PlusOutlined />}>
              登记新点位
            </Button>
          </Link>
        </Space>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <MapPanel points={[point]} selectedId={point.id} height={380} title="点位定位与周边" />
        </Col>
        <Col xs={24} lg={10}>
          <Card title="点位属性" size="small">
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="点位编号">{point.code}</Descriptions.Item>
              <Descriptions.Item label="设施类型">
                <FacilityIcon type={point.facilityType} withLabel />
              </Descriptions.Item>
              <Descriptions.Item label="行政区">{point.district}</Descriptions.Item>
              <Descriptions.Item label="所在道路或建筑">{point.location || '—'}</Descriptions.Item>
              <Descriptions.Item label="建成年代">{point.builtYear} 年</Descriptions.Item>
              <Descriptions.Item label="养护单位">{point.maintainUnit}</Descriptions.Item>
              <Descriptions.Item label="经纬度">
                {point.lng.toFixed(6)}, {point.lat.toFixed(6)}
              </Descriptions.Item>
              <Descriptions.Item label="核验次数">{history.length} 次</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={14}>
          <Card
            title="核验历史"
            size="small"
            extra={
              <Typography.Text type="secondary" className="gb-muted">
                共 {history.length} 条
              </Typography.Text>
            }
          >
            {history.length ? (
              <Table<Inspection>
                rowKey="id"
                size="small"
                pagination={{ pageSize: 5, hideOnSinglePage: true }}
                dataSource={history}
                columns={inspectionColumns}
              />
            ) : (
              <EmptyState title="暂无核验记录" description="在右侧录入实测值即可生成第一条记录" compact />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card title="就地新增核验" size="small">
            <Form layout="vertical">
              <Row gutter={12}>
                <Col xs={24} md={12}>
                  <MeasureInput
                    label="坡度"
                    value={form.slope}
                    onChange={(v) => setForm((c) => ({ ...c, slope: v }))}
                    unit="%"
                    pass={5}
                    fail={8}
                    direction="max"
                    min={0}
                    max={100}
                    hint="纵坡不应大于 5%，超过 8% 判定不合格"
                  />
                </Col>
                <Col xs={24} md={12}>
                  <MeasureInput
                    label="净宽"
                    value={form.clearWidth}
                    onChange={(v) => setForm((c) => ({ ...c, clearWidth: v }))}
                    unit="cm"
                    pass={120}
                    fail={90}
                    direction="min"
                    min={0}
                    max={500}
                    step={1}
                    hint="净宽不应小于 120cm，小于 90cm 判定不合格"
                  />
                </Col>
                <Col xs={12} md={8}>
                  <Form.Item label="扶手">
                    <Switch
                      checked={form.hasHandrail}
                      onChange={(v) => setForm((c) => ({ ...c, hasHandrail: v }))}
                      checkedChildren="有"
                      unCheckedChildren="无"
                      data-testid="detail-switch-handrail"
                    />
                  </Form.Item>
                </Col>
                <Col xs={12} md={8}>
                  <Form.Item label="盲道连续">
                    <Switch
                      checked={form.tactileContinuous}
                      onChange={(v) => setForm((c) => ({ ...c, tactileContinuous: v }))}
                      checkedChildren="连续"
                      unCheckedChildren="断续"
                      data-testid="detail-switch-tactile"
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item label="被占用情况">
                    <Select
                      value={form.occupied}
                      onChange={(v) => setForm((c) => ({ ...c, occupied: v }))}
                      options={OCCUPIED_LEVELS.map((o) => ({ value: o, label: o }))}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item label="核验人">
                    <Input
                      id="detail-inspector"
                      value={form.inspector}
                      onChange={(e) => setForm((c) => ({ ...c, inspector: e.target.value }))}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item label="结论建议">
                    <Space data-testid="detail-suggested-conclusion">
                      <StatusBadge value={judgement.conclusion} kind="conclusion" bordered />
                      <Typography.Text type="secondary" className="gb-muted">
                        {judgement.reasons[0]}
                      </Typography.Text>
                    </Space>
                  </Form.Item>
                </Col>
                <Col span={24}>
                  <Form.Item label="问题描述">
                    <Input.TextArea
                      id="detail-problem"
                      rows={2}
                      value={form.problem}
                      onChange={(e) => setForm((c) => ({ ...c, problem: e.target.value }))}
                      placeholder="记录实测中发现的问题"
                    />
                  </Form.Item>
                </Col>
              </Row>
              <Space>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  loading={saving}
                  onClick={handleSaveInspection}
                  data-testid="save-inspection"
                >
                  保存核验
                </Button>
                <Button icon={<ReloadOutlined />} onClick={handleCreateRectify} data-testid="gen-rectify">
                  生成整改条目
                </Button>
              </Space>
            </Form>
          </Card>
        </Col>
      </Row>

      <Card
        title="停用期与替代点"
        size="small"
        style={{ marginTop: 16 }}
        extra={
          <Typography.Text type="secondary" className="gb-muted">
            停用期间不进入路线选点链；解除后路线按通行日自动恢复，核验与整改记录保留
          </Typography.Text>
        }
      >
        <Divider style={{ margin: '0 0 12px' }} />
        {pointOutages.length ? (
          <Table<Outage>
            rowKey="id"
            size="small"
            pagination={{ pageSize: 5, hideOnSinglePage: true }}
            dataSource={pointOutages}
            columns={outageColumns}
          />
        ) : (
          <EmptyState title="暂无停用记录" description="施工或临时停用时在此登记停用期与替代点" compact />
        )}

        <Divider style={{ margin: '12px 0' }} />
        <Form layout="vertical">
          <Row gutter={12}>
            <Col xs={24} md={6}>
              <Form.Item label="停用开始">
                <DatePicker
                  id="outage-start"
                  value={outageForm.startDate ? dayjs(outageForm.startDate) : null}
                  onChange={(d) =>
                    setOutageForm((c) => ({ ...c, startDate: d ? d.format('YYYY-MM-DD') : '' }))
                  }
                  allowClear={false}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item label="原计划恢复">
                <DatePicker
                  id="outage-end"
                  value={outageForm.endDate ? dayjs(outageForm.endDate) : null}
                  onChange={(d) =>
                    setOutageForm((c) => ({ ...c, endDate: d ? d.format('YYYY-MM-DD') : '' }))
                  }
                  allowClear={false}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item label="替代点">
                <Select
                  id="outage-alternate"
                  value={outageForm.alternatePointId || undefined}
                  onChange={(v) => setOutageForm((c) => ({ ...c, alternatePointId: v ?? '' }))}
                  allowClear
                  placeholder="选择同类型邻近点位"
                  options={points
                    .filter((p) => p.id !== point.id)
                    .sort((a, b) =>
                      a.facilityType === point.facilityType && b.facilityType !== point.facilityType
                        ? -1
                        : 1,
                    )
                    .map((p) => ({
                      value: p.id,
                      label: `${p.code} ${p.name}${p.facilityType === point.facilityType ? '（同类设施）' : ''}`,
                    }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item label="停用原因">
                <Input
                  id="outage-reason"
                  value={outageForm.reason}
                  onChange={(e) => setOutageForm((c) => ({ ...c, reason: e.target.value }))}
                  placeholder="如 坡道施工改造"
                />
              </Form.Item>
            </Col>
          </Row>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleAddOutage}
            data-testid="save-outage"
          >
            登记停用期
          </Button>
        </Form>
      </Card>

      <Card title="整改跟踪" size="small" style={{ marginTop: 16 }}>
        <Divider style={{ margin: '0 0 12px' }} />
        {plans.length ? (
          <Table<RectifyPlan> rowKey="id" size="small" pagination={false} dataSource={plans} columns={rectifyColumns} />
        ) : (
          <EmptyState
            title="暂无整改条目"
            description="核验结论为不合格时会自动生成整改条目"
            extra={
              <Button onClick={handleCreateRectify} data-testid="empty-gen-rectify">
                手动生成整改条目
              </Button>
            }
            compact
          />
        )}
      </Card>
    </div>
  );
}
