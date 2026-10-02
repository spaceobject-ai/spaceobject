import { expect, test } from "vite-plus/test";
import { networkByChain } from "../src/network.ts";
import { toWallet } from "../src/privy.ts";

test("maps Privy chain types onto Space Object networks", () => {
  expect(toWallet({ id: "wallet_1", address: "0xabc", chain_type: "ethereum" })).toEqual({
    id: "wallet_1",
    address: "0xabc",
    network: "evm",
  });

  expect(toWallet({ id: "wallet_2", address: "9wtG", chain_type: "solana" })?.network).toBe("svm");
});

test("drops wallets whose chain type Space Object does not model", () => {
  expect(toWallet({ id: "wallet_3", address: "T9yD", chain_type: "tron" })).toBeNull();
});

test("a mapped wallet's network resolves the chains it serves", () => {
  const wallet = toWallet({ id: "wallet_1", address: "0xabc", chain_type: "ethereum" });

  expect(wallet?.network).toBe(networkByChain.monad);
});
