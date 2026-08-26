/**
 * Point d'entrée de la couche WebMCP. Importer ce module suffit à enregistrer
 * les outils : c'est le seul effet de bord voulu du démarrage.
 */
import { registerTools } from './register'

void registerTools()

export { getRegistrationState, onRegistrationChange } from './register'
export type { RegistrationState } from './register'
export { FIXED_STATE, RESUME_TASK_DESCRIPTION, getCallStats, onCall, resumeTaskTool } from './resumeTask'
export { checkAvailability } from './adapter'
