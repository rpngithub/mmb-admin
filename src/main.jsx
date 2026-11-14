import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider, App as AntApp } from 'antd';
import { store } from './app/store';
import { appTheme } from './theme';
import AppRouter from './router';
import NotificationBridge from './components/NotificationBridge';
import StepUpProvider from './components/StepUpProvider';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Provider store={store}>
      <ConfigProvider theme={appTheme}>
        <AntApp>
          <NotificationBridge />
          {/* One shared "Confirm your password" modal for step-up calls. */}
          <StepUpProvider>
            <BrowserRouter>
              <AppRouter />
            </BrowserRouter>
          </StepUpProvider>
        </AntApp>
      </ConfigProvider>
    </Provider>
  </React.StrictMode>,
);
