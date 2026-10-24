import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  InputNumber,
  Result,
  Segmented,
  Select,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { useAppDispatch } from '../../app/hooks';
import { adminApi, useGetDashboardWidgetQuery } from '../../features/api/adminApi';
import { fmtDateTime } from '../../lib/dashboard';
import { WidgetBody } from './DashboardWidgets';

const { Text } = Typography;

/** Card-level controls, offered only when the manifest lists that param. */
const DAYS_OPTIONS = {
  renewals_due: [7, 14, 30],
  events_without_templates: [14, 30, 60],
};
const DEFAULT_DAYS = { renewals_due: 7, events_without_templates: 30 };
const DEFAULT_MIN = { catalog_coverage: 3, events_without_templates: 1 };
/** What the server falls back to when the page sends no from/to. */
const DEFAULT_RANGE_LABEL = { recent_feedback: 'Last 7 days' };

function initialParams(widget) {
  const p = new Set(widget.params || []);
  const out = {};
  if (p.has('granularity')) out.granularity = 'day';
  if (p.has('days')) out.days = DEFAULT_DAYS[widget.key] ?? 7;
  if (p.has('min')) out.min = DEFAULT_MIN[widget.key] ?? 1;
  return out;
}

/**
 * One dashboard widget. Each card owns its query, so a slow or failing widget
 * never blocks the others. Only the params the manifest lists are sent; the
 * page's date range reaches a card only when its params include `from`.
 */
export default function WidgetCard({ widget, range }) {
  const dispatch = useAppDispatch();
  const params = useMemo(() => new Set(widget.params || []), [widget.params]);
  const usesRange = params.has('from');
  const [local, setLocal] = useState(() => initialParams(widget));
  const [refreshing, setRefreshing] = useState(false);

  const args = useMemo(
    () => ({
      key: widget.key,
      from: usesRange ? range?.from : undefined,
      to: usesRange && params.has('to') ? range?.to : undefined,
      ...local,
    }),
    [widget.key, usesRange, params, range?.from, range?.to, local],
  );

  const { data, error, isLoading, isFetching } = useGetDashboardWidgetQuery(args);

  const setParam = (name, value) => setLocal((prev) => ({ ...prev, [name]: value }));

  // Refresh bypasses the 60s server cache (`fresh=1`) and writes the result
  // into the card's normal cache entry, so later renders keep the cheap args.
  const refresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await dispatch(
        adminApi.endpoints.getDashboardWidget.initiate(
          { ...args, fresh: 1 },
          { subscribe: false, forceRefetch: true },
        ),
      ).unwrap();
      dispatch(adminApi.util.upsertQueryData('getDashboardWidget', args, fresh));
    } catch {
      // A failure surfaces on the next normal fetch; the card keeps its data.
    } finally {
      setRefreshing(false);
    }
  };

  const meta = data?.meta || {};

  let body;
  if (isLoading) {
    body = <Skeleton active paragraph={{ rows: 4 }} />;
  } else if (error) {
    body =
      error.status === 403 ? (
        <Result
          status="403"
          icon={<StopOutlined style={{ fontSize: 32, color: 'rgba(0,0,0,0.25)' }} />}
          title={<Text type="secondary">No access</Text>}
          style={{ padding: 16 }}
        />
      ) : (
        <Alert
          type="error"
          showIcon
          message={error.status === 400 ? 'Invalid parameters' : 'Could not load this widget'}
          description={error.message}
        />
      );
  } else {
    body = (
      <WidgetBody
        widgetKey={widget.key}
        data={data?.data || {}}
        widget={widget}
        params={local}
        setParam={setParam}
        hasParam={(p) => params.has(p)}
      />
    );
  }

  const controls = [];
  if (params.has('granularity')) {
    controls.push(
      <Segmented
        key="granularity"
        size="small"
        value={local.granularity}
        onChange={(v) => setParam('granularity', v)}
        options={[
          { label: 'Day', value: 'day' },
          { label: 'Week', value: 'week' },
          { label: 'Month', value: 'month' },
        ]}
      />,
    );
  }
  if (params.has('days')) {
    controls.push(
      <Select
        key="days"
        size="small"
        value={local.days}
        onChange={(v) => setParam('days', v)}
        style={{ width: 120 }}
        options={(DAYS_OPTIONS[widget.key] || [7, 14, 30]).map((d) => ({
          label: `Next ${d} days`,
          value: d,
        }))}
      />,
    );
  }
  if (params.has('min')) {
    controls.push(
      <Space key="min" size={4}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Min templates
        </Text>
        <InputNumber
          size="small"
          min={0}
          max={100}
          value={local.min}
          onChange={(v) => v !== null && setParam('min', v)}
          style={{ width: 64 }}
        />
      </Space>,
    );
  }

  return (
    <Card
      size="small"
      title={widget.title || widget.key}
      style={{ height: '100%' }}
      styles={{ body: { opacity: isFetching && !isLoading && !refreshing ? 0.6 : 1 } }}
      extra={
        <Space size={6}>
          {usesRange && (
            <Tag style={{ marginInlineEnd: 0 }}>
              {range?.label || DEFAULT_RANGE_LABEL[widget.key] || 'Last 30 days'}
            </Tag>
          )}
          <Tooltip
            title={
              meta.generated_at
                ? `Generated ${fmtDateTime(meta.generated_at)}${meta.cached ? ' (cached)' : ''} — refresh for live data`
                : 'Refresh (bypasses the 60-second cache)'
            }
          >
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined />}
              loading={refreshing}
              onClick={refresh}
              aria-label="Refresh widget"
            />
          </Tooltip>
        </Space>
      }
    >
      {controls.length > 0 && (
        <Space wrap size={8} style={{ marginBottom: 12 }}>
          {controls}
        </Space>
      )}
      {body}
    </Card>
  );
}
