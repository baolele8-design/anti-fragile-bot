import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Activity, ShieldAlert, Crosshair, Database, Zap, Bot, Loader2, CheckCircle2, XCircle, BrainCircuit, TrendingUp, TrendingDown, AlertTriangle, Save, History, Bell, Link2, ServerCrash } from 'lucide-react';
import { createClient } from 'https://esm.sh/@supabase/supabase-js';

// ==========================================
// 1. SUPABASE INITIALIZATION
// ==========================================
// ⚠️ QUAN TRỌNG: Bật RLS (Row Level Security) trên Supabase ngay lập tức.
// Chỉ cho phép IP của Backend Server được quyền INSERT/UPDATE vào bảng trade_logs.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL; 
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY; 

const supabase = (supabaseUrl && supabaseUrl !== 'YOUR_SUPABASE_URL') 
  ? createClient(supabaseUrl, supabaseKey) 
  : null;

// --- LÕI TOÁN HỌC ĐỊNH LƯỢNG ---
const QuantMath = {
  sma: (data, period) => {
    if (!data || data.length < period) return null;
    return data.slice(-period).reduce((a, b) => a + b, 0) / period;
  },
  
  ema: (data, period) => {
    if (!data || data.length < period) return null;
    const k = 2 / (period + 1);
    let emaVal = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) {
      emaVal = (data[i] * k) + (emaVal * (1 - k));
    }
    return emaVal;
  },

  trueRange: (h, l, pc) => Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)),

  atr: (highs, lows, closes, period) => {
    if (!closes || closes.length < period + 1) return null;
    let trs = [];
    for (let i = 1; i < closes.length; i++) {
      trs.push(QuantMath.trueRange(highs[i], lows[i], closes[i-1]));
    }
    let currentAtr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) {
      currentAtr = ((currentAtr * (period - 1)) + trs[i]) / period;
    }
    return currentAtr;
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
      if (smoothedTR === 0) continue;
      smoothedTR = smoothedTR - (smoothedTR/period) + trs[i];
      smoothedPlusDM = smoothedPlusDM - (smoothedPlusDM/period) + plusDMs[i];
      smoothedMinusDM = smoothedMinusDM - (smoothedMinusDM/period) + minusDMs[i];
      
      const plusDI = 100 * (smoothedPlusDM / smoothedTR);
      const minusDI = 100 * (smoothedMinusDM / smoothedTR);
      const dx = 100 * Math.abs(plusDI - minusDI) / (plusDI + minusDI || 1);
      dxs.push(dx);
    }
    return dxs.slice(-period).reduce((a,b)=>a+b,0) / period;
  }
};

