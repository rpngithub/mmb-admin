import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  siderCollapsed: false,
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setSiderCollapsed(state, action) {
      state.siderCollapsed = action.payload;
    },
    toggleSider(state) {
      state.siderCollapsed = !state.siderCollapsed;
    },
  },
});

export const { setSiderCollapsed, toggleSider } = uiSlice.actions;
export default uiSlice.reducer;

export const selectSiderCollapsed = (s) => s.ui.siderCollapsed;
