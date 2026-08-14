import { Application, Plugin } from '@nocobase/client-v2';

export class PluginAfterSalesBatchClientV2 extends Plugin<unknown, Application> {
  async load() {
    this.router.add('after-sales-batch', {
      path: '/after-sales/batch-workbench',
      componentLoader: () => import('./pages/AfterSalesBatchPage'),
    });
  }
}

export default PluginAfterSalesBatchClientV2;
