import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Typography, Col, Row, Empty, DatePicker, Skeleton, Result, Button, Space } from 'antd';
import dayjs from 'dayjs';
import { useAppSelector } from '../app/hooks';
import { selectIdentity } from '../features/auth/authSlice';
import { useGetDashboardManifestQuery } from '../features/api/adminApi';
import WidgetCard from '../components/dashboard/WidgetCard';
import {
  DATE_FORMAT,
  MAX_RANGE_DAYS,
  RANGE_PRESETS,
  WIDE_WIDGETS,
  formatRange,
  parseRange,
} from '../lib/dashboard';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

/**
 * The dashboard is built entirely from the manifest: it lists only the widgets
 * this admin's `dashboard.<widget_key>` permissions allow, in display order,
 * grouped into sections. Nothing here knows which role sees what.
 *
 * The global date range lives in the URL (`?from=&to=`). With no range in the
 * URL nothing is sent, so each widget keeps its own server default (30 days;
 * 7 for recent_feedback).
 */
export default function Dashboard() {
  const identity = useAppSelector(selectIdentity);
  const [searchParams, setSearchParams] = useSearchParams();
  const { data, isLoading, error, refetch, isFetching } = useGetDashboardManifestQuery();

  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const pickerValue = useMemo(() => parseRange(fromParam, toParam), [fromParam, toParam]);
  const range = useMemo(
    () =>
      pickerValue
        ? {
            from: pickerValue[0].format(DATE_FORMAT),
            to: pickerValue[1].format(DATE_FORMAT),
            label: formatRange(pickerValue),
          }
        : null,
    [pickerValue],
  );

  const onRangeChange = (value) => {
    const next = new URLSearchParams(searchParams);
    if (value && value[0] && value[1]) {
      next.set('from', value[0].format(DATE_FORMAT));
      next.set('to', value[1].format(DATE_FORMAT));
    } else {
      next.delete('from');
      next.delete('to');
    }
    setSearchParams(next, { replace: true });
  };

  // Nothing after today; spans capped at the API's 366 days.
  const disabledDate = (current, info) => {
    if (current.isAfter(dayjs(), 'day')) return true;
    const from = info?.from;
    return Boolean(from && Math.abs(current.diff(from, 'day')) >= MAX_RANGE_DAYS);
  };

  const groups = useMemo(() => {
    const sections = data?.sections || [];
    const widgets = data?.widgets || [];
    const known = new Set(sections.map((s) => s.key));
    const out = sections.map((s) => ({
      ...s,
      widgets: widgets.filter((w) => w.section === s.key),
    }));
    const orphans = widgets.filter((w) => !known.has(w.section));
    if (orphans.length) out.push({ key: '__other', title: 'Other', widgets: orphans });
    return out.filter((g) => g.widgets.length > 0);
  }, [data]);

  const anyRangeWidget = (data?.widgets || []).some((w) => (w.params || []).includes('from'));

  let content;
  if (isLoading) {
    content = <Skeleton active paragraph={{ rows: 8 }} />;
  } else if (error) {
    content = (
      <Result
        status="error"
        title="Couldn't load the dashboard"
        subTitle={error.message}
        extra={
          <Button onClick={refetch} loading={isFetching}>
            Try again
          </Button>
        }
      />
    );
  } else if (groups.length === 0) {
    content = (
      <Empty
        style={{ marginTop: 64 }}
        description="No dashboard widgets are enabled for your role"
      />
    );
  } else {
    content = groups.map((g) => (
      <section key={g.key} style={{ marginBottom: 28 }}>
        <Title level={5} style={{ marginBottom: 12 }}>
          {g.title || g.key}
        </Title>
        <Row gutter={[16, 16]}>
          {g.widgets.map((w) => (
            <Col key={w.key} xs={24} xl={WIDE_WIDGETS.has(w.key) ? 24 : 12}>
              <WidgetCard widget={w} range={range} />
            </Col>
          ))}
        </Row>
      </section>
    ));
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div>
          <Title level={3} style={{ margin: 0 }}>
            Dashboard
          </Title>
          <Text type="secondary">Welcome back, {identity.name}</Text>
        </div>
        {anyRangeWidget && (
          <Space direction="vertical" size={2} style={{ alignItems: 'flex-end' }}>
            <RangePicker
              value={pickerValue}
              onChange={onRangeChange}
              presets={RANGE_PRESETS}
              disabledDate={disabledDate}
              format="D MMM YYYY"
              allowClear
              placeholder={['Default range', 'today']}
            />
            {!pickerValue && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                Each widget uses its own default (usually the last 30 days)
              </Text>
            )}
          </Space>
        )}
      </div>
      {content}
    </div>
  );
}
