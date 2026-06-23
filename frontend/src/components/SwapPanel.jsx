import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, usePublicClient, useWriteContract, useEstimateGas } from "wagmi";
import { formatUnits, parseUnits } from "viem";
import { ArrowUpDown, Clock, ExternalLink, RefreshCw, Zap } from "lucide-react";
import { ADDRESSES } from "../contracts/addresses";
import { ERC20_ABI, explorerTx } from "../lib/contracts";
import { TOKENS } from "../contracts/tokens";

const ROUTER_ABI = [
  { type:"function", name:"swap", stateMutability:"nonpayable", inputs:[{name:"tokenIn",type:"address"},{name:"tokenOut",type:"address"},{name:"amountIn",type:"uint256"},{name:"minAmountOut",type:"uint256"}], outputs:[] },
  { type:"function", name:"swapFeeBps", stateMutability:"view", inputs:[], outputs:[{type:"uint16"}] },
  { type:"function", name:"cooldown", stateMutability:"view", inputs:[], outputs:[{type:"uint256"}] },
  { type:"function", name:"lastSwapAt", stateMutability:"view", inputs:[{name:"user",type:"address"}], outputs:[{type:"uint256"}] },
];

const SWAP_TOKENS    = TOKENS.filter((t) => ["TSLA","AMZN","NFLX","PLTR","AMD","USDG"].includes(t.symbol));
const MAX_SINGLE_SWAP = 0.5;
const COOLDOWN_SECS   = 600;

function fmtCountdown(secs) {
  if (secs <= 0) return null;
  return `${Math.floor(secs/60)}:${String(secs%60).padStart(2,"0")}`;
}
function fmtAmt(v, dp=4) {
  if (!Number.isFinite(v) || v <= 0) return "—";
  return new Intl.NumberFormat(undefined,{maximumFractionDigits:dp,minimumFractionDigits:0}).format(v);
}
function fmtUsd(v) {
  if (!Number.isFinite(v) || v <= 0) return null;
  return `$${v.toLocaleString(undefined,{maximumFractionDigits:2})}`;
}

