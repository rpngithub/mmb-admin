/**
 * A tiny bridge so non-React code (the RTK Query baseQuery) can raise AntD
 * notifications/messages that still come from the <App> context (correct theme
 * + container). A <NotificationBridge> component registers the live API here.
 */
let api = null;

export function setNotifier(instance) {
  api = instance;
}

export const notify = {
  error(config) {
    if (api?.notification) api.notification.error(config);
    // eslint-disable-next-line no-console
    else console.error('[notify]', config);
  },
  success(config) {
    if (api?.notification) api.notification.success(config);
  },
  info(config) {
    if (api?.notification) api.notification.info(config);
  },
  messageError(content) {
    if (api?.message) api.message.error(content);
  },
  messageSuccess(content) {
    if (api?.message) api.message.success(content);
  },
};
