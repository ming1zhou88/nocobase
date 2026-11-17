import React from 'react';
import TrackingExceptionPage from './TrackingExceptionPage';

/**
 * 快递异常工作台 · 独立帮助页。
 *
 * 复用工作台组件的数据加载与实时指标计算，只渲染帮助正文，
 * 供工作台「帮助」按钮和后续帮助中心入口使用。
 */
export default function TrackingExceptionHelpPage() {
  return <TrackingExceptionPage helpMode />;
}
