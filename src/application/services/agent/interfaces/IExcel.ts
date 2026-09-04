export interface WorkItemDetail {
  id: string;
  tempId: string;
  name: string;
  value: string;
}

export interface WorkDetailSubEntry {
  id: string;
  trAdiParentId: string;
  dn: string;
  yeni: string;
  dmm: string;
  mevcut: string;
  itemDetails: WorkItemDetail[];
  isToplamRow: boolean;
}

export interface WorkDetailRow {
  id: string;
  trAdi: string;
  subEntries: WorkDetailSubEntry[];
}

export interface ParsedExcelResult {
  registeredWorkEntries: WorkDetailRow[];
  unregisteredProductTypes: string[];
  unregisteredItems: string[];
}

export interface ItemDefinition {
  name: string;
  nameColIdx: number;
  valueColIdx: number;
}