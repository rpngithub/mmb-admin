import { Space, Tag, Tooltip } from 'antd';
import { formatDate } from '../../lib/ai';
import { isTruthyFlag } from '../../lib/users';

export function AccountTypeTag({ value }) {
  if (!value) return <Tag>Not chosen</Tag>;
  return (
    <Tag color={value === 'business' ? 'geekblue' : 'cyan'}>
      {value === 'business' ? 'Business' : 'Personal'}
    </Tag>
  );
}

const SUB_TYPE_LABEL = { trial: 'Trial', access_pass: 'Access pass' };

/** The list's `current_plan` (null = free tier). */
export function CurrentPlanCell({ plan }) {
  if (!plan) return <Tag>Free</Tag>;
  const subLabel = SUB_TYPE_LABEL[plan.sub_type];
  const renews = isTruthyFlag(plan.auto_renew);
  return (
    <Space size={4} wrap>
      <Tag color="purple">{plan.name || 'Plan'}</Tag>
      {subLabel && <Tag color={plan.sub_type === 'trial' ? 'gold' : 'orange'}>{subLabel}</Tag>}
      {plan.ends_at && (
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          {renews ? 'renews' : 'ends'} {formatDate(plan.ends_at)}
        </span>
      )}
    </Space>
  );
}

/** Tag with a tooltip, used for status cells that need an explanation. */
export function HintTag({ color, hint, children }) {
  const tag = <Tag color={color}>{children}</Tag>;
  return hint ? <Tooltip title={hint}>{tag}</Tooltip> : tag;
}
