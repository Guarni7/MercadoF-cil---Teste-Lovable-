/**
 * Preferências de colunas de lista (localStorage).
 * Uso: createColumnStore("mf_product_list_columns", PRODUCT_COLUMN_DEFS)
 */

export function createColumnStore(storageKey, columnDefs) {
  const getDefaults = () => {
    const state = {};
    for (const col of columnDefs) state[col.id] = col.defaultOn;
    return state;
  };

  const load = () => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return getDefaults();
      return { ...getDefaults(), ...JSON.parse(raw) };
    } catch {
      return getDefaults();
    }
  };

  const save = (state) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {}
  };

  return { columnDefs, getDefaults, load, save };
}
