import { useEffect } from 'react';
import { App } from 'antd';
import { setNotifier } from '../lib/notify';

/**
 * Registers the live AntD App static-method APIs (message/notification/modal)
 * with the notify bridge so non-React code (the RTK Query baseQuery) can raise
 * notifications from within the <App> context.
 */
export default function NotificationBridge() {
  const staticApi = App.useApp();
  useEffect(() => {
    setNotifier(staticApi);
  }, [staticApi]);
  return null;
}
