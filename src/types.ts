// Shared type definitions for crypto tax MCP
export type TxType =
  | "buy"
  | "sell"
  | "transfer_in"
  | "transfer_out"
  | "earn"
  | "airdrop";

export interface Transaction {
  id: string;
  user_id: string;
  date: string; // ISO 8601
  type: TxType;
  coin_id: string;
  quantity: number;
  price_usd?: number; // FMV at time of event
  fee_usd?: number;
  exchange?: string;
  wallet?: string;
  tx_hash?: string;
  source: "csv" | "manual" | "ccxt";
  notes?: string;
}

export interface CostLot {
  id: string;
  user_id: string;
  buy_tx_id: string;
  coin_id: string;
  quantity_acquired: number;
  quantity_remaining: number;
  cost_basis_usd: number; // total cost, not per-unit
  cost_per_unit: number;
  acquired_date: string;
  acquired_at_price_usd: number;
  exchange?: string;
  closed_at?: string;
}

export interface RealizedGain {
  id: string;
  user_id: string;
  sell_tx_id: string;
  buy_tx_id: string;
  coin_id: string;
  quantity: number;
  proceeds_usd: number;
  cost_basis_usd: number;
  gain_loss_usd: number;
  is_long_term: boolean; // > 365 days
  holding_period_days: number;
  sell_date: string;
  buy_date: string;
  method: "fifo" | "lifo" | "hifo";
}

export interface ErrorLog {
  id: string;
  user_id: string;
  transaction_id?: string;
  error_type: string;
  severity: "critical" | "warning" | "info";
  description: string;
  root_cause: string;
  remediation: string;
  tax_impact_usd: number;
  created_at: string;
}

export interface CostBasisResult {
  total_transactions: number;
  total_quantity_sold: number;
  total_proceeds_usd: number;
  total_cost_basis_usd: number;
  realized_gain_loss_usd: number;
  short_term_gain_loss: number;
  long_term_gain_loss: number;
  cost_lots: RealizedGain[];
  errors: ErrorLog[];
  reconciliation_status: {
    total_quantity_unmatched: number;
    missing_cost_basis_count: number;
    confidence_score: number;
  };
}
