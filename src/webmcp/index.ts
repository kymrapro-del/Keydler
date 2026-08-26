/**
 * Point d'entrée de la couche WebMCP. Importer ce module suffit à enregistrer
 * les outils : c'est le seul effet de bord voulu du démarrage.
 */
import { registerTools } from './register'

void registerTools()

export { getRegistrationState, onRegistrationChange, registerTools } from './register'
export type { RegistrationState } from './register'
export { ALL_TOOLS, resumeTaskTool } from './tools'
export { RESUME_TASK_DESCRIPTION } from './descriptions'
export { getCalls, onCall, resetCalls } from './witness'
export { checkAvailability } from './adapter'
