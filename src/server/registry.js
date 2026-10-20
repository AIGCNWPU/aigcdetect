import { runTextScenario } from '../modules/text/service.js';
import { runImageScenario } from '../modules/image/service.js';
import { runVideoScenario } from '../modules/video/service.js';
import { runAudioScenario } from '../modules/audio/service.js';

export const scenarioServices = {
  text: runTextScenario,
  image: runImageScenario,
  video: runVideoScenario,
  audio: runAudioScenario,
};
