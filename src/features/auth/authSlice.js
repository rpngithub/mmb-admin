import { createSlice } from '@reduxjs/toolkit';
import { decodeToken, getPermissions, getAdminIdentity } from './permissions';

const STORAGE_KEY = 'mmb_admin_auth';

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.accessToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

function persist(accessToken, refreshToken) {
  try {
    if (accessToken) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ accessToken, refreshToken }));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* storage unavailable — ignore */
  }
}

function deriveState(accessToken, refreshToken) {
  const payload = decodeToken(accessToken);
  return {
    accessToken: accessToken || null,
    refreshToken: refreshToken || null,
    permissions: getPermissions(payload),
    identity: getAdminIdentity(payload),
    isAuthenticated: Boolean(accessToken),
  };
}

const stored = loadFromStorage();
const initialState = stored
  ? deriveState(stored.accessToken, stored.refreshToken)
  : deriveState(null, null);

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    // Used after login AND after every token refresh (tokens rotate — both replace).
    setCredentials(state, action) {
      const { access_token, refresh_token } = action.payload;
      const next = deriveState(access_token, refresh_token);
      Object.assign(state, next);
      persist(next.accessToken, next.refreshToken);
    },
    logout(state) {
      Object.assign(state, deriveState(null, null));
      persist(null, null);
    },
  },
});

export const { setCredentials, logout } = authSlice.actions;
export default authSlice.reducer;

// Selectors
export const selectAccessToken = (s) => s.auth.accessToken;
export const selectRefreshToken = (s) => s.auth.refreshToken;
export const selectIsAuthenticated = (s) => s.auth.isAuthenticated;
export const selectPermissions = (s) => s.auth.permissions;
export const selectIdentity = (s) => s.auth.identity;
