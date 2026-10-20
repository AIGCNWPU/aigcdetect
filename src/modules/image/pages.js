import { renderImageGeneral } from './pages/general.js';
import { renderImageRefund } from './pages/refund.js';
import { renderImageDocuments } from './pages/documents.js';

export const imagePages = [
  ['/image/general', renderImageGeneral],
  ['/image/refund', renderImageRefund],
  ['/image/documents', renderImageDocuments],
];
