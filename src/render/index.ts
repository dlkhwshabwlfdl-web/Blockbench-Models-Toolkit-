export {
  projectScene,
  projectModel,
  viewBasis,
  VIEWS,
  type ViewBasis,
  type RenderOptions,
} from './projector.js';
export {
  contactSheet,
  clipStrip,
  renderToFile,
  type SheetOptions,
  type StripOptions,
} from './render.js';
export { metrics, formatMetrics, type MetricsReport, type MetricsOptions } from './metrics.js';
export {
  buildScene,
  restScene,
  posedScene,
  samplePose,
  boneWorldTransforms,
  identity,
  multiply,
  translation,
  rotationX,
  rotationY,
  rotationZ,
  rotationZYX,
  scaleMatrix,
  transformPoint,
  transformDirection,
  type Scene,
  type SceneFace,
  type Pose,
  type BonePose,
  type Mat4,
} from './scene.js';
