import CSVLayer from "@arcgis/core/layers/CSVLayer";
import GeoJSONLayer from "@arcgis/core/layers/GeoJSONLayer";
import IntegratedMesh3DTilesLayer from "@arcgis/core/layers/IntegratedMesh3DTilesLayer";
import Layer from "@arcgis/core/layers/Layer";
import PortalItem from "@arcgis/core/portal/PortalItem";
import OGCFeatureLayer from "@arcgis/core/layers/OGCFeatureLayer";
import WFSLayer from "@arcgis/core/layers/WFSLayer";
import WMSLayer from "@arcgis/core/layers/WMSLayer";
import WMTSLayer from "@arcgis/core/layers/WMTSLayer";
import type { SourceKind, SourceSpec } from "./state";

export interface SourceOption {
  kind: SourceKind;
  label: string;
  group: "ArcGIS" | "OGC" | "Berkas / format terbuka" | "3D";
  urlLabel: string;
  placeholder: string;
  paramLabel?: string;
  hint: string;
}

/** Every source the Add data menu offers. Add an entry + a case in createLayer() to support a new type. */
export const SOURCE_OPTIONS: SourceOption[] = [
  {
    kind: "arcgis-url",
    label: "Layanan ArcGIS (URL)",
    group: "ArcGIS",
    urlLabel: "URL layanan",
    placeholder: "https://…/arcgis/rest/services/…/FeatureServer/0",
    hint: "Jenis dideteksi otomatis: FeatureServer, MapServer, ImageServer, SceneServer (I3S), VectorTileServer, ElevationServer.",
  },
  {
    kind: "portal-item",
    label: "Item ArcGIS Online / Portal (ID)",
    group: "ArcGIS",
    urlLabel: "Item ID",
    placeholder: "c444b24b184c4523a5dc96248bfea4e1",
    paramLabel: "URL portal (opsional)",
    hint: "Layer item apa pun dari ArcGIS Online atau ArcGIS Enterprise.",
  },
  { kind: "wms", label: "OGC WMS", group: "OGC", urlLabel: "URL WMS", placeholder: "https://…/wms", hint: "Web Map Service (gambar peta), mis. dari geoserver Jakarta Satu." },
  { kind: "wmts", label: "OGC WMTS", group: "OGC", urlLabel: "URL WMTS", placeholder: "https://…/wmts", hint: "Web Map Tile Service (tile peta)." },
  {
    kind: "wfs",
    label: "OGC WFS",
    group: "OGC",
    urlLabel: "URL WFS",
    placeholder: "https://…/wfs",
    paramLabel: "Nama feature type (opsional)",
    hint: "Web Feature Service 2.0 (GeoJSON). Kosongkan nama untuk memakai feature type pertama.",
  },
  {
    kind: "ogc-features",
    label: "OGC API – Features",
    group: "OGC",
    urlLabel: "URL landing page",
    placeholder: "https://…/ogcapi",
    paramLabel: "Collection ID (opsional)",
    hint: "Kosongkan collection untuk memakai koleksi pertama.",
  },
  { kind: "geojson", label: "GeoJSON (URL)", group: "Berkas / format terbuka", urlLabel: "URL GeoJSON", placeholder: "https://…/data.geojson", hint: "FeatureCollection dalam WGS84." },
  { kind: "csv", label: "CSV (URL)", group: "Berkas / format terbuka", urlLabel: "URL CSV", placeholder: "https://…/data.csv", hint: "Kolom koordinat (lat/lon, latitude/longitude, y/x) dideteksi otomatis." },
  { kind: "3dtiles", label: "3D Tiles (OGC)", group: "3D", urlLabel: "URL tileset.json", placeholder: "https://…/tileset.json", hint: "Mesh terintegrasi format OGC 3D Tiles 1.0/1.1." },
];

export const TYPE_LABELS: Record<SourceKind, string> = {
  "arcgis-url": "ArcGIS",
  "portal-item": "Item ArcGIS",
  wms: "WMS",
  wmts: "WMTS",
  wfs: "WFS",
  "ogc-features": "OGC API Features",
  geojson: "GeoJSON",
  csv: "CSV",
  "3dtiles": "3D Tiles",
  "file-csv": "CSV (berkas)",
  "file-geojson": "GeoJSON (berkas)",
};

async function firstOgcCollection(url: string): Promise<string> {
  const res = await fetch(`${url.replace(/\/$/, "")}/collections?f=json`);
  if (!res.ok) throw new Error(`Tidak dapat membaca daftar koleksi (${res.status})`);
  const json = await res.json();
  const id = json.collections?.[0]?.id;
  if (!id) throw new Error("Layanan tidak memiliki koleksi");
  return id;
}

/** Create (and load) an ArcGIS layer for a source specification. */
export async function createLayer(spec: SourceSpec): Promise<Layer> {
  const url = spec.url.trim();
  const param = spec.param?.trim() || undefined;
  let layer: Layer;
  switch (spec.kind) {
    case "arcgis-url":
      layer = await Layer.fromArcGISServerUrl({ url });
      break;
    case "portal-item":
      layer = await Layer.fromPortalItem({ portalItem: new PortalItem({ id: url, ...(param ? { portal: { url: param } } : {}) }) });
      break;
    case "wms":
      layer = new WMSLayer({ url });
      break;
    case "wmts":
      layer = new WMTSLayer({ url });
      break;
    case "wfs":
      layer = new WFSLayer({ url, ...(param ? { name: param } : {}) });
      break;
    case "ogc-features":
      layer = new OGCFeatureLayer({ url, collectionId: param ?? (await firstOgcCollection(url)) });
      break;
    case "geojson":
    case "file-geojson":
      layer = new GeoJSONLayer({ url });
      break;
    case "csv":
    case "file-csv":
      layer = new CSVLayer({ url });
      break;
    case "3dtiles":
      layer = new IntegratedMesh3DTilesLayer({ url });
      break;
  }
  if (spec.title) layer.title = spec.title;
  await layer.load();
  return layer;
}
