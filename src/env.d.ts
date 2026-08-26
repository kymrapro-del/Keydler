/// <reference types="vite/client" />

/*
 * `VITE_WEBMCP_ORIGIN_TRIAL_TOKEN` n'est plus lu par aucun module : il est
 * consommé à la construction par `vite.config.ts`, qui écrit la balise dans le
 * HTML. Le déclarer ici laisserait croire qu'un module peut encore le lire.
 */
