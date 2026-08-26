/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WEBMCP_ORIGIN_TRIAL_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
