import React, { useState, useEffect, useMemo } from 'react';
import { Activity, ShieldAlert, Crosshair, Database, Zap, Bot, Loader2, CheckCircle2, XCircle, BrainCircuit, TrendingUp, TrendingDown, Save, History, Bell, ServerCrash, Key, AlertTriangle, BarChart3, Lock, Settings2 } from 'lucide-react';
import { createClient } from '[https://esm.sh/@supabase/supabase-js](https://esm.sh/@supabase/supabase-js)';

// ==========================================
// 1. SUPABASE & ENV SETUP
// ==========================================
const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL || ''; 
const supabaseKey = import.meta.env?.VITE_SUPABASE_ANON_KEY || ''; 
const geminiApiKey = import.meta.env?.VITE_GEMINI_API_KEY || ''; 

const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// --- LÕI TOÁN HỌC QUANTMATH ---
const QuantMath = {
  sma: (data, period) => {
    if (!data || data.length < period) return 0;
    return data.slice(-period).reduce((a, b) => a + b, 0) / period;
  },
  ema: (data, period) => {
    if (!data || data.length < period) return 0;
    const k = 2 / (period + 1);
    let emaVal = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) {
      emaVal = (data[i] * k) + (emaVal * (1 - k));
    }
    return emaVal;
  },
  trueRange: (h, l, pc) => Math.max(h - l || 0, Math.abs(h - pc) || 0, Math.abs(l - pc) || 0),
  atr: (highs, lows, closes, period) => {
    if (!closes || closes.length < period + 1) return 0;
    let trs = [];
    for (let i = 1; i < closes.length; i++) {
      trs.push(QuantMath.trueRange(highs[i], lows[i], closes[i-1]));
    }
    let currentAtr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) {
      currentAtr = ((currentAtr * (period - 1)) + trs[i]) / period;
    }
    return currentAtr || 0;
  },
  adx: (highs, lows, closes, period = 14) => {
    if (!closes || closes.length < period * 2) return 0;
    let trs = [], plusDMs = [], minusDMs = [];
    for (let i = 1; i < closes.length; i++) {
      trs.push(QuantMath.trueRange(highs[i], lows[i], closes[i-1]));
      const upMove = highs[i] - highs[i-1];
      const downMove = lows[i-1] - lows[i];
      plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }
    let smoothedTR = trs.slice(0, period).reduce((a,b)=>a+b,0);
    let smoothedPlusDM = plusDMs.slice(0, period).reduce((a,b)=>a+b,0);
    let smoothedMinusDM = minusDMs.slice(0, period).reduce((a,b)=>a+b,0);
    
    let dxs = [];
    for (let i = period; i < trs.length; i++) {
      smoothedTR = smoothedTR - (smoothedTR/period) + trs[i];
      smoothedPlusDM = smoothedPlusDM - (smoothedPlusDM/period) + plusDMs[i];
      smoothedMinusDM = smoothedMinusDM - (smoothedMinusDM/period) + minusDMs[i];
      const plusDI = 100 * (smoothedPlusDM / smoothedTR);
      const minusDI = 100 * (smoothedMinusDM / smoothedTR);
      const dx = 100 * Math.abs(plusDI - minusDI) / (plusDI + minusDI || 1);
      dxs.push(dx || 0);
    }
    return dxs.slice(-period).reduce((a,b)=>a+b,0) / period || 0;
  },
  rsi: (closes, period = 14) => {
    if (closes.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i-1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i-1];
      avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
      avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    }
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  },
  bollinger: (closes, period = 20, stdDev = 2) => {
    if (closes.length < period) return { bbw: 0, upper: 0, lower: 0, sma: 0 };
    const slice = closes.slice(-period);
    const sma = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
    const dev = Math.sqrt(variance);
    const upper = sma + (stdDev * dev);
    const lower = sma - (stdDev * dev);
    const bbw = ((upper - lower) / sma) * 100; 
    return { bbw, upper, lower, sma };
  },
  obv: (closes, volumes) => {
    if (closes.length < 2) return 0;
    let obv = 0;
    for (let i = 1; i < closes.length; i++) {
      if (closes[i] > closes[i-1]) obv += volumes[i];
      else if (closes[i] < closes[i-1]) obv -= volumes[i];
    }
    return obv;
  },
  costDrag: (entryPrice, tradeType, execution, fundingRate, spreadPercent, holdingDays = 1) => {
    const slippage = execution === 'MARKET' ? 0.001 : 0; 
    const fee = execution === 'MARKET' ? 0.0004 : 0.0002;
    const spreadCost = (spreadPercent / 100) / 2;
    const fundingDrag = tradeType === 'FUTURES' ? (fundingRate * holdingDays) : 0;
    return (slippage + fee + spreadCost) * 2 * entryPrice + Math.abs(fundingDrag * entryPrice); 
  },
  kellyCriterion: (winRate, historicalAvgRR) => {
    if(winRate === 0 || historicalAvgRR === 0) return 0;
    const W = winRate;
    const R = historicalAvgRR;
    return W - ((1 - W) / R);
  },
  detectSFP: (highs, lows, closes, direction) => {
    if (closes.length < 5) return false;
    const i = closes.length - 2; 
    const currentHigh = highs[i];
    const currentLow = lows[i];
    const currentClose = closes[i];
    
    const prevHigh = Math.max(...highs.slice(i-4, i)); 
    const prevLow = Math.min(...lows.slice(i-4, i));   

    if (direction === 'SHORT') {
      return (currentHigh > prevHigh && currentClose < prevHigh);
    } else {
      return (currentLow < prevLow && currentClose > prevLow);
    }
  }
};

