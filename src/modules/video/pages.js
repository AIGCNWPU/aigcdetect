import { renderVideoGeneral } from './pages/general.js';
import { renderVideoDeepfake } from './pages/deepfake.js';
import { renderVideoAftersales } from './pages/aftersales.js';

export const videoPages = [
  ['/video/general', renderVideoGeneral],
  ['/video/deepfake', renderVideoDeepfake],
  ['/video/aftersales', renderVideoAftersales],
];
