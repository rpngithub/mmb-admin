import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import authReducer from '../features/auth/authSlice';
import uiReducer from '../features/ui/uiSlice';
import { adminApi } from '../features/api/adminApi';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    ui: uiReducer,
    [adminApi.reducerPath]: adminApi.reducer,
  },
  middleware: (getDefault) => getDefault().concat(adminApi.middleware),
});

// Enables refetchOnFocus / refetchOnReconnect behaviour.
setupListeners(store.dispatch);