export default function AntiFragileTerminal() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [intervalTime, setIntervalTime] = useState('15m');
  const [autoData, setAutoData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [tradeLogs, setTradeLogs] = useState([]);
  
  const [tradeStats, setTradeStats] = useState({ 
    totalClosed: 0, winRate: 0, avgWinR: 0, avgLossR: 1, historicalRR: 0, hasEnoughData: false 
  });
  
  const [lastUpdated, setLastUpdated] = useState(null);
  const [systemError, setSystemError] = useState(false);

  const [aiAnalysis, setAiAnalysis] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [geminiCooldown, setGeminiCooldown] = useState(0);

  const [apiMacro, setApiMacro] = useState({
    fgiValue: 50, longShortRatio: 1.0, takerBuySellRatio: 1.0, 
    microStress: 'LOW', volBreakout: 'NORMAL', isWeekend: false 
  });

  const [manualData, setManualData] = useState({
    capital: 10000, bidAskSpread: 0.01, mvrvZScore: 1.2,
    btcDominance: 55.0, socialSentiment: 'NEUTRAL', newsTrap: false
  });

  const [tradeSetup, setTradeSetup] = useState({
    tradeType: 'FUTURES', direction: 'LONG', execution: 'LIMIT', 
    riskPercent: 1.0, entry: 0, slTech: 0, tpTech: 0
  });

  useEffect(() => {
    const today = new Date().getDay();
    setApiMacro(prev => ({ ...prev, isWeekend: (today === 0 || today === 6) }));
  }, []);

  useEffect(() => {
    if (geminiCooldown > 0) { const t = setTimeout(() => setGeminiCooldown(c => c - 1), 1000); return () => clearTimeout(t); }
  }, [geminiCooldown]);

  // --- SUPABASE SYNC ---
  useEffect(() => {
    if (!supabase) return;
    const fetchLogs = async () => {
      try {
        const { data, error } = await supabase.from('trade_logs').select('*').order('created_at', { ascending: false }).limit(200);
        if (!error && data) {
          setTradeLogs(data);
          const closedTrades = data.filter(d => (d.status === 'WIN' || d.status === 'LOSS') && d.symbol === symbol);
          let totalWinR = 0; let winCount = 0;
          let totalLossR = 0; let lossCount = 0;

          closedTrades.forEach(t => {
             const riskUsd = t.risk_amount_usd || 1;
             const rMultiple = t.pnl_usd / riskUsd;
             if (t.status === 'WIN') { totalWinR += rMultiple; winCount++; }
             if (t.status === 'LOSS') { totalLossR += Math.abs(rMultiple); lossCount++; }
          });

          const winRate = closedTrades.length > 0 ? (winCount / closedTrades.length) : 0;
          const avgWinR = winCount > 0 ? (totalWinR / winCount) : 0;
          const avgLossR = lossCount > 0 ? (totalLossR / lossCount) : 1; 
          const historicalRR = avgLossR > 0 ? (avgWinR / avgLossR) : 0;

          setTradeStats({ 
            totalClosed: closedTrades.length, winRate: winRate, avgWinR, avgLossR, historicalRR,
            hasEnoughData: closedTrades.length >= 10 
          });
        }
      } catch (err) { console.error(err); }
    };
    fetchLogs();

    const subscription = supabase.channel('public:trade_logs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trade_logs' }, (payload) => {
        if (payload.eventType === 'INSERT') setTradeLogs(current => [payload.new, ...current].slice(0, 200));
        else if (payload.eventType === 'UPDATE') setTradeLogs(current => current.map(log => log.id === payload.new.id ? payload.new : log));
      }).subscribe();
    return () => supabase.removeChannel(subscription);
  }, [symbol]);

  // --- FETCH API THỰC CHỨNG & TOÁN HỌC ---
  useEffect(() => {
    let isMounted = true;
    const fetchData = async () => {
      setLoading(true);
      try {
        const oiInterval = ['15m', '1h', '4h', '1d'].includes(intervalTime) ? intervalTime : '1d';
        
        const [klinesLTFRes, klinesHTFRes, fundingRes, oiCurrentRes, oiHistRes, lsrRes, takerRes, fgiRes] = await Promise.all([
          fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${intervalTime}&limit=200`),
          fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=200`), 
          fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`),
          fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`),
          fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=${oiInterval}&limit=30`),
          fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${oiInterval}&limit=1`),
          fetch(`https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${symbol}&period=${oiInterval}&limit=1`),
          fetch('[https://api.alternative.me/fng/?limit=1](https://api.alternative.me/fng/?limit=1)')
        ]);

        if (!isMounted) return;
        if (!klinesLTFRes.ok || !klinesHTFRes.ok) throw new Error("Binance API Error");

        const klinesLTF = await klinesLTFRes.json();
        const klinesHTF = await klinesHTFRes.json();
        const funding = await fundingRes.json();
        const oiCurrent = await oiCurrentRes.json();
        const oiHist = await oiHistRes.json();

        let currentLsr = apiMacro.longShortRatio;
        let currentTaker = apiMacro.takerBuySellRatio;
        if (lsrRes.ok) {
          const lsrData = await lsrRes.json();
          if (lsrData && lsrData.length > 0) currentLsr = parseFloat(lsrData[lsrData.length-1].longShortRatio);
        }
        if (takerRes.ok) {
          const takerData = await takerRes.json();
          if (takerData && takerData.length > 0) currentTaker = parseFloat(takerData[takerData.length-1].buySellRatio);
        }

        let fetchedFgi = apiMacro.fgiValue;
        if (fgiRes.ok) {
          const fgiData = await fgiRes.json();
          if (fgiData?.data?.length > 0) fetchedFgi = parseInt(fgiData.data[0].value);
        }

        const opensLTF = klinesLTF.map(d => parseFloat(d[1]));
        const highsLTF = klinesLTF.map(d => parseFloat(d[2]));
        const lowsLTF = klinesLTF.map(d => parseFloat(d[3]));
        const closesLTF = klinesLTF.map(d => parseFloat(d[4]));
        const volumesLTF = klinesLTF.map(d => parseFloat(d[5]));
        
        const currentPrice = closesLTF[closesLTF.length - 1] || 0;
        const currentVol = volumesLTF[volumesLTF.length - 1] || 0;

        const closesHTF = klinesHTF.map(d => parseFloat(d[4]));
        const htfSma200 = QuantMath.sma(closesHTF, 200);

        const oiValues = Array.isArray(oiHist) ? oiHist.map(d => parseFloat(d.sumOpenInterestValue) || 0) : [0];
        const oiEma14 = QuantMath.ema(oiValues, 14) || oiValues[oiValues.length - 1] || 0;
        const currentOiValue = parseFloat(oiCurrent?.openInterest || 0) * currentPrice;

        const atr14 = QuantMath.atr(highsLTF, lowsLTF, closesLTF, 14);
        const atr3 = QuantMath.atr(highsLTF.slice(-10), lowsLTF.slice(-10), closesLTF.slice(-10), 3); 
        const adxValue = QuantMath.adx(highsLTF, lowsLTF, closesLTF, 14);
        const sma200 = QuantMath.sma(closesLTF, 200); 
        const ema34 = QuantMath.ema(closesLTF, 34); 
        const ema89 = QuantMath.ema(closesLTF, 89); 
        const rsiValue = QuantMath.rsi(closesLTF, 14);
        
        const bollinger20 = QuantMath.bollinger(closesLTF, 20, 2.0);
        const bollingerFatTail = QuantMath.bollinger(closesLTF, 20, 2.5);
        const obvValue = QuantMath.obv(closesLTF, volumesLTF);
        const volSma20 = QuantMath.sma(volumesLTF.slice(-21, -1), 20); 

        const isBullishSFP = QuantMath.detectSFP(highsLTF, lowsLTF, closesLTF, 'LONG');
        const isBearishSFP = QuantMath.detectSFP(highsLTF, lowsLTF, closesLTF, 'SHORT');

        const isOiSpiking = currentOiValue > oiEma14;
        const isVolSpiking = currentVol > volSma20 * 1.5;
        const isTakerAggressive = currentTaker > 1.2 || currentTaker < 0.8;
        
        let toxicScore = 0;
        if (isOiSpiking) toxicScore++;
        if (isVolSpiking) toxicScore++;
        if (isTakerAggressive) toxicScore++;
        const calcMicroStress = toxicScore >= 3 ? 'EXTREME' : toxicScore === 2 ? 'HIGH' : 'LOW';

        const isTailBreach = currentPrice > bollingerFatTail.upper || currentPrice < bollingerFatTail.lower;
        const isAtrExploding = atr3 > (atr14 * 1.5);
        const calcVolBreakout = (isTailBreach || isAtrExploding) ? 'BREAKOUT' : 'NORMAL';

        setAutoData({
          currentPrice, atr14, atrPercent: currentPrice > 0 ? (atr14 / currentPrice) * 100 : 0, 
          adx: adxValue, sma200, ema34, ema89, htfSma200,
          fundingRate: (funding && funding[0]) ? parseFloat(funding[0].fundingRate) * 100 : 0,
          currentOi: currentOiValue, oiEma: oiEma14, isOiSpiking,
          rsi: rsiValue, bbw: bollinger20.bbw, obv: obvValue,
          isBullishSFP, isBearishSFP
        });

        if(tradeSetup.entry === 0) setTradeSetup(prev => ({ ...prev, entry: currentPrice }));
        
        setApiMacro(prev => ({ 
          ...prev, fgiValue: fetchedFgi, longShortRatio: currentLsr, 
          takerBuySellRatio: currentTaker, microStress: calcMicroStress, volBreakout: calcVolBreakout
        }));

        setSystemError(false); 
        setLastUpdated(new Date());
      } catch (error) { console.error(error); setSystemError(true); } finally { if (isMounted) setLoading(false); }
    };

    fetchData();
    const timer = setInterval(fetchData, 60000); 
    return () => { isMounted = false; clearInterval(timer); };
  }, [symbol, intervalTime]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const handleRiskChange = (e) => {
    let val = parseFloat(e.target.value);
    if (isNaN(val)) val = 0;
    if (val > 2.0) val = 2.0; 
    if (val < 0.1) val = 0.1;
    setTradeSetup(prev => ({ ...prev, riskPercent: val }));
  };

  const mathCore = useMemo(() => {
    const safeResult = { slPercent: "0.00", riskAmountUSD: "0.00", positionSizeUSD: "0.00", effectiveLeverage: "0.00", isLeverageSafe: false, theoreticalRR: "0.00", maxLeverage: 1, costDragUSD: "0.00", kellyPct: 0 };
    if (!autoData || !tradeSetup.entry || tradeSetup.entry <= 0 || tradeSetup.slTech <= 0) return safeResult;
    
    const riskDiff = Math.abs(tradeSetup.entry - tradeSetup.slTech);
    const rewardDiff = Math.abs(tradeSetup.tpTech - tradeSetup.entry);
    
    const costDragPerCoin = QuantMath.costDrag(tradeSetup.entry, tradeSetup.tradeType, tradeSetup.execution, autoData.fundingRate / 100, manualData.bidAskSpread);
    
    let theoreticalRR = riskDiff > 0 ? ((rewardDiff - costDragPerCoin) / (riskDiff + costDragPerCoin)) : 0;
    if (!isFinite(theoreticalRR) || isNaN(theoreticalRR) || theoreticalRR < 0) theoreticalRR = 0;

    const totalSlDistance = riskDiff + (1.2 * autoData.atr14);
    let slPercent = totalSlDistance / tradeSetup.entry;
    if (!isFinite(slPercent) || isNaN(slPercent) || slPercent === 0) slPercent = 0.01;

    const capitalSafe = manualData.capital > 0 ? manualData.capital : 10000;
    const riskAmountUSD = capitalSafe * (tradeSetup.riskPercent / 100);
    let positionSizeUSD = riskAmountUSD / slPercent;
    if (!isFinite(positionSizeUSD) || isNaN(positionSizeUSD)) positionSizeUSD = 0;

    const totalCostDragUSD = costDragPerCoin * (positionSizeUSD / tradeSetup.entry);

    let effectiveLeverage = tradeSetup.tradeType === 'SPOT' ? 1.0 : (positionSizeUSD / capitalSafe);
    if (!isFinite(effectiveLeverage) || isNaN(effectiveLeverage)) effectiveLeverage = 0;
    
    let maxLeverage = symbol === 'BTCUSDT' || symbol === 'ETHUSDT' ? 5 : 3;
    if (apiMacro.volBreakout === 'BREAKOUT' || apiMacro.isWeekend) maxLeverage = 1.5; 

    const isLeverageSafe = tradeSetup.tradeType === 'SPOT' ? true : effectiveLeverage <= maxLeverage;
    const kellyDec = QuantMath.kellyCriterion(tradeStats.winRate, tradeStats.historicalRR);
    const kellyPct = tradeStats.hasEnoughData ? (kellyDec * 100) : 0;

    return {
      slPercent: (slPercent * 100).toFixed(2), riskAmountUSD: riskAmountUSD.toFixed(2), positionSizeUSD: positionSizeUSD.toFixed(2),
      effectiveLeverage: effectiveLeverage.toFixed(2), isLeverageSafe, theoreticalRR: theoreticalRR.toFixed(2), maxLeverage, costDragUSD: totalCostDragUSD.toFixed(2),
      kellyPct: kellyPct.toFixed(2)
    };
  }, [autoData, apiMacro, manualData, tradeSetup, symbol, tradeStats]);

  const handleMasterAuto = () => {
    if (!autoData || !mathCore) return;
    let suggestedType = 'FUTURES';
    let suggestedDirection = autoData.currentPrice > autoData.ema34 ? 'LONG' : 'SHORT'; 
    
    if (autoData.rsi < 30 && apiMacro.fgiValue < 20 && intervalTime === '1d') {
      suggestedType = 'SPOT'; suggestedDirection = 'LONG';
    }

    const isTrend = autoData.adx > 25;
    const slMultiplier = isTrend ? 2 : 1.2;
    const tpMultiplier = isTrend ? 4 : 2.5;

    const sl = suggestedDirection === 'LONG' ? autoData.currentPrice - (slMultiplier * autoData.atr14) : autoData.currentPrice + (slMultiplier * autoData.atr14);
    const tp = suggestedDirection === 'LONG' ? autoData.currentPrice + (tpMultiplier * autoData.atr14) : autoData.currentPrice - (tpMultiplier * autoData.atr14);

    setTradeSetup(prev => ({
      ...prev, tradeType: suggestedType, direction: suggestedDirection, execution: 'LIMIT',
      entry: autoData.currentPrice, slTech: parseFloat(sl.toFixed(2)), tpTech: parseFloat(tp.toFixed(2))
    }));
    showToast("✅ Auto Setup: Tối ưu Rủi ro thanh khoản.");
  };

  const logicGates = useMemo(() => {
    if (!autoData || !mathCore) return { hardGates: [], softGates: [], softCount: 0, isApproved: false };
    
    const isFundingExtreme = Math.abs(autoData.fundingRate) > 0.05;
    const isLsrExtreme = apiMacro.longShortRatio > 2.5 || apiMacro.longShortRatio < 0.4;
    const isPsychoTrap = (isFundingExtreme && autoData.isOiSpiking) || isLsrExtreme;
    const isSqueeze = autoData.bbw < 5 && autoData.adx < 20; 
    
    const isSocialTrap = manualData.socialSentiment === 'EUPHORIA' && apiMacro.takerBuySellRatio < 1;
    const isWeekendTrap = apiMacro.isWeekend && tradeSetup.tradeType === 'FUTURES' && mathCore.effectiveLeverage > 2;

    const isHtfAligned = tradeSetup.direction === 'LONG' 
        ? autoData.currentPrice > autoData.htfSma200 
        : autoData.currentPrice < autoData.htfSma200;
    
    const isSFP = tradeSetup.direction === 'LONG' ? autoData.isBullishSFP : autoData.isBearishSFP;

    const hardGates = [
      { id: 'h1', passed: tradeSetup.execution === 'LIMIT', text: "EXECUTION: Limit Order (Tránh trượt giá / Spread cắn tài khoản)" },
      { id: 'h2', passed: mathCore.isLeverageSafe && parseFloat(mathCore.positionSizeUSD) > 0, text: `RISK: Margin an toàn (<= ${mathCore.maxLeverage}x) đã tính rủi ro Breakout` },
      { id: 'h3', passed: tradeStats.hasEnoughData ? mathCore.kellyPct > 0 : parseFloat(mathCore.theoreticalRR) >= 1.5, 
        text: tradeStats.hasEnoughData 
          ? `EXPECTANCY: Kelly Dương (${mathCore.kellyPct}% Vốn)` 
          : `EXPECTANCY: R:R >= 1.5 (Chưa đủ lịch sử Kelly)` }
    ];

    const softGates = [
      { id: 's1', passed: autoData.adx > 25 || isSqueeze, text: `REGIME: Có xu hướng (ADX: ${autoData.adx.toFixed(1)}) hoặc Squeeze (BBW: ${autoData.bbw.toFixed(1)}%)` },
      { id: 's2', passed: !isSocialTrap, text: `SOCIAL: Dòng tiền Social (${manualData.socialSentiment}) đồng thuận với Taker Volume.` },
      { id: 's3', passed: !isPsychoTrap && apiMacro.microStress !== 'EXTREME' && !isWeekendTrap, text: `MICROSTRUCTURE: Thanh khoản an toàn, Không kẹt bẫy Micro Stress.` },
      { id: 's4', passed: isHtfAligned, text: `HTF TREND: Lệnh ${tradeSetup.direction} đang thuận xu hướng vĩ mô (D1 SMA200).` },
      { id: 's5', passed: isSFP, text: `ACTION SFP: Đã có nến quét thanh khoản (Rút râu tại đáy/đỉnh cục bộ).` }
    ];

    const hardPassed = hardGates.every(g => g.passed);
    const softCount = softGates.filter(g => g.passed).length;
    const isApproved = hardPassed && softCount >= 4 && !systemError;

    return { hardGates, softGates, softCount, isApproved };
  }, [autoData, mathCore, tradeSetup, apiMacro, manualData, tradeStats, systemError]);

  const runGeminiAnalysis = async () => {
    if (geminiCooldown > 0) return;
    if (!autoData || !mathCore) return;
    
    const apiKey = geminiApiKey; 
    if (!apiKey) { setAiAnalysis('⚠️ LỖI: Chưa cấu hình VITE_GEMINI_API_KEY trên Netlify.'); return; }

    setIsAnalyzing(true);
    setAiAnalysis('');
    
    try {
      const winRateContext = tradeStats.hasEnoughData 
        ? `Lịch sử ${tradeStats.totalClosed} lệnh của ${symbol}, Win Rate: ${(tradeStats.winRate * 100).toFixed(1)}%, Avg R:R: ${tradeStats.historicalRR.toFixed(2)}.` 
        : `Trader mới, dữ liệu quá mỏng (< 10 lệnh), cẩn thận Overfitting.`;

      const prompt = `
        Giao thức "ANTI-FRAGILE V4.7 - INSTITUTIONAL QUANT MANAGER".
        Vai trò: Giám đốc Quản trị Rủi ro (Hedge Fund).
        
        LỊCH SỬ DB: ${winRateContext}

        VĨ MÔ API THỰC CHỨNG (${symbol} - ${intervalTime}):
        - Biến động: Vol Breakout = ${apiMacro.volBreakout}
        - Microstructure Stress: ${apiMacro.microStress} | Taker Buy/Sell: ${apiMacro.takerBuySellRatio.toFixed(2)}
        - News Trap (Manual): ${manualData.newsTrap ? 'ĐANG CÓ' : 'KHÔNG'} | Đám đông (Manual): ${manualData.socialSentiment}
        
        THÔNG SỐ LỆNH (RISK METRICS):
        - Setup: ${tradeSetup.tradeType} ${tradeSetup.direction} | Loại lệnh: ${tradeSetup.execution}.
        - HTF Đồng pha: ${logicGates.softGates.find(g=>g.id==='s4').passed ? 'CÓ' : 'KHÔNG'} | Quét SFP: ${logicGates.softGates.find(g=>g.id==='s5').passed ? 'CÓ' : 'KHÔNG'}
        - Cost Drag (Phí ma sát): $${mathCore.costDragUSD}.

        Yêu cầu phản biện:
        1. Đánh giá sự đồng thuận giữa Dòng tiền chủ động (Taker), Hành vi Giá (SFP/HTF) thuật toán vừa quét được, và bẫy tin tức.
        2. Lệnh này có đang đâm đầu vào Micro Stress cao hoặc bị cắn quá nhiều phí ma sát không?
        3. Kết luận: Cho phép giao dịch hay đứng ngoài?
        Trả lời sắc bén, chuyên môn, đúng 4 câu tiếng Việt. Không dùng định dạng markdown rườm rà.
      `;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/interactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ model: "gemini-3.5-flash", input: prompt })
      });

      if (!response.ok) { if (response.status === 429) throw new Error('RATE_LIMIT'); throw new Error('API_ERROR'); }
      
      const data = await response.json();
      const outputStep = data.steps?.find(step => step.type === 'model_output');
      const textResponse = outputStep?.content?.[0]?.text || 'Lỗi trích xuất ngôn ngữ từ AI.';
      
      setAiAnalysis(textResponse);
      setGeminiCooldown(15); 
    } catch (error) {
      console.error(error);
      setAiAnalysis(error.message === 'RATE_LIMIT' ? '❌ Lỗi 429: Rate Limit. Chờ 30s.' : '❌ Lỗi kết nối Gemini API.');
      setGeminiCooldown(30); 
    }
    setIsAnalyzing(false);
  };

  const handleSaveTradeLog = async () => {
    if (!supabase) { showToast("❌ Không có Supabase URL."); return; }
    try {
      const payload = {
        symbol, interval: intervalTime, type: tradeSetup.tradeType, direction: tradeSetup.direction,
        entry: parseFloat(tradeSetup.entry), sl: parseFloat(tradeSetup.slTech), tp: parseFloat(tradeSetup.tpTech),
        risk_amount_usd: parseFloat(mathCore.riskAmountUSD), rr: parseFloat(mathCore.theoreticalRR),
        adx: autoData.adx, atr: autoData.atr14, funding_rate: autoData.fundingRate,
        oi_spiking: Boolean(autoData.isOiSpiking), fgi: parseFloat(apiMacro.fgiValue),
        trend_sma200: (autoData.currentPrice > autoData.sma200) ? 'ABOVE' : 'BELOW',
        mvrv: parseFloat(manualData.mvrvZScore), 
        liquidations: apiMacro.microStress, 
        news_trap: Boolean(manualData.newsTrap), 
        leverage: parseFloat(mathCore.effectiveLeverage),
        status: 'OPEN', pnl_usd: 0
      };
      const { error } = await supabase.from('trade_logs').insert([payload]);
      if (error) throw error;
      showToast("☁️ Lệnh Limit đã được niêm phong vào Supabase.");
    } catch (e) { showToast(`❌ Lỗi Ghi Log: ${e.message}`); }
  };

  const handleManualClose = async (logId, direction, entry, logSl, riskUsd) => {
    if (!supabase || !autoData) return;
    const currentPx = autoData.currentPrice;
    let pnl = 0;
    const riskDistance = Math.abs(entry - logSl);
    if (riskDistance > 0) {
       const positionCoins = riskUsd / riskDistance;
       if (direction === 'LONG') pnl = (currentPx - entry) * positionCoins;
       else pnl = (entry - currentPx) * positionCoins;
       
       const closeCost = QuantMath.costDrag(currentPx, 'FUTURES', 'LIMIT', autoData.fundingRate/100, manualData.bidAskSpread, 1);
       pnl = pnl - (closeCost * positionCoins / currentPx);
    }
    try {
      await supabase.from('trade_logs').update({ status: pnl >= 0 ? 'WIN' : 'LOSS', close_price: currentPx, pnl_usd: pnl }).eq('id', logId);
      showToast(`✂️ Đã đóng vị thế. PnL (Đã trừ phí): ${pnl.toFixed(2)}$`);
    } catch (e) { console.error(e); }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-slate-200 font-mono p-2 md:p-6 selection:bg-emerald-500/30 relative">
      
      {systemError && (
        <div className="fixed top-0 left-0 w-full bg-red-600/90 text-white text-center py-1.5 text-xs font-bold z-[100] flex justify-center items-center gap-2 shadow-lg">
          <ServerCrash className="w-4 h-4 animate-pulse"/> BINANCE API DOWN. KIỂM TRA LẠI MẠNG!
        </div>
      )}
      {toast && (
        <div className="fixed top-12 left-1/2 -translate-x-1/2 z-50 bg-slate-900 border border-slate-700 px-4 py-2 rounded shadow-2xl flex items-center gap-2">
          <Bell className="w-4 h-4 text-emerald-400" /> <span className="text-xs">{toast}</span>
        </div>
      )}

      {/* HEADER */}
      <div className="max-w-7xl mx-auto mb-6 flex flex-col md:flex-row justify-between items-center gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <h1 className="text-xl md:text-2xl font-black text-emerald-500 flex items-center gap-2 tracking-tighter">
            <BrainCircuit className="w-7 h-7" /> ANTI-FRAGILE <span className="text-slate-500">V4.8 (Pure Data)</span>
          </h1>
          <p className="text-slate-500 text-[10px] mt-1 uppercase tracking-widest flex items-center gap-2">
            {lastUpdated ? `Sync: ${lastUpdated.toLocaleTimeString()}` : 'Khởi động Core...'}
            {apiMacro.isWeekend && <span className="text-amber-500 border border-amber-900/50 bg-amber-900/10 px-1.5 rounded">CẢNH BÁO CUỐI TUẦN</span>}
            {tradeStats.hasEnoughData && (
               <span className="text-purple-400 border border-purple-900/50 bg-purple-900/10 px-1.5 rounded">
                 WR: {(tradeStats.winRate * 100).toFixed(1)}% | Avg R:R: {tradeStats.historicalRR.toFixed(2)}
               </span>
            )}
          </p>
        </div>
        
        <div className="flex items-center gap-2 bg-slate-900/50 p-1.5 rounded border border-slate-800">
          <select className="bg-black text-emerald-400 font-bold px-3 py-1.5 rounded border border-slate-700/50 outline-none text-sm" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            <option value="BTCUSDT">BTC/USDT</option>
            <option value="ETHUSDT">ETH/USDT</option>
            <option value="SOLUSDT">SOL/USDT</option>
          </select>
          <select className="bg-black text-blue-400 font-bold px-3 py-1.5 rounded border border-slate-700/50 outline-none text-sm" value={intervalTime} onChange={(e) => setIntervalTime(e.target.value)}>
            <option value="15m">M15 (Scalp)</option>
            <option value="1h">H1 (Day)</option>
            <option value="4h">H4 (Swing)</option>
            <option value="1d">D1 (Trend)</option>
          </select>
          <div className="px-3 border-l border-slate-700/50">
            {loading ? <Loader2 className="w-4 h-4 animate-spin text-slate-500"/> : <Activity className="w-4 h-4 text-emerald-500"/>}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* CỘT TRÁI */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* ZONE 1: API DATA ALERTS */}
          <div className="bg-[#111116] border border-blue-900/30 rounded-xl p-4 shadow-xl">
            <h2 className="text-[10px] font-bold text-blue-400 uppercase flex items-center gap-2 mb-4">
              <Database className="w-3 h-3 text-blue-400" /> THỰC CHỨNG MICROSTRUCTURE (LIVE API)
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="bg-black/50 p-2 rounded border border-slate-800">
                  <label className="text-[8px] text-slate-500 block mb-1">L/S RATIO</label>
                  <div className={`font-bold text-sm mt-1 ${apiMacro.longShortRatio > 2.5 ? 'text-red-500' : 'text-blue-400'}`}>
                    {apiMacro.longShortRatio.toFixed(2)}
                  </div>
                </div>
                <div className="bg-black/50 p-2 rounded border border-slate-800">
                  <label className="text-[8px] text-slate-500 block mb-1">TAKER BUY/SELL</label>
                  <div className={`font-bold text-sm mt-1 ${apiMacro.takerBuySellRatio > 1 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {apiMacro.takerBuySellRatio.toFixed(2)}
                  </div>
                </div>
                <div className="bg-black/50 p-2 rounded border border-slate-800">
                  <label className="text-[8px] text-slate-500 block mb-1">F&G (API)</label>
                  <div className="font-bold text-sm text-orange-400 mt-1">{apiMacro.fgiValue}</div>
                </div>

                <div className="bg-black/50 p-2 rounded border border-purple-900/50">
                  <label className="text-[8px] text-purple-500 block mb-1">VOL BREAKOUT</label>
                  <div className={`font-bold text-[10px] mt-1 ${apiMacro.volBreakout === 'BREAKOUT' ? 'text-purple-400 animate-pulse' : 'text-slate-400'}`}>
                    {apiMacro.volBreakout}
                  </div>
                </div>
                <div className="bg-black/50 p-2 rounded border border-red-900/50">
                  <label className="text-[8px] text-red-500 block mb-1 flex items-center gap-1"><Key className="w-2 h-2"/> MICRO STRESS</label>
                  <div className={`font-bold text-[10px] mt-1 ${apiMacro.microStress === 'EXTREME' ? 'text-red-500' : apiMacro.microStress === 'HIGH' ? 'text-orange-400' : 'text-emerald-500'}`}>
                    {apiMacro.microStress}
                  </div>
                </div>
            </div>
            
            <div className="mt-4 p-2 bg-slate-900/50 rounded border border-slate-800 grid grid-cols-4 gap-2 text-center">
               <div><span className="block text-[8px] text-slate-500">RSI (14)</span><span className={`text-[10px] font-bold ${autoData?.rsi > 70 ? 'text-red-400' : autoData?.rsi < 30 ? 'text-emerald-400' : 'text-slate-300'}`}>{autoData?.rsi.toFixed(1) || '0.0'}</span></div>
               <div><span className="block text-[8px] text-slate-500">OBV</span><span className="text-[10px] font-bold text-blue-400">{autoData?.obv > 1000 ? (autoData?.obv/1000).toFixed(1)+'K' : autoData?.obv.toFixed(0) || '0'}</span></div>
               <div><span className="block text-[8px] text-slate-500">BBW SQUEEZE</span><span className={`text-[10px] font-bold ${autoData?.bbw < 5 ? 'text-amber-400' : 'text-slate-300'}`}>{autoData?.bbw.toFixed(2) || '0.00'}%</span></div>
               <div><span className="block text-[8px] text-slate-500">HTF D1 TREND</span><span className={`text-[10px] font-bold ${autoData?.currentPrice > autoData?.htfSma200 ? 'text-emerald-500' : 'text-red-500'}`}>{autoData?.currentPrice > autoData?.htfSma200 ? 'BULL' : 'BEAR'}</span></div>
            </div>
          </div>

          {/* ZONE 2: BẢNG NHẬP TAY */}
          <div className="bg-[#111116] border border-amber-900/30 rounded-xl p-4 shadow-xl">
             <h2 className="text-[10px] font-bold text-amber-500 uppercase flex items-center gap-2 mb-4">
               <Settings2 className="w-3 h-3 text-amber-500" /> BẢNG GHI ĐÈ THỦ CÔNG (MANUAL OVERRIDES)
             </h2>
             <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800 focus-within:border-yellow-500/50">
                  <label className="text-[8px] text-slate-500 block mb-1">BTC DOM (%)</label>
                  <input type="number" step="0.1" value={manualData.btcDominance} onChange={e => setManualData({...manualData, btcDominance: Number(e.target.value)})} className="w-full bg-transparent text-yellow-500 font-bold outline-none text-[10px]"/>
                </div>
                <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800 focus-within:border-cyan-500/50">
                  <label className="text-[8px] font-bold text-cyan-500 block mb-1">SOCIAL</label>
                  <select value={manualData.socialSentiment} onChange={e => setManualData({...manualData, socialSentiment: e.target.value})} className="w-full bg-transparent text-cyan-400 font-bold outline-none text-[10px] cursor-pointer mt-1">
                    <option value="NEUTRAL">Trung lập</option>
                    <option value="BEARISH">Tuyệt vọng</option>
                    <option value="EUPHORIA">Hưng phấn</option>
                  </select>
                </div>
                <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800 focus-within:border-amber-500/50">
                  <label className="text-[8px] text-slate-500 block mb-1">SPREAD (%)</label>
                  <input type="number" step="0.01" value={manualData.bidAskSpread} onChange={e => setManualData({...manualData, bidAskSpread: Number(e.target.value)})} className="w-full bg-transparent text-amber-400 font-bold outline-none text-[10px]"/>
                </div>
                <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800 focus-within:border-pink-500/50">
                  <label className="text-[8px] text-slate-500 block mb-1">MVRV Z</label>
                  <input type="number" step="0.1" value={manualData.mvrvZScore} onChange={e => setManualData({...manualData, mvrvZScore: Number(e.target.value)})} className="w-full bg-transparent text-pink-400 font-bold outline-none text-[10px]"/>
                </div>
                <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800 focus-within:border-emerald-500/50">
                  <label className="text-[8px] text-slate-500 block mb-1">VỐN ($)</label>
                  <input type="number" value={manualData.capital} onChange={e => setManualData({...manualData, capital: Number(e.target.value)})} className="w-full bg-transparent text-emerald-400 font-bold outline-none text-[10px]"/>
                </div>
                <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800 focus-within:border-red-500/50 flex flex-col items-center justify-center gap-1">
                  <label className="text-[8px] font-bold text-red-500 uppercase">News Trap</label>
                  <input type="checkbox" checked={manualData.newsTrap} onChange={e => setManualData({...manualData, newsTrap: e.target.checked})} className="accent-red-500 w-3.5 h-3.5 cursor-pointer"/>
                </div>
             </div>
          </div>

          {/* VÙNG THIẾT LẬP LỆNH */}
          <div className="bg-[#111116] border border-slate-800 rounded-xl p-4 shadow-xl">
             <div className="flex items-center justify-between mb-4 border-b border-slate-800/80 pb-3">
                <button onClick={handleMasterAuto} disabled={!autoData} className="bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-500/30 px-3 py-1.5 rounded text-[10px] font-bold flex items-center gap-2">
                  <Zap className="w-3 h-3" /> AUTO SETUP
                </button>
                <div className="text-[9px] px-2 py-0.5 bg-slate-800 rounded text-slate-400 border border-slate-700">Giá: <span className="text-white font-bold">${autoData?.currentPrice || '---'}</span></div>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <button onClick={() => setTradeSetup({...tradeSetup, tradeType: 'FUTURES'})} className={`flex-1 py-1.5 text-[10px] font-bold rounded shadow-sm ${tradeSetup.tradeType === 'FUTURES' ? 'bg-indigo-500 text-white' : 'bg-[#0a0a0c] border border-slate-800 text-slate-500 hover:bg-slate-900'}`}>FUTURES</button>
                    <button onClick={() => setTradeSetup({...tradeSetup, tradeType: 'SPOT'})} className={`flex-1 py-1.5 text-[10px] font-bold rounded shadow-sm ${tradeSetup.tradeType === 'SPOT' ? 'bg-amber-500 text-black' : 'bg-[#0a0a0c] border border-slate-800 text-slate-500 hover:bg-slate-900'}`}>SPOT</button>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setTradeSetup({...tradeSetup, direction: 'LONG'})} className={`flex-1 py-1.5 text-[10px] font-bold rounded flex justify-center gap-1 shadow-sm ${tradeSetup.direction === 'LONG' ? 'bg-emerald-500 text-black' : 'bg-[#0a0a0c] border border-slate-800 text-slate-500 hover:bg-slate-900'}`}><TrendingUp className="w-3 h-3"/> LONG</button>
                    <button onClick={() => setTradeSetup({...tradeSetup, direction: 'SHORT'})} className={`flex-1 py-1.5 text-[10px] font-bold rounded flex justify-center gap-1 shadow-sm ${tradeSetup.direction === 'SHORT' ? 'bg-red-500 text-white' : 'bg-[#0a0a0c] border border-slate-800 text-slate-500 hover:bg-slate-900'}`}><TrendingDown className="w-3 h-3"/> SHORT</button>
                  </div>

                  <div className="flex gap-2 mt-2">
                     <button onClick={() => setTradeSetup({...tradeSetup, execution: 'LIMIT'})} className={`flex-1 py-1.5 text-[9px] font-bold rounded border ${tradeSetup.execution === 'LIMIT' ? 'bg-blue-900/40 text-blue-400 border-blue-500/50' : 'bg-black text-slate-600 border-slate-800'}`}>MAKER (LIMIT - AN TOÀN)</button>
                     <button onClick={() => setTradeSetup({...tradeSetup, execution: 'MARKET'})} className={`flex-1 py-1.5 text-[9px] font-bold rounded border ${tradeSetup.execution === 'MARKET' ? 'bg-red-900/40 text-red-400 border-red-500/50' : 'bg-black text-slate-600 border-slate-800'}`}>TAKER (MARKET - RỦI RO)</button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-2">
                     <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800">
                      <label className="text-[8px] font-bold text-slate-400 block mb-1">RISK (%) [MAX 2.0%]</label>
                      <input type="number" step="0.1" value={tradeSetup.riskPercent} onChange={handleRiskChange} className="w-full bg-transparent text-emerald-400 font-bold outline-none text-sm"/>
                     </div>
                     <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800">
                      <label className="text-[8px] font-bold text-slate-400 block mb-1">GIÁ ENTRY</label>
                      <input type="number" value={tradeSetup.entry} onChange={e=>setTradeSetup({...tradeSetup, entry:Number(e.target.value)})} className="w-full bg-transparent text-white font-bold outline-none text-sm"/>
                     </div>
                     <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800">
                      <label className="text-[8px] font-bold text-red-500 block mb-1">STOP LOSS</label>
                      <input type="number" value={tradeSetup.slTech} onChange={e=>setTradeSetup({...tradeSetup, slTech:Number(e.target.value)})} className="w-full bg-transparent text-red-400 font-bold outline-none text-sm"/>
                     </div>
                     <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800">
                      <label className="text-[8px] font-bold text-emerald-500 block mb-1">TAKE PROFIT</label>
                      <input type="number" value={tradeSetup.tpTech} onChange={e=>setTradeSetup({...tradeSetup, tpTech:Number(e.target.value)})} className="w-full bg-transparent text-emerald-400 font-bold outline-none text-sm"/>
                     </div>
                  </div>
                </div>

                {/* KHUNG KẾT QUẢ ĐẦU RA SAU TÍNH TOÁN */}
                <div className="bg-gradient-to-br from-slate-900 to-[#0a0a0c] p-4 rounded-lg border border-slate-800 flex flex-col justify-between shadow-inner relative">
                  <div className="absolute top-2 right-2 text-[8px] text-slate-600 font-bold border border-slate-800 px-1.5 py-0.5 rounded uppercase">Số Liệu Giải Ngân</div>
                  <div className="space-y-3 mt-4">
                    <div className="flex justify-between items-end border-b border-slate-800 pb-1.5">
                      <span className="text-[10px] font-bold text-slate-500">Mất tối đa (Risk USD):</span>
                      <span className="text-red-400 font-black text-sm">${mathCore?.riskAmountUSD}</span>
                    </div>
                    <div className="flex justify-between items-end border-b border-slate-800 pb-1.5">
                      <span className="text-[10px] font-bold text-slate-500">Cost Drag (Fee+Spread):</span>
                      <span className="text-amber-500 font-black text-[10px]">-${mathCore?.costDragUSD}</span>
                    </div>
                    <div className="flex justify-between items-end border-b border-slate-800 pb-1.5">
                      <span className="text-[10px] font-bold text-slate-500">Kỳ Vọng (R:R thực tế):</span>
                      <span className={`font-black text-sm ${parseFloat(mathCore?.theoreticalRR) >= 1.5 ? 'text-emerald-400' : 'text-amber-500'}`}>1 : {mathCore?.theoreticalRR}</span>
                    </div>
                    <div className="flex justify-between items-center bg-slate-950 p-2 rounded border border-slate-800">
                      <div className="flex flex-col gap-1">
                        <span className="text-[8px] text-slate-500 uppercase font-bold flex items-center gap-1"><BarChart3 className="w-3 h-3 text-cyan-500"/> Kỳ Vọng EV Lịch Sử:</span>
                        {tradeStats.hasEnoughData ? (
                          <span className={`text-[11px] font-black ${mathCore?.kellyPct > 0 ? 'text-cyan-400' : 'text-red-400'}`}>{mathCore?.kellyPct > 0 ? `+${mathCore?.kellyPct}% VỐN` : 'ÂM (LỖ DÀI HẠN)'}</span>
                        ) : (
                          <span className="text-[9px] text-slate-500 flex items-center gap-1"><Lock className="w-2.5 h-2.5"/> [ƯỚC TÍNH - THIẾU DATA]</span>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                         <span className="text-[8px] text-slate-500 uppercase font-bold">Đòn Bẩy Max:</span>
                         <span className={`px-2 py-0.5 rounded text-[10px] font-black ${mathCore?.isLeverageSafe ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                           {tradeSetup.tradeType === 'SPOT' ? '1.00x' : `${mathCore?.effectiveLeverage}x / ${mathCore?.maxLeverage}x`}
                         </span>
                      </div>
                    </div>
                  </div>
                </div>
             </div>
          </div>

        </div>

        {/* CỘT PHẢI: BỘ LỌC KIỂM DUYỆT CHỐNG RỦI RO */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          
          {/* AI QUANT BOT X SUPABASE */}
          <div className="bg-[#111116] border border-blue-900/40 rounded-xl p-4">
             <h2 className="text-[10px] font-bold text-blue-400 uppercase flex items-center gap-2 mb-3">
               <Bot className="w-3.5 h-3.5" /> GEMINI FUND MANAGER (SUPABASE INTEGRATED)
             </h2>
             <button onClick={runGeminiAnalysis} disabled={isAnalyzing || !autoData || geminiCooldown > 0} className="w-full py-2 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded text-[10px] font-bold flex items-center justify-center gap-2">
               {isAnalyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
               QUÉT LỊCH SỬ DB & ĐÁNH GIÁ RỦI RO
             </button>
             {aiAnalysis && (
               <div className="mt-3 bg-[#0a0a0c] p-3 rounded border border-blue-900/30 text-[10.5px] text-slate-300 whitespace-pre-line leading-relaxed">
                 <span className="text-blue-500 mr-1">{'>'}</span> {aiAnalysis}
               </div>
             )}
          </div>

          <div className="bg-[#111116] border border-slate-800 rounded-xl p-4 flex-grow flex flex-col shadow-xl">
             <h2 className="text-[10px] font-bold text-slate-300 uppercase mb-4 flex items-center gap-2 border-b border-slate-800 pb-3"><ShieldAlert className="w-4 h-4 text-emerald-500" /> BỘ LỌC KIỂM DUYỆT (Hard/Soft Gates)</h2>

             {/* TỔNG HỢP KIỂM DUYỆT: HARD GATES */}
             <div className="mb-2">
                <span className="text-[8px] font-black text-red-500 uppercase tracking-widest block mb-2 border-b border-slate-800 pb-1">Cửa tử - Hard Gates (Bắt buộc 100%)</span>
                <div className="space-y-2">
                  {logicGates.hardGates.map((item) => (
                    <div key={item.id} className="flex items-start gap-2.5 bg-red-950/10 p-2 rounded border border-red-900/20">
                      {item.passed ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />}
                      <span className={`text-[9.5px] leading-relaxed font-bold ${item.passed ? 'text-slate-300' : 'text-red-400'}`}>{item.text}</span>
                    </div>
                  ))}
                </div>
             </div>

             {/* TỔNG HỢP KIỂM DUYỆT: SOFT GATES */}
             <div className="flex-grow mt-3">
                <span className="text-[8px] font-black text-blue-500 uppercase tracking-widest block mb-2 border-b border-slate-800 pb-1">
                   Tín hiệu động - Soft Gates (Yêu cầu 4/5 | Hiện tại: {logicGates.softCount})
                </span>
                <div className="space-y-2">
                  {logicGates.softGates.map((item) => (
                    <div key={item.id} className="flex items-start gap-2.5 bg-blue-950/10 p-2 rounded border border-blue-900/20 transition-all duration-300">
                      {item.passed ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 text-slate-700 shrink-0 mt-0.5" />}
                      <span className={`text-[9.5px] leading-relaxed font-medium ${item.passed ? 'text-slate-300' : 'text-slate-600 line-through'}`}>{item.text}</span>
                    </div>
                  ))}
                </div>
             </div>

             {/* NÚT LƯU LỆNH DATABASE */}
             <div className="mt-5 pt-5 border-t border-slate-800 flex flex-col gap-2">
                {!logicGates.isApproved && (
                  <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-[9px] p-2 rounded flex items-center gap-1.5 mb-2">
                    <AlertTriangle className="w-3 h-3 shrink-0" /> Hệ thống khóa: Lệnh rớt Hard Gate hoặc chưa đủ Soft Gate (Đạt {logicGates.softCount}/5).
                  </div>
                )}
                <button disabled={!logicGates.isApproved} onClick={handleSaveTradeLog} className={`w-full py-4 rounded-lg font-black text-[11px] tracking-widest flex items-center justify-center gap-2 transition-all duration-300 shadow-xl
                    ${logicGates.isApproved ? 'bg-emerald-500 text-black hover:bg-emerald-400 hover:scale-[1.01] shadow-[0_0_15px_rgba(16,185,129,0.3)]' : 'bg-slate-800/50 text-slate-600 border border-slate-700 cursor-not-allowed'}`}>
                  {logicGates.isApproved ? <><Save className="w-4 h-4"/> ĐỦ ĐIỀU KIỆN - LƯU VÀO SỔ TAY DB</> : 'KHÓA BẢO VỆ: CHƯA ĐẠT CHUẨN'}
                </button>
             </div>
          </div>

        </div>
      </div>
    </div>
  );
}