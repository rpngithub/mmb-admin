import { fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { setCredentials, logout } from '../auth/authSlice';
import { notify } from '../../lib/notify';

const API_ROOT = `${import.meta.env.VITE_API_BASE || 'http://localhost:3000'}/api/v1`;

const rawBaseQuery = fetchBaseQuery({
  baseUrl: API_ROOT,
  prepareHeaders: (headers, { getState }) => {
    const token = getState().auth.accessToken;
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return headers;
  },
});

/**
 * Normalize the backend error envelope:
 *   { success:false, error:{ code, message, details:[{field,message}] } }
 * into a flat shape and surface it through an AntD notification.
 */
function normalizeError(error) {
  const body = error?.data;
  const envelope = body?.error;
  const code = envelope?.code || (error?.status === 'FETCH_ERROR' ? 'NETWORK_ERROR' : 'ERROR');
  let message = envelope?.message;
  if (!message) {
    if (error?.status === 'FETCH_ERROR') message = 'Network error — could not reach the server.';
    else if (typeof error?.status === 'number') message = `Request failed (${error.status}).`;
    else message = 'Something went wrong.';
  }
  const details = Array.isArray(envelope?.details) ? envelope.details : [];
  return { status: error?.status, code, message, details };
}

function announce(normalized) {
  const description =
    normalized.details.length > 0
      ? normalized.details.map((d) => `${d.field ? `${d.field}: ` : ''}${d.message}`).join('\n')
      : undefined;
  notify.error({
    message: normalized.message,
    description,
  });
}

// Single-flight refresh guard so concurrent 401s only trigger one refresh.
let refreshPromise = null;

async function attemptRefresh(api, extraOptions) {
  const refreshToken = api.getState().auth.refreshToken;
  if (!refreshToken) return null;
  if (!refreshPromise) {
    refreshPromise = rawBaseQuery(
      { url: '/auth/refresh', method: 'POST', body: { refresh_token: refreshToken } },
      api,
      extraOptions,
    ).finally(() => {
      // Cleared on next tick so all awaiters resolve against the same result.
      setTimeout(() => {
        refreshPromise = null;
      }, 0);
    });
  }
  return refreshPromise;
}

/**
 * baseQueryWithReauth:
 *  - unwraps the success envelope ({ success, data, meta }) so endpoints receive
 *    `data` directly, exposing `meta.total` on the query meta for paginated lists;
 *  - on 401, refreshes the token once and retries; on refresh failure logs out;
 *  - surfaces all other errors through a global AntD notification.
 */
export const baseQueryWithReauth = async (args, api, extraOptions = {}) => {
  let result = await rawBaseQuery(args, api, extraOptions);

  if (result.error?.status === 401 && !extraOptions.skipReauth) {
    const refresh = await attemptRefresh(api, extraOptions);
    const refreshData = refresh?.data?.data; // unwrap { success, data:{...} }
    if (refreshData?.access_token) {
      api.dispatch(
        setCredentials({
          access_token: refreshData.access_token,
          refresh_token: refreshData.refresh_token,
        }),
      );
      result = await rawBaseQuery(args, api, extraOptions); // retry original
    } else {
      api.dispatch(logout());
      const normalized = normalizeError(result.error);
      return { error: normalized };
    }
  }

  if (result.error) {
    const normalized = normalizeError(result.error);
    if (!extraOptions.silent) announce(normalized);
    return { error: normalized, meta: result.meta };
  }

  // Success — unwrap the envelope and hoist `meta.total` onto the query meta.
  const body = result.data;
  const total = body?.meta?.total;
  const unwrapped = body && Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : body;
  return {
    data: unwrapped,
    meta: { ...result.meta, total },
  };
};
