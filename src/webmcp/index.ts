/**
 * Point d'entrée de la couche WebMCP. Importer ce module suffit à enregistrer
 * les outils : c'est le seul effet de bord voulu du démarrage.
 */
import { registerTools } from './register'

void registerTools()

export {
  getRegistrationState,
  onRegistrationChange,
  registerTools,
  toolsForCurrentState,
} from './register'
export type { RegistrationState, RegistrationPhase } from './register'
export { detectLifecycle, DYNAMIC_UNREGISTER_MIN_CHROMIUM } from './lifecycle'
export type { LifecycleMode, ToolLifecycle } from './lifecycle'
export { ALL_TOOLS, READ_TOOLS, WRITE_TOOLS, resumeTaskTool, readTaskDetailTool } from './tools'
export { RESUME_TASK_DESCRIPTION } from './descriptions'
export { getWitness, onCall, resetCalls } from './witness'
export type { Call, WitnessState } from './witness'
export { checkAvailability } from './adapter'
export { currentTaskIdFromLocation, taskPath, taskUrl } from './location'
