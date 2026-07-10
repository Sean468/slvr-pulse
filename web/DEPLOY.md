# Deploying the SLVR frontend

The app is a **static export** (`out/`) — pure client-side, reads PulseChain via a
public RPC, writes via the visitor's wallet. It runs on any static host.

Contract addresses are baked into `lib/config.js`:
- GridGame `0x61a21dB5764C695490FE9394999F121499c5Bd07`
- SlvrToken `0xC0F1bDB494Cd248e1D64236720b8d253540ad7cC`

## Option A — Vercel (recommended, needs your login once)

From this `web/` folder, in your own terminal:

```sh
npx vercel login          # authenticate to YOUR Vercel account (one time)
npx vercel --prod --yes   # deploy; prints the live https URL
```

Or non-interactively with a token you generate at vercel.com/account/tokens:

```sh
npx vercel --prod --yes --token YOUR_VERCEL_TOKEN
```

Vercel auto-detects Next.js and serves the static export.

## Option B — any static host

`npm run build` produces `out/`. Drag-and-drop `out/` to Netlify Drop, Cloudflare
Pages, GitHub Pages, or Surge — no build step needed on their side.

## Note

Nothing here holds a secret — the deployer/keeper key and the keyed Speedy RPC are
**not** in the frontend. Reads use the public RPC `https://rpc.pulsechain.com`.
