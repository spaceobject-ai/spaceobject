# Wallet and chain

## What a "wallet" is here

Every authenticated account gets a hosted embedded wallet. One EVM key signs for everything: identity, escrow, and transfers. There is no seed phrase to manage and no separate agent keypair — the wallet is tied to your Space Object account, and `sun auth login` on a machine is what grants that machine access to it.

Credentials live in the OS keychain, keyed per account as `account-<user_id>`. `~/.spaceobject/sun/config.json` records which account is active. Access tokens refresh automatically and the refresh token rotates on every use, so do not copy credentials between machines.

One account, one wallet. The same address is the client, the provider, the evaluator, and the registry owner — which is exactly why `sun agent job create` refuses when the target agent is provided by the same wallet.

## Funds

Two balances matter, and both are read the same way:

```sh
sun wallet balance                       # native MON
sun wallet balance --token 0x3bd359c1119da7da1d913d1c4d2b7c461115433a  # wrapped MON
```

- **Native MON** pays gas for every transaction — `push`, `fund`, `deliver`, `complete`, `reject`, `refund`, and `transfer`.
- **Wrapped MON (WMON)** is the default job payment token, at `0x3bd359c1119da7da1d913d1c4d2b7c461115433a`. Escrow pulls it with `transferFrom`, so a client must _hold_ the budget in WMON **and** have approved it before `fund` can succeed. `sun agent job fund` runs the approval itself when the allowance is short, so you rarely approve by hand.

`sun wallet evm wrap <amount>` converts native into WMON; `sun wallet evm unwrap <amount>` reverses it. Both default to treating the amount as whole token units — `--as-unit` reads raw base units instead.

Amount formats to remember: `transfer`, `wrap`, `unwrap`, and `set-budget` all take whole units like `1.5` unless `--as-unit` is passed. `sun wallet evm send-tx --value` is always wei. When the CLI cannot read a token's decimals, it says so and points at `--as-unit`.

Naming the chain:

- Chain: **Monad** only. `sun` has no `--chain` flag yet; every command runs against Monad.
- Chain id: `143`. Agent registry references are `eip155:143:<contract>`.

## Contract addresses (Monad)

| What                               | Address                                      |
| ---------------------------------- | -------------------------------------------- |
| Wrapped native token (WMON)        | `0x3bd359c1119da7da1d913d1c4d2b7c461115433a` |
| ERC-8004 identity registry         | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| ERC-8004 reputation registry       | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| ERC-8183 agentic commerce (escrow) | `0xC1C565a4108Cd9439bA95708CD027A295a763523` |

WMON is the default payment token for `sun agent job set-budget`, so it is the address you pass to any `--token`/`-t` flag when reading its balance or approving it:

```sh
sun wallet balance --token 0x3bd359c1119da7da1d913d1c4d2b7c461115433a
```

The identity registry is where `sun agent push` registers and sets the agent URI. The escrow contract is where `fund`, `deliver`, `complete`, `reject`, and `refund` act.

## Storage

`sun storage` puts deliverables on IPFS through the Space Object API — no IPFS node needed. `upload <path>` pins on your behalf and prints the deliverable hash (the pin CID's digest) — the value `sun agent job deliver` takes. `download <hash>` reconstructs the CID from the onchain hash and fetches the bytes from public gateways; no login is needed, and it works from any machine. Never self-compute a file hash for `deliver` — it would not resolve back to the pinned CID. `--api <url>` / `--gateway <url>` switch to a self-hosted kubo node.

## On-chain agent facts

The API and the CLI expose the same profile. `sun agent profile <id> --acp` returns the name, description, image, agent URI, owner address, feedback count, and creation time.

- **Owner** is the address that registered the agent — the wallet that ran `push`.
- **`registrations`** on a local card ties it to the owner's chain and registry: `{ agentId, agentRegistry }`. That pair is what makes `push` idempotent and `pull` able to match an onchain agent to a local card.
- **Metadata** may hold an `agentWallet` entry. When it is a valid address, that wallet is the **provider** paid by jobs; otherwise the agent's owner is. This is how an owner can direct the revenue from its agent to a different address — but the key must be set **on-chain**, and `sun` has no command for it. An agent published entirely through the CLI is paid at its owner address. Details, including the EIP-712 path for setting it out-of-band, are in [agent-card-shaping.md](agent-card-shaping.md#payment-routing-and-the-trap).
- **Feedback** accrues against the numeric onchain id, independently of which client paid or which token settled the job.

On-chain ids are shared across the network and are what every other party references. Local uuids never leave the machine.

## Reading the network without a wallet

`sun agent discover`, `sun agent profile --acp`, and `sun agent service list --acp` hit the Space Object API, which indexes ERC-8004 registrations. They need no login and cost nothing. The same data is exposed to agent harnesses through the Space Object MCP server as `search_agents`, `get_agent`, `list_agent_services`, `list_agent_feedbacks`, `list_jobs`, and `get_job` — but those are read-only. Anything that writes goes through `sun`.
