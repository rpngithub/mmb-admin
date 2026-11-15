import { Result, Spin } from 'antd';
import { formatInr } from './ai';

// Shared, non-component helpers for the Users list and the User Detail page.
// (Components live in pages/users/userShared.jsx — kept apart for fast refresh.)

/** OTP signups have no name — fall back to the phone, then email, never "null". */
export function userDisplayName(u) {
  return u?.name || u?.phone || u?.email || '—';
}

export const isTruthyFlag = (v) => v === true || v === 1 || v === '1';

export const ACCOUNT_TYPE_OPTIONS = [
  { value: 'business', label: 'Business' },
  { value: 'personal', label: 'Personal' },
];

export const PLAN_STATE_OPTIONS = [
  { value: 'paid', label: 'Paid', title: 'Current plan is a regular paid subscription' },
  { value: 'trial', label: 'Trial', title: 'Current plan is a free trial' },
  { value: 'access_pass', label: 'Access pass', title: 'Current plan is the ₹10 access pass' },
  { value: 'expired', label: 'Expired', title: 'Nothing active now, but subscribed before' },
  {
    value: 'free',
    label: 'Free (never subscribed)',
    title: 'Never subscribed — an abandoned checkout does not count',
  },
];

export const ACTIVE_OPTIONS = [
  { value: '1', label: 'Active' },
  { value: '0', label: 'Suspended' },
];

/** ₹ with at most two decimals (amounts arrive as decimal strings or numbers). */
export const inr = (v) => formatInr(v, { digits: 2 });

/**
 * Loading / error states for one section of the page. A 403 renders a
 * "no access" Result inside that tab only; 404 means the user is gone.
 * Returns null when there is data to show. A plain function (not a component),
 * so callers can `const s = sectionState(...); if (s) return s;`.
 */
export function sectionState({ isLoading, error, notFoundText = 'User not found' }) {
  if (isLoading) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin />
      </div>
    );
  }
  if (!error) return null;
  if (error.status === 403) {
    return <Result status="403" title="You don't have access to this section" />;
  }
  if (error.status === 404) return <Result status="404" title={notFoundText} />;
  return (
    <Result
      status="error"
      title="Could not load this section"
      subTitle={error.message || 'Something went wrong.'}
    />
  );
}
