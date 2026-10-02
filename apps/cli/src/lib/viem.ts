import type { Wallet } from "@spaceobject/core";
import { type Address, type Hex, numberToHex, type TransactionSerializable } from "viem";
import { toAccount } from "viem/accounts";
import { CliError } from "../utils/errors.ts";
import {
  walletRpc,
  type WalletSession,
  walletSignatureSchema,
  walletSignedTransactionSchema,
} from "./privy.ts";

// Exposing the wallet as a viem account means viem owns transaction preparation
// (nonce, gas, fee estimation) and broadcasting against the chain's own RPC,
// which keeps sending work on chains Privy cannot broadcast to itself.
export function toWalletAccount(session: WalletSession, wallet: Wallet) {
  const sign = async (body: object) =>
    walletSignatureSchema.parse(await walletRpc(session, wallet.id, body)).data.signature as Hex;

  return toAccount({
    address: wallet.address as Address,

    async signMessage({ message }) {
      const params =
        typeof message === "string"
          ? { message, encoding: "utf-8" }
          : {
              message:
                typeof message.raw === "string"
                  ? message.raw
                  : `0x${Buffer.from(message.raw).toString("hex")}`,
              encoding: "hex",
            };

      return sign({ method: "personal_sign", params });
    },

    async signTypedData({ domain, types, primaryType, message }) {
      return sign({
        method: "eth_signTypedData_v4",
        params: { typed_data: { domain, types, message, primary_type: primaryType } },
      });
    },

    async signTransaction(transaction) {
      const response = await walletRpc(session, wallet.id, {
        method: "eth_signTransaction",
        params: { transaction: toPrivyTransaction(transaction) },
      });

      return walletSignedTransactionSchema.parse(response).data.signed_transaction as Hex;
    },
  });
}

// Privy's transaction schema has no type-3 (blob) equivalent.
const transactionTypes = {
  legacy: 0,
  eip2930: 1,
  eip1559: 2,
  eip4844: undefined,
  eip7702: 4,
} as const;

// Privy's transaction schema is snake_case and rejects unknown keys, so viem's
// camelCase fields are mapped across explicitly.
function toPrivyTransaction(transaction: TransactionSerializable) {
  // Privy's schema carries neither access_list nor authorization_list, so these
  // would be silently dropped and a different transaction signed than the one
  // that was prepared. Checked by field rather than by type because every
  // non-legacy type can carry an access list.
  if (transaction.accessList?.length)
    throw new CliError(
      "WALLET_RPC_FAILED",
      "Access lists are not supported by the Privy wallet adapter.",
      "Send this transaction without an access list.",
    );
  if (transaction.authorizationList?.length)
    throw new CliError(
      "WALLET_RPC_FAILED",
      "eip7702 authorization lists are not supported by the Privy wallet adapter.",
      "Send this transaction without an authorization list.",
    );

  const quantity = (value: bigint | number | undefined) =>
    value === undefined ? undefined : numberToHex(value);

  return {
    to: transaction.to ?? undefined,
    chain_id: transaction.chainId,
    nonce: transaction.nonce,
    data: "data" in transaction ? transaction.data : undefined,
    value: quantity(transaction.value),
    type: transaction.type ? transactionTypes[transaction.type] : undefined,
    gas_limit: quantity(transaction.gas),
    gas_price: quantity("gasPrice" in transaction ? transaction.gasPrice : undefined),
    max_fee_per_gas: quantity("maxFeePerGas" in transaction ? transaction.maxFeePerGas : undefined),
    max_priority_fee_per_gas: quantity(
      "maxPriorityFeePerGas" in transaction ? transaction.maxPriorityFeePerGas : undefined,
    ),
  };
}
