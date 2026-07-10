"use client";
import "./globals.css";
import { useEffect, useState, useCallback, useRef } from "react";
import { ethers } from "ethers";
import {
  CHAIN_ID, CHAIN_ID_HEX, READ_RPC, EXPLORER, GRID_GAME, SLVR_TOKEN, SQUARES,
  GAME_ABI, TOKEN_ABI, PULSECHAIN_PARAMS, EVMNET_CHAIN_HASH, DRAND_API,
} from "../lib/config";

const readProvider = new ethers.JsonRpcProvider(READ_RPC, CHAIN_ID);
const fmt = (wei, d = 0) => Number(ethers.formatEther(wei || 0n)).toLocaleString(undefined, { maximumFractionDigits: d });

const SITE = "https://slvr-three.vercel.app";
function shareUrl(res) {
  const text = `SLVR round #${res.r} on PulseChain: square ${Number(res.winningSquare)} won a ${fmt(res.grossPot)} PLS pot — settled by a verifiable drand beacon. Play:`;
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(SITE)}`;
}

export default function Page() {
  const [account, setAccount] = useState(null);
  const [chainOk, setChainOk] = useState(true);
  const [state, setState] = useState(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const walletRef = useRef(null);

  const gameRead = new ethers.Contract(GRID_GAME, GAME_ABI, readProvider);
  const tokenRead = new ethers.Contract(SLVR_TOKEN, TOKEN_ABI, readProvider);

  const refresh = useCallback(async () => {
    try {
      const [gameStart, roundDuration, minStake, houseFeeBps, rid, jackpotPool, jackpotOdds] = await Promise.all([
        gameRead.gameStart(), gameRead.roundDuration(), gameRead.minStake(),
        gameRead.houseFeeBps(), gameRead.currentRoundId(),
        gameRead.slvrJackpotPool(), gameRead.jackpotOdds(),
      ]);
      const roundId = Number(rid);
      const closeTime = Number(await gameRead.roundCloseTime(roundId));
      const acct = account;
      const slvrBalance = acct ? await tokenRead.balanceOf(acct) : 0n;
      const squares = await Promise.all(
        Array.from({ length: SQUARES }, (_, s) => gameRead.squareStake(roundId, s))
      );
      const mine = acct
        ? await Promise.all(Array.from({ length: SQUARES }, (_, s) => gameRead.userStake(roundId, acct, s)))
        : Array(SQUARES).fill(0n);
      const pot = squares.reduce((a, b) => a + b, 0n);

      // recent settled rounds
      const results = [];
      for (let r = roundId - 1; r >= Math.max(0, roundId - 6); r--) {
        const res = await gameRead.result(r);
        let claimable = null;
        if (res.settled && acct) {
          const [plsOut, slvrOut] = await gameRead.pendingClaim(r, acct);
          const alreadyClaimed = await gameRead.claimed(r, acct);
          claimable = { plsOut, slvrOut, alreadyClaimed };
        }
        results.push({ r, ...res, claimable });
      }

      setState({
        roundId, closeTime, minStake, houseFeeBps: Number(houseFeeBps),
        squares, mine, pot, results,
        roundDuration: Number(roundDuration), gameStart: Number(gameStart),
        slvrBalance, jackpotPool, jackpotOdds: Number(jackpotOdds),
      });
      if (!amount) setAmount(ethers.formatEther(minStake));
    } catch (e) {
      setErr(e.shortMessage || e.message);
    }
  }, [account, amount]);

  useEffect(() => { refresh(); const id = setInterval(refresh, 10000); return () => clearInterval(id); }, [refresh]);
  useEffect(() => { const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000); return () => clearInterval(id); }, []);

  async function connect() {
    setErr("");
    if (!window.ethereum) { setErr("No wallet found. Install MetaMask or Rabby."); return; }
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
    } catch (e) {
      if (e.code === 4902) await window.ethereum.request({ method: "wallet_addEthereumChain", params: [PULSECHAIN_PARAMS] });
    }
    const net = await provider.getNetwork();
    setChainOk(Number(net.chainId) === CHAIN_ID);
    walletRef.current = provider;
    const signer = await provider.getSigner();
    setAccount(await signer.getAddress());
  }

  async function withSigner() {
    const provider = walletRef.current || new ethers.BrowserProvider(window.ethereum);
    const net = await provider.getNetwork();
    if (Number(net.chainId) !== CHAIN_ID) throw new Error("Switch your wallet to PulseChain (369).");
    return new ethers.Contract(GRID_GAME, GAME_ABI, await provider.getSigner());
  }

  async function stake(square) {
    setErr(""); setBusy(true);
    try {
      const g = await withSigner();
      const value = ethers.parseEther(amount || "0");
      if (value < state.minStake) throw new Error(`Minimum stake is ${fmt(state.minStake)} PLS`);
      const tx = await g.stake(square, { value });
      await tx.wait();
      await refresh();
    } catch (e) { setErr(e.shortMessage || e.message); }
    setBusy(false);
  }

  async function claim(r) {
    setErr(""); setBusy(true);
    try {
      const g = await withSigner();
      const tx = await g.claim(r);
      await tx.wait();
      await refresh();
    } catch (e) { setErr(e.shortMessage || e.message); }
    setBusy(false);
  }

  const secsLeft = state ? Math.max(0, state.closeTime - now) : 0;
  const mm = String(Math.floor(secsLeft / 60)).padStart(2, "0");
  const ss = String(secsLeft % 60).padStart(2, "0");

  return (
    <div className="wrap">
      <div className="header">
        <div className="brand">◈ SLVR</div>
        {account ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="pill" title="Your SLVR balance">◈ {state ? fmt(state.slvrBalance, 2) : "…"} SLVR</span>
            <span className="pill">{account.slice(0, 6)}…{account.slice(-4)}</span>
          </div>
        ) : (
          <button className="btn primary" onClick={connect}>Connect Wallet</button>
        )}
      </div>
      <p className="tag">Grid mining on PulseChain. Stake PLS on a square each round — a public drand beacon
        picks the winner. Winners split the pot and mine SLVR. Provably fair, no operator edge.</p>

      {!chainOk && <div className="panel err">Wrong network — switch your wallet to PulseChain (chain 369).</div>}
      {err && <div className="panel err">{err}</div>}

      {state && state.jackpotPool > 0n && (
        <div className="panel jackpot">
          🎰 <b>Jackpot: {fmt(state.jackpotPool, 2)} SLVR</b> — roughly 1-in-{state.jackpotOdds} winning rounds
          pays it out on top of the pot. Win a round and it could be yours.
        </div>
      )}

      <div className="panel">
        <div className="row">
          <div><div className="stat">Round</div><div className="big">#{state ? state.roundId : "—"}</div></div>
          <div><div className="stat">Round Pot</div><div className="big">{state ? fmt(state.pot) : "—"} PLS</div></div>
          <div><div className="stat">{secsLeft > 0 ? "Closes in" : "Closed — settling"}</div>
            <div className="big countdown">{secsLeft > 0 ? `${mm}:${ss}` : "•••"}</div></div>
          <div><div className="stat">House Fee</div><div className="big">{state ? (state.houseFeeBps / 100).toFixed(1) : "—"}%</div></div>
          <div><div className="stat">Jackpot</div><div className="big">{state ? fmt(state.jackpotPool, 1) : "—"} <span style={{ fontSize: 13, color: "var(--muted)" }}>SLVR</span></div></div>
        </div>
      </div>

      <div className="panel">
        <div className="row" style={{ marginBottom: 10 }}>
          <div className="stat">Pick a square &amp; stake</div>
          <div>
            <input className="amt" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
            <span className="note"> PLS {state ? `(min ${fmt(state.minStake)})` : ""}</span>
          </div>
        </div>
        <div className="grid">
          {state && state.squares.map((amt, s) => {
            const mine = state.mine[s] > 0n;
            return (
              <div key={s} className={`cell ${mine ? "mine" : ""}`}
                onClick={() => !busy && account && secsLeft > 0 && stake(s)}
                title={secsLeft > 0 ? `Stake ${amount} PLS on #${s}` : "Round closed"}>
                <span className="n">#{s}</span>
                <span className="amt">{fmt(amt)}</span>
                {mine && <span className="mine-amt">you: {fmt(state.mine[s])}</span>}
              </div>
            );
          })}
        </div>
        {!account && <p className="note" style={{ marginTop: 12 }}>Connect a wallet to stake.</p>}
        {account && secsLeft <= 0 && <p className="note" style={{ marginTop: 12 }}>This round has closed — waiting for settlement. Next round is open shortly.</p>}
      </div>

      <div className="panel">
        <div className="stat" style={{ marginBottom: 10 }}>Recent rounds</div>
        <div className="results">
          {state && state.results.length === 0 && <div className="note">No settled rounds yet.</div>}
          {state && state.results.map((res) => (
            <div className="res" key={res.r}>
              <span>#{res.r}</span>
              {res.settled ? (
                <>
                  <span className="pill">winning square {Number(res.winningSquare)}</span>
                  <span className="note">pot {fmt(res.grossPot)} PLS</span>
                  <span className="reslinks">
                    <a className="lnk" href={`${EXPLORER}/address/${GRID_GAME}`} target="_blank" rel="noreferrer" title="View contract on explorer">explorer ↗</a>
                    <a className="lnk" href={`${DRAND_API}/${EVMNET_CHAIN_HASH}/public/${Number(res.drandRound)}`} target="_blank" rel="noreferrer" title="Verify the drand beacon that decided this round">verify ↗</a>
                    <a className="lnk" href={shareUrl(res)} target="_blank" rel="noreferrer" title="Share this round">share ↗</a>
                  </span>
                  {res.claimable && res.claimable.plsOut > 0n ? (
                    res.claimable.alreadyClaimed ? <span className="pill">claimed</span> :
                    <button className="btn primary" disabled={busy} onClick={() => claim(res.r)}>
                      Claim {fmt(res.claimable.plsOut)} PLS
                    </button>
                  ) : null}
                </>
              ) : <span className="pill">awaiting beacon</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="footer">
        Contract <a href={`${EXPLORER}/address/${GRID_GAME}`} target="_blank" rel="noreferrer">{GRID_GAME.slice(0, 8)}…</a>
        {" · "}Randomness by <a href="https://drand.love" target="_blank" rel="noreferrer">drand evmnet</a> (BN254)
        {" · "}Unaudited. Play responsibly.
      </div>
    </div>
  );
}
