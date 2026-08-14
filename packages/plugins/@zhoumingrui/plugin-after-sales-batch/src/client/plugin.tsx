import React from 'react';
import { Plugin } from '@nocobase/client';
import { AfterSalesBatchPage } from './pages/AfterSalesBatchPage';

export const AFTER_SALES_BATCH_ROUTE_PATH = '/admin/after-sales/batch-workbench';

export class PluginAfterSalesBatchClient extends Plugin {
  async load() {
    this.app.router.add('admin.after-sales-batch', {
      path: AFTER_SALES_BATCH_ROUTE_PATH,
      Component: AfterSalesBatchPage,
    });
  }
}

export default PluginAfterSalesBatchClient;
