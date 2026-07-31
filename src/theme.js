import { theme as antdTheme } from 'antd';

/**
 * Central AntD theme config consumed by ConfigProvider. Tweak tokens here rather
 * than hand-rolling CSS.
 */
export const appTheme = {
  algorithm: antdTheme.defaultAlgorithm,
  token: {
    colorPrimary: '#1677ff',
    borderRadius: 8,
    fontSize: 14,
  },
  components: {
    Layout: {
      headerHeight: 56,
    },
    Menu: {
      itemBorderRadius: 6,
    },
  },
};