export function SwapPanel({ data, isConnected, isRightChain }) {
  const { address }            = useAccount();
  const publicClient           = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [tokenIn,      setTokenIn]      = useState(SWAP_TOKENS[0]);
  const [tokenOut,     setTokenOut]     = useState(SWAP_TOKENS[1]);
  const [amount,       setAmount]       = useState("");
  const [busy,         setBusy]         = useState(false);
  const [toast,        setToast]        = useState(null);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [feeBps,       setFeeBps]       = useState(100);
  const [lastTx,       setLastTx]       = useState(null);
  const toastTimer = useRef(null);

  function showToast(kind, text, hash=null) {
    setToast({kind,text,hash});
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(()=>setToast(null), 8000);
  }

  useEffect(()=>{
    if (!publicClient) return;
    publicClient.readContract({address:ADDRESSES.router,abi:ROUTER_ABI,functionName:"swapFeeBps"})
      .then((v)=>{ if (v!=null) setFeeBps(Number(v)); }).catch(()=>{});
  },[publicClient]);

  const checkCooldown = useCallback(async()=>{
    if (!address||!publicClient) { setCooldownLeft(0); return; }
    try {
      const last = await publicClient.readContract({address:ADDRESSES.router,abi:ROUTER_ABI,functionName:"lastSwapAt",args:[address]});
      const rem  = Number(last)+COOLDOWN_SECS-Math.floor(Date.now()/1000);
      setCooldownLeft(rem>0?rem:0);
    } catch { setCooldownLeft(0); }
  },[address,publicClient]);

  useEffect(()=>{
    checkCooldown();
    const id=setInterval(checkCooldown,15000);
    return ()=>clearInterval(id);
  },[checkCooldown]);

  useEffect(()=>{
    if (cooldownLeft<=0) return;
    const id=setInterval(()=>setCooldownLeft((x)=>Math.max(0,x-1)),1000);
    return ()=>clearInterval(id);
  },[cooldownLeft>0]); // eslint-disable-line

  const amountNum    = parseFloat(String(amount).replace(",","."))||0;
  const priceIn      = data?.prices?.[tokenIn.symbol]  || tokenIn.fallbackPrice  || 0;
  const priceOut     = data?.prices?.[tokenOut.symbol] || tokenOut.fallbackPrice || 0;
  const estimatedOut = amountNum>0&&priceOut>0 ? (amountNum*priceIn/priceOut)*(1-feeBps/10000) : 0;
  const feeUsd       = amountNum>0 ? amountNum*priceIn*(feeBps/10000) : 0;
  const rate         = priceOut>0 ? priceIn/priceOut : 0;
  const walletBal    = address&&data?.walletBalances?.[tokenIn.symbol]
    ? Number(formatUnits(data.walletBalances[tokenIn.symbol],tokenIn.decimals)) : null;

  const canSwap = isConnected&&isRightChain&&!busy&&cooldownLeft===0
    &&amountNum>0&&amountNum<=MAX_SINGLE_SWAP&&tokenIn.address!==tokenOut.address;

  function flipTokens(){ setTokenIn(tokenOut); setTokenOut(tokenIn); setAmount(""); }

  function handleMax(){
    if (walletBal==null) return;
    setAmount(String(Math.floor(Math.min(walletBal,MAX_SINGLE_SWAP)*1000)/1000));
  }

  function handleTokenInChange(sym){
    const t=SWAP_TOKENS.find((x)=>x.symbol===sym); if (!t) return;
    if (t.symbol===tokenOut.symbol) setTokenOut(tokenIn);
    setTokenIn(t); setAmount("");
  }

  function handleTokenOutChange(sym){
    const t=SWAP_TOKENS.find((x)=>x.symbol===sym); if (!t) return;
    if (t.symbol===tokenIn.symbol) setTokenIn(tokenOut);
    setTokenOut(t);
  }

  const { data: estimatedGas } = useEstimateGas({
    address: ADDRESSES.router,
    abi: ROUTER_ABI,
    functionName: "swap",
    args: tokenIn && tokenOut && amountNum > 0 && !isNaN(amountNum)
      ? [tokenIn.address, tokenOut.address, parseUnits(String(amountNum), tokenIn.decimals), 0n]
      : undefined,
    query: { enabled: Boolean(tokenIn && tokenOut && amountNum > 0 && !isNaN(amountNum)) },
  });
  async function runSwap(){
    if (!address||!publicClient||!amount||busy) return;
    if (cooldownLeft>0)                     { showToast("error",`Cooldown active — wait ${fmtCountdown(cooldownLeft)}`); return; }
    if (tokenIn.address===tokenOut.address) { showToast("error","Token In and Out must be different."); return; }
    if (amountNum>MAX_SINGLE_SWAP)          { showToast("error",`Max per swap: ${MAX_SINGLE_SWAP} token`); return; }
    setBusy(true);
    try {
      const parsed = parseUnits(String(amountNum),tokenIn.decimals);
      const allow  = await publicClient.readContract({address:tokenIn.address,abi:ERC20_ABI,functionName:"allowance",args:[address,ADDRESSES.router]});
      if (allow<parsed) {
        showToast("info",`Approving ${tokenIn.symbol}…`);
        const ah=await writeContractAsync({address:tokenIn.address,abi:ERC20_ABI,functionName:"approve",args:[ADDRESSES.router,parsed]});
        await publicClient.waitForTransactionReceipt({hash:ah});
        showToast("info","Approve confirmed. Proceeding with swap…",ah);
      }
      const sh=await writeContractAsync({address:ADDRESSES.router,abi:ROUTER_ABI,functionName:"swap",args:[tokenIn.address,tokenOut.address,parsed,0n],gas:(estimatedGas && estimatedGas > 250000n) ? (estimatedGas * 130n / 100n) : 350000n});
      showToast("info","Swap submitted…",sh);
      const receipt=await publicClient.waitForTransactionReceipt({hash:sh});
      if(receipt.status==="reverted"){showToast("error","Swap gagal on-chain",sh);setBusy(false);return;}
      showToast("success",`Swap ${tokenIn.symbol} → ${tokenOut.symbol} confirmed ✓`,sh);
      setLastTx(sh); setAmount(""); await checkCooldown();
    } catch(err) {
      showToast("error",err?.shortMessage||err?.message||"Swap gagal");
    } finally { setBusy(false); }
  }

  return (
    <div className="swapPanel">
      <div className="swapTopRow">
      {toast&&(
        <div className={`swapToast swapToast--${toast.kind}`}>
          <span>{toast.text}</span>
          {toast.hash&&<a href={explorerTx(toast.hash)} target="_blank" rel="noreferrer" className="swapToastLink">Tx <ExternalLink size={11}/></a>}
        </div>
      )}
      <div className="swapCard">
        <div className="swapHeader">
          <span className="swapLabel">STOCK SWAP</span>
          <span className="swapFeeTag">Fee {feeBps/100}%</span>
        </div>
        <div className="swapField">
          <div className="swapFieldHeader">
            <label className="swapFieldLabel">From</label>
            {walletBal!=null&&<span className="swapBal">Balance: {fmtAmt(walletBal,4)} <button className="maxBtn" onClick={handleMax} type="button">MAX</button></span>}
          </div>
          <div className="swapRow">
            <select className="tokenSelect" value={tokenIn.symbol} onChange={(e)=>handleTokenInChange(e.target.value)}>
              {SWAP_TOKENS.map((t)=><option key={t.symbol} value={t.symbol}>{t.symbol}</option>)}
            </select>
            <input className="swapInput" type="number" placeholder="0.000" value={amount} min="0" max={MAX_SINGLE_SWAP} step="0.001" onChange={(e)=>setAmount(e.target.value)}/>
          </div>
          {amountNum>0&&fmtUsd(amountNum*priceIn)&&<div className="swapUsd">≈ {fmtUsd(amountNum*priceIn)}</div>}
          {amountNum>MAX_SINGLE_SWAP&&<div className="swapWarn">⚠ Max {MAX_SINGLE_SWAP} per swap</div>}
        </div>
        <div className="swapFlipRow">
          <button className="flipBtn" onClick={flipTokens} type="button"><ArrowUpDown size={15}/></button>
        </div>
        <div className="swapField">
          <div className="swapFieldHeader"><label className="swapFieldLabel">To</label></div>
          <div className="swapRow">
            <select className="tokenSelect" value={tokenOut.symbol} onChange={(e)=>handleTokenOutChange(e.target.value)}>
              {SWAP_TOKENS.map((t)=><option key={t.symbol} value={t.symbol}>{t.symbol}</option>)}
            </select>
            <div className="swapOutputAmt">{estimatedOut>0?fmtAmt(estimatedOut,4):"—"}</div>
          </div>
          {estimatedOut>0&&fmtUsd(estimatedOut*priceOut)&&<div className="swapUsd">≈ {fmtUsd(estimatedOut*priceOut)}</div>}
        </div>
        {amountNum>0&&amountNum<=MAX_SINGLE_SWAP&&rate>0&&(
          <div className="swapPreview">
            <div className="previewRow"><span>Rate</span><span>1 {tokenIn.symbol} ≈ {fmtAmt(rate,4)} {tokenOut.symbol}</span></div>
            <div className="previewRow"><span>Fee ({feeBps/100}%)</span><span>≈ {fmtUsd(feeUsd)||"—"}</span></div>
            <div className="previewRow highlight"><span>You receive</span><span>{fmtAmt(estimatedOut,4)} {tokenOut.symbol}</span></div>
          </div>
        )}
        {cooldownLeft>0&&<div className="swapCooldown"><Clock size={13}/><span>Cooldown active — {fmtCountdown(cooldownLeft)}</span></div>}
        {!isConnected
          ? <div className="swapNotice">Connect wallet to swap</div>
          : !isRightChain
          ? <div className="swapNotice swapNotice--warn">Wrong network — switch to Robinhood Testnet</div>
          : <button className="swapBtn" onClick={runSwap} disabled={!canSwap} type="button">
              {busy?<><RefreshCw size={13} className="spinIcon"/> Processing…</>
              :cooldownLeft>0?<><Clock size={13}/> Cooldown {fmtCountdown(cooldownLeft)}</>
              :<><Zap size={13}/> Swap {tokenIn.symbol} → {tokenOut.symbol}</>}
            </button>
        }
        {lastTx&&<div className="swapTxLink"><a href={explorerTx(lastTx)} target="_blank" rel="noreferrer">View last tx <ExternalLink size={11}/></a></div>}
      </div>
      <div className="swapInfoBox">
        <div className="swapInfoTitle">Parameter Guard</div>
        <div className="swapInfoGrid">
          <div className="swapInfoRow"><span>Max per swap</span><span>0.5 token</span></div>
          <div className="swapInfoRow"><span>Daily cap</span><span>1 token / day</span></div>
          <div className="swapInfoRow"><span>Pair daily cap</span><span>2 token / pair</span></div>
          <div className="swapInfoRow"><span>Cooldown</span><span>10 min</span></div>
          <div className="swapInfoRow"><span>Fee</span><span>{feeBps/100}%</span></div>
        </div>
      </div>
      </div>
      <div className="swapHistoryBox">
        <div className="swapHistoryTitle">Recent Swaps</div>
        {lastTx ? (
          <div className="swapInfoRow">
            <span>Last tx</span>
            <a href={explorerTx(lastTx)} target="_blank" rel="noreferrer" style={{color:"#00ff88",fontSize:".75rem"}}>
              {lastTx.slice(0,10)}…{lastTx.slice(-6)} ↗
            </a>
          </div>
        ) : (
          <div className="swapHistoryEmpty">No swaps yet this session</div>
        )}
      </div>
    </div>
  );
}
