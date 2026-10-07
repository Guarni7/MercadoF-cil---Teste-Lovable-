import ListColumnsSheet, { useListColumns } from "@/components/shared/ListColumnsSheet";
import {
  CUSTOMER_COLUMN_DEFS,
  customerColumnsStore,
} from "@/lib/customerColumns";

export default function CustomerColumnsSheet({ open, onOpenChange, columns, onChange }) {
  return (
    <ListColumnsSheet
      open={open}
      onOpenChange={onOpenChange}
      columns={columns}
      onChange={onChange}
      columnDefs={CUSTOMER_COLUMN_DEFS}
      lockedIds={["name"]}
      title="Configurações"
      sectionLabel="Colunas lista"
    />
  );
}

export function useCustomerColumns() {
  return useListColumns(customerColumnsStore);
}
