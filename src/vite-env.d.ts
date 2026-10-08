/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ARCGIS_API_KEY?: string;
  readonly VITE_BMKG_BASE_URL?: string;
  readonly VITE_USE_MOCK_DATA?: string;
  readonly VITE_UDARA_JAKARTA_URL?: string;
  readonly VITE_3D_OBJECT_LAYER_URL?: string;
  readonly VITE_UDARA_JAKARTA_RECORDS_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