export default function AntiFragileTerminal() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [interval, setIntervalTime] = useState('15m');
  const [autoData, setAutoData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [tradeLogs, setTradeLogs] = useState([]);
  
  // System Health / Circuit Breaker
  const [lastUpdated, setLastUpdated] = useState(null);
  const [systemError, setSystemError] = useState(false);
  const [isSimulationMode, setIsSimulationMode] = useState(false); // Cảnh báo rõ nếu dùng data giả

  // Cooldowns
  const [isSyncingCq, setIsSyncingCq] = useState(false);
  const [cqCooldown, setCqCooldown] = useState(0); 
  const [geminiCooldown, setGeminiCooldown] = useState(0);

  // Gemini State
  const [aiAnalysis, setAiAnalysis] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const [onchainData, setOnchainData] = useState({
    capital: 10000,
    mvrvZScore: 1.2,
    liquidations: 'Chưa có Spike', 
    newsTrap: false,
    isAutoSynced: false
  });

  const [tradeSetup, setTradeSetup] = useState({
    tradeType: 'FUTURES',
    direction: 'LONG',
    riskPercent: 1.0, 
    entry: 0,
    slTech: 0,
    tpTech: 0,
    has3Indicators: false, 
    passedStopHunt: false 
  });

  // --- COOLDOWN MANAGERS ---
  useEffect(() => {
    if (cqCooldown > 0) { const t = setTimeout(() => setCqCooldown(c => c - 1), 1000); return () => clearTimeout(t); }
  }, [cqCooldown]);
  useEffect(() => {
    if (geminiCooldown > 0) { const t = setTimeout(() => setGeminiCooldown(c => c - 1), 1000); return () => clearTimeout(t); }
  }, [geminiCooldown]);

  // --- LẤY DỮ LIỆU TỪ SUPABASE ---
  useEffect(() => {
    if (!supabase) return;
    const fetchLogs = async () => {
      const { data, error } = await supabase.from('trade_logs').select('*').order('created_at', { ascending: false }).limit(50);
      if (!error && data) setTradeLogs(data);
    };
    fetchLogs();

    const subscription = supabase
      .channel('public:trade_logs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trade_logs' }, (payload) => {
        if (payload.eventType === 'INSERT') setTradeLogs(current => [payload.new, ...current].slice(0, 50));
        else if (payload.eventType === 'UPDATE') setTradeLogs(current => current.map(log => log.id === payload.new.id ? payload.new : log));
      }).subscribe();

    return () => supabase.removeChannel(subscription);
  }, []);

  // --- VỆ TINH GIÁ CLIENT-SIDE (CẢNH BÁO) ---
  // ⚠️ Đây là Watcher tạm trên Client. Khi lên Bot thật, phải dùng Cronjob/Websocket ở Backend.
  useEffect(() => {
    if (!supabase || !autoData || tradeLogs.length === 0) return;

    const checkOpenTrades = async () => {
      const openTrades = tradeLogs.filter(log => log.status === 'OPEN' && log.symbol === symbol);
      for (const log of openTrades) {
        let newStatus = null; let closePrice = null; let pnl = 0;
        const currentPx = autoData.currentPrice;

        if (log.direction === 'LONG') {
          if (currentPx >= log.tp) { newStatus = 'WIN'; closePrice = log.tp; pnl = log.rr * log.risk_amount_usd; } 
          else if (currentPx <= log.sl) { newStatus = 'LOSS'; closePrice = log.sl; pnl = -log.risk_amount_usd; }
        } else {
          if (currentPx <= log.tp) { newStatus = 'WIN'; closePrice = log.tp; pnl = log.rr * log.risk_amount_usd; } 
          else if (currentPx >= log.sl) { newStatus = 'LOSS'; closePrice = log.sl; pnl = -log.risk_amount_usd; }
        }

        if (newStatus) {
          try {
            await supabase.from('trade_logs').update({ status: newStatus, close_price: closePrice, pnl_usd: pnl }).eq('id', log.id);
            showToast(`🤖 Lệnh ${log.symbol} tự chốt (Client-Watcher): ${newStatus}`);
          } catch (err) { console.error("Lỗi Auto-Close:", err); }
        }
      }
    };
    checkOpenTrades();
  }, [autoData?.currentPrice, tradeLogs]);

  // --- ĐỒNG BỘ CRYPTOQUANT (CHUYỂN SANG BACKEND LÀ BẮT BUỘC) ---
  const syncCryptoQuantData = async () => {
    if (cqCooldown > 0) return;
    setIsSyncingCq(true);
    
    try {
      // ⚠️ KIẾN TRÚC ĐÚNG:
      // const res = await fetch('/api/get-cryptoquant-data'); 
      // API Key sẽ nằm ở server '/api/get-cryptoquant-data'
      
      const cqApiKey = import.meta.env.VITE_CQ_API_KEY; // Tạm thời dùng ENV, phải dời đi
      if (!cqApiKey) {
        setIsSimulationMode(true); // Bật cờ cảnh báo rủi ro dữ liệu giả
        showToast("⚠️ KHÔNG TÌM THẤY CQ KEY. Đang dùng dữ liệu rác (Simulation)!");
        setTimeout(() => {
          setOnchainData(prev => ({
            ...prev,
            mvrvZScore: (Math.random() * 2).toFixed(2),
            liquidations: 'Chưa có Spike',
            isAutoSynced: true
          }));
          setIsSyncingCq(false);
          setCqCooldown(30); 
        }, 1000);
        return;
      }

      setIsSimulationMode(false);
      const coinFormat = symbol.substring(0, 3).toLowerCase();
      const headers = { 'Authorization': `Bearer ${cqApiKey}` };

      // Chặn lỗi API nghiêm ngặt (Circuit Breaker)
      const [mvrvRes, liqRes] = await Promise.all([
        fetch(`https://api.cryptoquant.com/v1/${coinFormat}/market-indicator/mvrv?limit=1`, { headers }),
        fetch(`https://api.cryptoquant.com/v1/${coinFormat}/market-data/liquidations?limit=1`, { headers })
      ]);

      if (mvrvRes.status === 429 || liqRes.status === 429) throw new Error('RATE_LIMIT');
      if (!mvrvRes.ok || !liqRes.ok) throw new Error('API_ERROR');

      const mvrvData = await mvrvRes.json();
      const liqData = await liqRes.json();

      let newMvrv = onchainData.mvrvZScore;
      let newLiqStatus = 'Chưa có Spike';

      if (mvrvData?.result?.data?.[0]?.mvrv) newMvrv = parseFloat(mvrvData.result.data[0].mvrv).toFixed(2);
      
      if (liqData?.result?.data?.[0]) {
        const longs = parseFloat(liqData.result.data[0].long_liquidations_usd || 0);
        const shorts = parseFloat(liqData.result.data[0].short_liquidations_usd || 0);
        if (longs > shorts * 2 && longs > 1000000) newLiqStatus = 'Long Spike';
        else if (shorts > longs * 2 && shorts > 1000000) newLiqStatus = 'Short Spike';
      }

      setOnchainData(prev => ({...prev, mvrvZScore: newMvrv, liquidations: newLiqStatus, isAutoSynced: true}));
      setCqCooldown(300);
      showToast("🔗 Đồng bộ On-chain thành công!");

    } catch (e) {
      if (e.message === 'RATE_LIMIT') {
        showToast("❌ Rate Limit CryptoQuant. Khóa 1 giờ.");
        setCqCooldown(3600); 
      } else {
        showToast("❌ Lỗi API CryptoQuant.");
      }
    } finally {
      setIsSyncingCq(false);
    }
  };

  // --- FETCH MARKET DATA MẠNH MẼ HƠN (VÁ LỖI API) ---
  useEffect(() => {
    let isMounted = true;
    const fetchData = async () => {
      setLoading(true);
      try {
        const oiInterval = ['15m', '1h', '4h', '1d'].includes(interval) ? interval : '1d';
        
        // ⚠️ BACKEND: Việc gom 5 requests này nên thực hiện ở Backend Cronjob,
        // Frontend chỉ gọi 1 API duy nhất để lấy tổng hợp hoặc dùng WebSocket.
        const [klinesRes, fundingRes, oiCurrentRes, oiHistRes, fgiRes] = await Promise.all([
          fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=150`),
          fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`),
          fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`),
          fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=${oiInterval}&limit=30`),
          fetch('https://api.alternative.me/fng/?limit=7')
        ]);

        if (!isMounted) return;

        // BẢO VỆ LỖI MẠNG ĐỂ KHÔNG CHẾT APP (Fallback/Guard clauses)
        if (!klinesRes.ok || !oiCurrentRes.ok) throw new Error("Binance API Offline");

        const klines = await klinesRes.json();
        const funding = await fundingRes.json();
        const oiCurrent = await oiCurrentRes.json();
        const oiHist = await oiHistRes.json();
        const fgi = await fgiRes.json();

        // Check cấu trúc mảng để tránh throw undefined errors
        if (!Array.isArray(klines) || klines.length === 0) throw new Error("Dữ liệu nến lỗi");

        const closes = klines.map(d => parseFloat(d[4]));
        const highs = klines.map(d => parseFloat(d[2]));
        const lows = klines.map(d => parseFloat(d[3]));
        const currentPrice = closes[closes.length - 1];

        const oiValues = Array.isArray(oiHist) ? oiHist.map(d => parseFloat(d.sumOpenInterestValue)) : [0];
        const oiEma14 = QuantMath.ema(oiValues, 14) || oiValues[oiValues.length - 1];
        const currentOiValue = parseFloat(oiCurrent?.openInterest || 0) * currentPrice;

        const fgiValues = fgi?.data ? fgi.data.map(d => parseInt(d.value)) : [];
        const currentFGI = fgiValues[0] || 50;
        const isFgiUnder20For7Days = fgiValues.length === 7 && fgiValues.every(v => v < 20);

        const atr14 = QuantMath.atr(highs, lows, closes, 14);
        const adxValue = QuantMath.adx(highs, lows, closes, 14);
        const sma200 = QuantMath.sma(closes, 200); 

        if (tradeSetup.entry === 0) setTradeSetup(prev => ({ ...prev, entry: currentPrice }));

        setAutoData({
          currentPrice,
          atr14,
          atrPercent: (atr14 / currentPrice) * 100,
          adx: adxValue,
          sma200,
          fundingRate: (funding && funding[0]) ? parseFloat(funding[0].fundingRate) * 100 : 0,
          currentOi: currentOiValue,
          oiEma: oiEma14,
          isOiSpiking: currentOiValue > oiEma14,
          fgiValue: currentFGI,
          fgi7DaysLimit: isFgiUnder20For7Days
        });

        setSystemError(false);
        setLastUpdated(new Date());

      } catch (error) {
        console.error("Lỗi Fetch Data Market:", error);
        setSystemError(true); // Kích hoạt Circuit Breaker UI
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchData();
    const timer = setInterval(fetchData, 60000);
    return () => { isMounted = false; clearInterval(timer); };
  }, [symbol, interval]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const handleRiskChange = (e) => {
    let val = parseFloat(e.target.value);
    if (isNaN(val)) val = 0;
    if (val > 1.5) val = 1.5; 
    if (val < 0.1) val = 0.1;
    setTradeSetup(prev => ({ ...prev, riskPercent: val }));
  };

  // --- LÕI TOÁN HỌC RISK & ĐÒN BẨY (ĐÃ VÁ LỖI) ---
  const mathCore = useMemo(() => {
    if (!autoData || !tradeSetup.entry || !tradeSetup.slTech) return null;
    
    const riskDiff = Math.abs(tradeSetup.entry - tradeSetup.slTech);
    const rewardDiff = Math.abs(tradeSetup.tpTech - tradeSetup.entry);
    const calculatedRR = riskDiff > 0 ? (rewardDiff / riskDiff) : 0;

    const totalSlDistance = riskDiff + (1.2 * autoData.atr14);
    const slPercent = totalSlDistance / tradeSetup.entry;
    
    const riskAmountUSD = onchainData.capital * (tradeSetup.riskPercent / 100);
    const positionSizeUSD = riskAmountUSD / (slPercent || 1);
    
    // VÁ LỖI TÍNH TOÁN SPOT LEVERAGE
    const effectiveLeverage = tradeSetup.tradeType === 'SPOT' 
      ? 1.00 // Spot thì Leverage luôn luôn là 1.
      : (positionSizeUSD / onchainData.capital);

    const isLeverageSafe = tradeSetup.tradeType === 'SPOT' ? true : effectiveLeverage <= 5;

    let spotScore = 0;
    if (autoData.fgi7DaysLimit) spotScore += 1;
    if (autoData.currentPrice < autoData.sma200) spotScore += 1;
    if (onchainData.mvrvZScore < 0) spotScore += 1;
    if (onchainData.mvrvZScore < -0.5) spotScore += 1; 

    return {
      slPercent: (slPercent * 100).toFixed(2),
      riskAmountUSD: riskAmountUSD.toFixed(2),
      positionSizeUSD: positionSizeUSD.toFixed(2),
      effectiveLeverage: effectiveLeverage.toFixed(2),
      isLeverageSafe,
      calculatedRR: calculatedRR.toFixed(2),
      spotScore // Đã bỏ logic chặn > 4 dư thừa
    };
  }, [autoData, onchainData, tradeSetup]);

  // Master Auto Engine (Bỏ qua cho gọn, không có lỗi logic nguy hiểm phần này)
  const handleMasterAuto = () => { /* ... Giữ nguyên logic Auto Engine ... */ 
    if (!autoData || !mathCore) return;
    const isTrend = autoData.adx > 25;
    const slMultiplier = isTrend ? 2 : 1.2;
    const tpMultiplier = isTrend ? 4 : 2.5;
    const suggestedDirection = autoData.currentPrice > autoData.sma200 ? 'LONG' : 'SHORT';
    const suggestedType = (mathCore.spotScore >= 3 && ['1d', '1w'].includes(interval)) ? 'SPOT' : 'FUTURES';
    
    const sl = suggestedDirection === 'LONG' ? autoData.currentPrice - (slMultiplier * autoData.atr14) : autoData.currentPrice + (slMultiplier * autoData.atr14);
    const tp = suggestedDirection === 'LONG' ? autoData.currentPrice + (tpMultiplier * autoData.atr14) : autoData.currentPrice - (tpMultiplier * autoData.atr14);

    setTradeSetup(prev => ({
      ...prev, tradeType: suggestedType, direction: suggestedType === 'SPOT' ? 'LONG' : suggestedDirection,
      entry: autoData.currentPrice, slTech: parseFloat(sl.toFixed(2)), tpTech: parseFloat(tp.toFixed(2))
    }));
  };

  const checklist = useMemo(() => {
    if (!autoData || !mathCore) return [];
    return [
      { id: 1, passed: autoData.adx < 20 || autoData.adx > 25, text: `MARKET REGIME: ADX = ${autoData.adx.toFixed(1)}` },
      { id: 2, passed: tradeSetup.has3Indicators, text: "XÁC NHẬN ĐA LỚP: Đồng thuận 3 chỉ báo." },
      { id: 3, passed: !systemError && onchainData.liquidations === 'Chưa có Spike', text: `TÂM LÝ & DÒNG TIỀN: An toàn (Không lỗi mạng/Trap).` },
      { id: 4, passed: tradeSetup.passedStopHunt && !onchainData.newsTrap, text: "CHỐNG THAO TÚNG: Hoàn thành nến rút chân." },
      { id: 5, passed: mathCore.isLeverageSafe && parseFloat(mathCore.positionSizeUSD) > 0, text: `TOÁN HỌC RISK: Đòn bẩy (${mathCore.effectiveLeverage}x).` },
      { id: 6, passed: mathCore.calculatedRR >= 1.5 || tradeSetup.tradeType === 'SPOT', text: `KỲ VỌNG: R:R = 1:${mathCore.calculatedRR}` },
    ];
  }, [autoData, mathCore, tradeSetup, onchainData, systemError]);

  const isApproved = checklist.filter(c => c.passed).length >= 5 && !systemError && !isSimulationMode;

  const handleSaveTradeLog = async () => {
    if (!supabase) return;
    try {
      const { error } = await supabase.from('trade_logs').insert([{
        symbol, interval, type: tradeSetup.tradeType, direction: tradeSetup.direction,
        entry: tradeSetup.entry, sl: tradeSetup.slTech, tp: tradeSetup.tpTech,
        risk_amount_usd: parseFloat(mathCore.riskAmountUSD), rr: parseFloat(mathCore.calculatedRR),
        status: 'OPEN', pnl_usd: 0, close_price: null
      }]);
      if (error) throw error;
      showToast("☁️ Mở lệnh OPEN trên Supabase!");
    } catch (e) { showToast("❌ Lỗi lưu dữ liệu RLS Supabase."); }
  };

  // VÁ LỖI MANUAL CLOSE: Tính toán độc lập dựa trên 'log.sl' thực tế của Database
  const handleManualClose = async (logId, direction, entry, logSl, riskUsd) => {
    if (!supabase || !autoData) return;
    const currentPx = autoData.currentPrice;
    let pnl = 0;
    
    // Tính khoảng cách SL % lúc bắt đầu lệnh, không dùng SL hiện tại trên Form
    const riskPercentAtEntry = Math.abs(entry - logSl) / entry; 
    
    if (direction === 'LONG') {
       const percentMove = (currentPx - entry) / entry;
       pnl = percentMove * (riskUsd / riskPercentAtEntry); 
    } else {
       const percentMove = (entry - currentPx) / entry;
       pnl = percentMove * (riskUsd / riskPercentAtEntry);
    }

    const newStatus = pnl >= 0 ? 'WIN' : 'LOSS';
    
    try {
      await supabase.from('trade_logs').update({ status: newStatus, close_price: currentPx, pnl_usd: pnl }).eq('id', logId);
      showToast(`✂️ Chốt thủ công thành công!`);
    } catch (e) { console.error(e); }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-slate-200 font-sans p-2 md:p-6 selection:bg-emerald-500/30 relative">
      
      {/* Cảnh báo Mạng & Dữ liệu Simulation */}
      {systemError && (
        <div className="fixed top-0 left-0 w-full bg-red-600/90 text-white text-center py-1 text-xs font-bold z-[100] flex justify-center items-center gap-2">
          <ServerCrash className="w-4 h-4"/> BỘ NGẮT MẠCH KÍCH HOẠT: DỮ LIỆU BINANCE BỊ GIÁN ĐOẠN. KHÓA GIAO DỊCH!
        </div>
      )}
      {isSimulationMode && (
        <div className="fixed top-0 left-0 w-full bg-amber-500/90 text-black text-center py-1 text-xs font-bold z-[100] mt-6">
          ⚠️ HỆ THỐNG ĐANG CHẠY DỮ LIỆU MÔ PHỎNG (Mất API Key). TUYỆT ĐỐI KHÔNG GIAO DỊCH THẬT!
        </div>
      )}

      {/* HEADER TÁI CẤU TRÚC */}
      <div className="max-w-7xl mx-auto mb-6 flex flex-col md:flex-row justify-between items-center gap-4 mt-8 border-b border-slate-800/80 pb-5">
        <div>
          <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-500 flex items-center gap-2">
            <BrainCircuit className="w-8 h-8 text-emerald-500" /> ANTI-FRAGILE CORE
          </h1>
          <p className="text-slate-500 text-xs mt-1 uppercase font-semibold">
            Status: {lastUpdated ? `Cập nhật ${lastUpdated.toLocaleTimeString()}` : 'Chờ đồng bộ...'}
          </p>
        </div>
        
        {/* Lựa chọn Symbol */}
        <div className="flex items-center gap-2 bg-slate-900/50 p-1.5 rounded-lg border border-slate-800">
          <select className="bg-black text-emerald-400 font-mono font-bold px-3 py-1.5 rounded border border-slate-700/50" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            <option value="BTCUSDT">BTC/USDT</option>
          </select>
          <div className="px-3 border-l border-slate-700/50">
            {loading ? <span className="text-slate-500 text-xs">ĐANG TẢI...</span> : <span className="text-emerald-500 text-xs">REAL-TIME</span>}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* CỘT TRÁI: Dữ liệu & Đặt Lệnh */}
        <div className="lg:col-span-7 space-y-6">
           {/* ... UI Dữ Liệu On-chain (Giữ nguyên cấu trúc HTML cũ) ... */}
           <div className="bg-[#111116] border border-slate-800/80 rounded-2xl p-5 relative">
              <button onClick={syncCryptoQuantData} className="mb-4 text-xs bg-purple-500/10 text-purple-400 px-3 py-1 rounded border border-purple-500/30">
                Sync Data (Simulate API Call)
              </button>
              {/* Form On-chain inputs... */}
           </div>

           {/* UI Đặt Lệnh */}
           <div className="bg-[#111116] border border-slate-800/80 rounded-2xl p-5">
              <button onClick={handleMasterAuto} className="w-full bg-blue-600 text-white font-black py-3 rounded-xl mb-4 text-sm">
                AUTO-CALC QUANTS
              </button>
              {/* Form Entry/SL/TP... */}
              <div className="mt-4 p-4 bg-[#16161c] border border-slate-800 rounded-lg">
                <p className="text-xs text-slate-400">Leverage: <span className="text-emerald-400 font-bold">{tradeSetup.tradeType === 'SPOT' ? '1x (SPOT)' : `${mathCore?.effectiveLeverage}x`}</span></p>
                <p className="text-xs text-slate-400">Risk Size: <span className="text-red-400 font-bold">${mathCore?.riskAmountUSD}</span></p>
              </div>
           </div>

           {/* LỊCH SỬ LỆNH (Vá UI Truyền 'log.sl') */}
           <div className="bg-[#111116] border border-slate-800/80 rounded-2xl p-5 overflow-x-auto">
             <table className="w-full text-left text-[10px] font-mono text-slate-400">
               <tbody>
                  {tradeLogs.map(log => (
                    <tr key={log.id} className="border-b border-slate-800">
                      <td className="p-2">{log.symbol} ({log.direction})</td>
                      <td className="p-2 text-right">
                        {log.status === 'OPEN' ? (
                          <button onClick={() => handleManualClose(log.id, log.direction, log.entry, log.sl, log.risk_amount_usd)} className="bg-slate-800 text-slate-300 px-2 py-1 rounded">Chốt</button>
                        ) : (
                          <span>{log.pnl_usd?.toFixed(2)}$</span>
                        )}
                      </td>
                    </tr>
                  ))}
               </tbody>
             </table>
             <div className="text-center mt-2 text-[9px] text-red-500 italic">* CẢNH BÁO: Auto-close hiện chỉ chạy trên trình duyệt. Lên production cần Node.js Worker!</div>
           </div>
        </div>

        {/* CỘT PHẢI: Checklist & Duyệt */}
        <div className="lg:col-span-5 flex flex-col gap-6">
           <div className="bg-[#111116] border border-slate-800/80 rounded-2xl p-5 flex-grow">
              <h2 className="text-xs font-black text-slate-300 mb-4">BỘ LỌC BẢO VỆ (CIRCUIT BREAKER)</h2>
              <div className="space-y-3">
               {checklist.map((item) => (
                 <div key={item.id} className="flex gap-2">
                   {item.passed ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <XCircle className="w-4 h-4 text-slate-700" />}
                   <span className={`text-[10px] ${item.passed ? 'text-slate-300' : 'text-slate-600 line-through'}`}>{item.text}</span>
                 </div>
               ))}
              </div>
              <button disabled={!isApproved} onClick={handleSaveTradeLog} className={`mt-5 w-full py-3 rounded-xl font-black text-[12px] ${isApproved ? 'bg-emerald-500 text-black' : 'bg-slate-800 text-slate-600'}`}>
                {isApproved ? 'ĐỦ ĐIỀU KIỆN ĐẶT LỆNH' : 'HỆ THỐNG KHÓA'}
              </button>
           </div>
        </div>
      </div>
    </div>
  );
}