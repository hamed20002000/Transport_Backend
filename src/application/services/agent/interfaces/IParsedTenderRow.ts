interface ParsedTenderRow {
    oldCode: string | null;
    newCode: string | null;
    description: string | null;
    unit: string | null;
    materialQty: number | null;
    installQty: number | null;
    removeQty: number | null;
    dmmQty: number | null;
    materialPrice: number | null;
    installPrice: number | null;
    removePrice: number | null;
}