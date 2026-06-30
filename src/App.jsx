import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Activity, ShieldAlert, Crosshair, Database, Zap, Bot, Loader2, CheckCircle2, XCircle, BrainCircuit, TrendingUp, TrendingDown, AlertTriangle, Save, History, Bell, Link2, ServerCrash, PowerOff } from 'lucide-react';
import { createClient } from 'https://esm.sh/@supabase/supabase-js';

// ==========================================
// 1. SUPABASE INITIALIZATION & ENV SETUP
// ==========================================
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''; 
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''; 
const cqApiKey = import.meta.env.VITE_CQ_API_KEY || '';
const geminiApiKey = import.meta.env.VITE_GEMINI_API_KEY || '';

const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// --- LÕI TOÁN HỌC ĐỊNH LƯỢNG (QUANT MATH CORE) ---
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
  const [intervalTime, setIntervalTime] = useState('15m');
  const [autoData, setAutoData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [tradeLogs, setTradeLogs] = useState([]);
  
  // System Health
  const [lastUpdated, setLastUpdated] = useState(null);
  const [systemError, setSystemError] = useState(false);
  const [isSimulationMode, setIsSimulationMode] = useState(!cqApiKey);

  // Cooldowns
  const [isSyncingCq, setIsSyncingCq] = useState(false);
  const [cqCooldown, setCqCooldown] = useState(0); 
  const [geminiCooldown, setGeminiCooldown] = useState(0);
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

  useEffect(() => {
    if (cqCooldown > 0) { const t = setTimeout(() => setCqCooldown(c => c - 1), 1000); return () => clearTimeout(t); }
  }, [cqCooldown]);
  
  useEffect(() => {
    if (geminiCooldown > 0) { const t = setTimeout(() => setGeminiCooldown(c => c - 1), 1000); return () => clearTimeout(t); }
  }, [geminiCooldown]);

  // --- LẤY DỮ LIỆU TỪ SUPABASE (MAP VỚI SCHEMA SQL) ---
  useEffect(() => {
    if (!supabase) {
      showToast("⚠️ Thiếu VITE_SUPABASE_URL. Chạy chế độ Offline.");
      return;
    }
    const fetchLogs = async () => {
      const { data, error } = await supabase.from('trade_logs').select('*').order('created_at', { ascending: false }).limit(50);
      if (error) console.error("Supabase Error:", error);
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

  // --- VỆ TINH GIÁ CLIENT-SIDE ---
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
            showToast(`🤖 Lệnh ${log.symbol} tự chốt: ${newStatus}`);
          } catch (err) { console.error("Lỗi Auto-Close:", err); }
        }
      }
    };
    checkOpenTrades();
  }, [autoData?.currentPrice, tradeLogs]);

  // --- ĐỒNG BỘ CRYPTOQUANT ---
  const syncCryptoQuantData = async () => {
    if (cqCooldown > 0) return;
    setIsSyncingCq(true);
    
    try {
      if (!cqApiKey) {
        setIsSimulationMode(true);
        showToast("⚠️ KHÔNG CÓ CQ KEY. Dùng Data Mô Phỏng.");
        setTimeout(() => {
          setOnchainData(prev => ({ ...prev, mvrvZScore: (Math.random() * 2).toFixed(2), liquidations: 'Chưa có Spike', isAutoSynced: true }));
          setIsSyncingCq(false); setCqCooldown(30); 
        }, 1000);
        return;
      }

      setIsSimulationMode(false);
      const coinFormat = symbol.substring(0, 3).toLowerCase();
      const headers = { 'Authorization': `Bearer ${cqApiKey}` };

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
      showToast("🔗 Đồng bộ CryptoQuant chuẩn!");

    } catch (e) {
      if (e.message === 'RATE_LIMIT') { showToast("❌ CQ Rate Limit. Khóa 1 giờ."); setCqCooldown(3600); } 
      else { showToast("❌ Lỗi API CryptoQuant."); }
    } finally { setIsSyncingCq(false); }
  };

  // --- FETCH MARKET DATA (MẠCH MÁU CHÍNH) ---
  useEffect(() => {
    let isMounted = true;
    const fetchData = async () => {
      setLoading(true);
      try {
        const oiInterval = ['15m', '1h', '4h', '1d'].includes(intervalTime) ? intervalTime : '1d';
        
        const [klinesRes, fundingRes, oiCurrentRes, oiHistRes, fgiRes] = await Promise.all([
          fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${intervalTime}&limit=150`),
          fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`),
          fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`),
          fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=${oiInterval}&limit=30`),
          fetch('https://api.alternative.me/fng/?limit=7')
        ]);

        if (!isMounted) return;
        if (!klinesRes.ok || !oiCurrentRes.ok) throw new Error("Binance API Offline");

        const klines = await klinesRes.json();
        const funding = await fundingRes.json();
        const oiCurrent = await oiCurrentRes.json();
        const oiHist = await oiHistRes.json();
        const fgi = await fgiRes.json();

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
          currentPrice, atr14, atrPercent: (atr14 / currentPrice) * 100, adx: adxValue, sma200,
          fundingRate: (funding && funding[0]) ? parseFloat(funding[0].fundingRate) * 100 : 0,
          currentOi: currentOiValue, oiEma: oiEma14, isOiSpiking: currentOiValue > oiEma14,
          fgiValue: currentFGI, fgi7DaysLimit: isFgiUnder20For7Days
        });

        setSystemError(false); setLastUpdated(new Date());

      } catch (error) {
        console.error("System Error:", error);
        setSystemError(true);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchData();
    const timer = setInterval(fetchData, 60000);
    return () => { isMounted = false; clearInterval(timer); };
  }, [symbol, intervalTime]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  // --- LÕI TOÁN HỌC RISK & ĐÒN BẨY (Chuẩn V3.0) ---
  const mathCore = useMemo(() => {
    if (!autoData || !tradeSetup.entry || !tradeSetup.slTech) return null;
    
    const riskDiff = Math.abs(tradeSetup.entry - tradeSetup.slTech);
    const rewardDiff = Math.abs(tradeSetup.tpTech - tradeSetup.entry);
    const calculatedRR = riskDiff > 0 ? (rewardDiff / riskDiff) : 0;

    // Khoảng cách SL = |Entry - SL_tech| + 1.2 * ATR
    const totalSlDistance = riskDiff + (1.2 * autoData.atr14);
    const slPercent = totalSlDistance / tradeSetup.entry;
    
    // Position Size = (Capital * Risk%) / SL%
    const riskAmountUSD = onchainData.capital * (tradeSetup.riskPercent / 100);
    const positionSizeUSD = riskAmountUSD / (slPercent || 1);
    
    // Effective Leverage
    const effectiveLeverage = tradeSetup.tradeType === 'SPOT' ? 1.00 : (positionSizeUSD / onchainData.capital);
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
      spotScore
    };
  }, [autoData, onchainData, tradeSetup]);

  const handleMasterAuto = () => {
    if (!autoData || !mathCore) return;
    const isTrend = autoData.adx > 25;
    const slMultiplier = isTrend ? 2 : 1.2;
    const tpMultiplier = isTrend ? 4 : 2.5;
    const suggestedDirection = autoData.currentPrice > autoData.sma200 ? 'LONG' : 'SHORT';
    const suggestedType = (mathCore.spotScore >= 3 && ['1d', '1w'].includes(intervalTime)) ? 'SPOT' : 'FUTURES';
    
    const sl = suggestedDirection === 'LONG' ? autoData.currentPrice - (slMultiplier * autoData.atr14) : autoData.currentPrice + (slMultiplier * autoData.atr14);
    const tp = suggestedDirection === 'LONG' ? autoData.currentPrice + (tpMultiplier * autoData.atr14) : autoData.currentPrice - (tpMultiplier * autoData.atr14);

    setTradeSetup(prev => ({
      ...prev, tradeType: suggestedType, direction: suggestedType === 'SPOT' ? 'LONG' : suggestedDirection,
      entry: autoData.currentPrice, slTech: parseFloat(sl.toFixed(2)), tpTech: parseFloat(tp.toFixed(2))
    }));
  };

  // --- CHECKLIST THEO V3.0 MARDOWN ---
  const checklist = useMemo(() => {
    if (!autoData || !mathCore) return [];
    
    // 3. BỘ LỌC PHẢN BIỆN TÂM LÝ: Chặn bẫy Squeeze
    const isFundingExtreme = Math.abs(autoData.fundingRate) > 0.05;
    const isPsychoTrap = isFundingExtreme && autoData.isOiSpiking;
    
    return [
      { id: 1, passed: autoData.adx < 20 || autoData.adx > 25, text: `MARKET REGIME: Lọc nhiễu ADX (${autoData.adx.toFixed(1)}).` },
      { id: 2, passed: tradeSetup.has3Indicators, text: "XÁC NHẬN ĐA LỚP: Đồng thuận 3 chỉ báo độc lập." },
      { id: 3, passed: !isPsychoTrap && onchainData.liquidations === 'Chưa có Spike', text: `BỘ LỌC TÂM LÝ: Không vướng bẫy thanh khoản (Squeeze/Trap).` },
      { id: 4, passed: tradeSetup.passedStopHunt && !onchainData.newsTrap, text: "CHỐNG THAO TÚNG: Retest hoàn tất, không đánh theo Tin." },
      { id: 5, passed: mathCore.isLeverageSafe && parseFloat(mathCore.positionSizeUSD) > 0, text: `TOÁN HỌC RISK: Đòn bẩy hiệu dụng an toàn (${mathCore.effectiveLeverage}x).` },
      { id: 6, passed: mathCore.calculatedRR >= 1.5 || tradeSetup.tradeType === 'SPOT', text: `KỲ VỌNG DƯƠNG: R:R = 1:${mathCore.calculatedRR}` },
    ];
  }, [autoData, mathCore, tradeSetup, onchainData]);

  const isApproved = checklist.filter(c => c.passed).length >= 5 && !systemError;

  // --- LƯU DATABASE (MAP VỚI SCHEMA SQL CHUẨN) ---
  const handleSaveTradeLog = async () => {
    if (!supabase) { showToast("❌ Supabase Off. Lệnh không được lưu."); return; }
    try {
      // Map đúng 100% các cột SQL
      const payload = {
        symbol: symbol,
        interval: intervalTime,
        type: tradeSetup.tradeType,
        direction: tradeSetup.direction,
        entry: tradeSetup.entry,
        sl: tradeSetup.slTech,
        tp: tradeSetup.tpTech,
        risk_amount_usd: parseFloat(mathCore.riskAmountUSD),
        rr: parseFloat(mathCore.calculatedRR),
        adx: autoData.adx,
        atr: autoData.atr14,
        funding_rate: autoData.fundingRate,
        oi_spiking: autoData.isOiSpiking,
        fgi: autoData.fgiValue,
        trend_sma200: autoData.currentPrice > autoData.sma200 ? 'ABOVE' : 'BELOW',
        mvrv: parseFloat(onchainData.mvrvZScore),
        liquidations: onchainData.liquidations,
        news_trap: onchainData.newsTrap,
        leverage: parseFloat(mathCore.effectiveLeverage),
        status: 'OPEN',
        close_price: null,
        pnl_usd: 0
      };

      const { error } = await supabase.from('trade_logs').insert([payload]);
      if (error) throw error;
      showToast("☁️ Ghi Log Thành Công (Status: OPEN)");
    } catch (e) { console.error(e); showToast("❌ Lỗi INSERT: Kiểm tra RLS policy."); }
  };

  // --- ĐÓNG LỆNH THỦ CÔNG (Tính PnL chuẩn) ---
  const handleManualClose = async (logId, direction, entry, logSl, riskUsd) => {
    if (!supabase || !autoData) return;
    const currentPx = autoData.currentPrice;
    let pnl = 0;
    
    // Tính khoảng cách giá rủi ro (Risk per Coin)
    const riskDistance = Math.abs(entry - logSl);
    if (riskDistance > 0) {
       // Số lượng Coin = Tổng Risk / Risk cho 1 Coin
       const positionCoins = riskUsd / riskDistance;
       if (direction === 'LONG') { pnl = (currentPx - entry) * positionCoins; } 
       else { pnl = (entry - currentPx) * positionCoins; }
    }

    const newStatus = pnl >= 0 ? 'WIN' : 'LOSS';
    
    try {
      await supabase.from('trade_logs').update({ status: newStatus, close_price: currentPx, pnl_usd: pnl }).eq('id', logId);
      showToast(`✂️ Chốt lệnh thủ công! PnL: ${pnl.toFixed(2)}$`);
    } catch (e) { console.error(e); }
  };

  // --- GEMINI AI INTEGRATION ---
  const runGeminiAnalysis = async () => {
    if (geminiCooldown > 0) return;
    if (!autoData || !mathCore) return;
    setIsAnalyzing(true); setAiAnalysis('');
    
    try {
      if (!geminiApiKey) {
        setAiAnalysis('LỖI: Chưa cấu hình VITE_GEMINI_API_KEY. Vui lòng thiết lập trong Netlify ENV.');
        setIsAnalyzing(false); return;
      }

      const prompt = `Dữ liệu ${symbol} ${intervalTime}: Giá $${autoData.currentPrice}, ADX ${autoData.adx.toFixed(1)}, FGI ${autoData.fgiValue}. Setup: ${tradeSetup.direction} R:R 1:${mathCore.calculatedRR}. Đánh giá ngắn gọn 3 câu lệnh này theo phương pháp Anti-Fragile. Lạnh lùng, máy móc.`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${geminiApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });

      if (!response.ok) throw new Error('API_ERROR');
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      setAiAnalysis(text || 'Không có phản hồi.');
      setGeminiCooldown(20); 
    } catch (error) {
      setAiAnalysis('Lỗi kết nối Gemini AI. Kiểm tra Rate Limit hoặc API Key.');
      setGeminiCooldown(60); 
    }
    setIsAnalyzing(false);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-slate-200 font-mono p-2 md:p-6 selection:bg-emerald-500/30 relative">
      
      {/* ALERTS */}
      {systemError && (
        <div className="fixed top-0 left-0 w-full bg-red-600/90 text-white text-center py-1.5 text-xs font-bold z-[100] flex justify-center items-center gap-2 shadow-lg">
          <ServerCrash className="w-4 h-4 animate-pulse"/> CIRCUIT BREAKER: BINANCE API GIÁN ĐOẠN. ĐÓNG BĂNG HỆ THỐNG!
        </div>
      )}
      {isSimulationMode && (
        <div className="fixed top-0 left-0 w-full bg-amber-500/90 text-black text-center py-1 text-[10px] font-bold z-[90] mt-7">
          ⚠️ THIẾU API KEYS TRONG .ENV (CQ/GEMINI). CHẠY CHẾ ĐỘ MÔ PHỎNG.
        </div>
      )}
      {toast && (
        <div className="fixed top-12 left-1/2 -translate-x-1/2 z-50 bg-slate-900 border border-slate-700 px-4 py-2 rounded shadow-2xl flex items-center gap-2">
          <Bell className="w-4 h-4 text-emerald-400" /> <span className="text-xs">{toast}</span>
        </div>
      )}

      {/* HEADER */}
      <div className="max-w-7xl mx-auto mb-6 flex flex-col md:flex-row justify-between items-center gap-4 mt-8 border-b border-slate-800/80 pb-5">
        <div>
          <h1 className="text-xl md:text-2xl font-black text-emerald-500 flex items-center gap-2 tracking-tighter">
            <PowerOff className="w-7 h-7" /> ANTI-FRAGILE <span className="text-slate-500">V3.0</span>
          </h1>
          <p className="text-slate-500 text-[10px] mt-1 uppercase tracking-widest">
            {lastUpdated ? `Sync: ${lastUpdated.toLocaleTimeString()}` : 'Initializing System...'}
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
        
        {/* COLUMN 1: PARAMS & EXECUTION */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* ON-CHAIN DATA */}
          <div className="bg-[#111116] border border-slate-800 rounded-xl p-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-2"><Database className="w-3 h-3 text-purple-400" /> TÂM LÝ & DÒNG TIỀN (ON-CHAIN)</h2>
              <button onClick={syncCryptoQuantData} disabled={isSyncingCq || cqCooldown > 0} className="text-[9px] bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 px-2 py-1 rounded border border-purple-500/30 flex items-center gap-1">
                {isSyncingCq ? <Loader2 className="w-3 h-3 animate-spin"/> : <Link2 className="w-3 h-3"/>} Sync CQ {cqCooldown > 0 && `(${cqCooldown}s)`}
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="bg-black p-2 rounded border border-slate-800">
                  <label className="text-[8px] text-slate-500 block mb-1">VỐN (USD)</label>
                  <input type="number" value={onchainData.capital} onChange={e => setOnchainData({...onchainData, capital: Number(e.target.value)})} className="w-full bg-transparent text-emerald-400 font-bold outline-none text-sm"/>
                </div>
                <div className="bg-black p-2 rounded border border-slate-800">
                  <label className="text-[8px] text-slate-500 block mb-1">MVRV Z-SCORE</label>
                  <input type="number" step="0.1" value={onchainData.mvrvZScore} readOnly={onchainData.isAutoSynced} onChange={e => setOnchainData({...onchainData, mvrvZScore: Number(e.target.value)})} className={`w-full bg-transparent text-blue-400 font-bold outline-none text-sm ${onchainData.isAutoSynced ? 'opacity-50' : ''}`}/>
                </div>
                <div className="bg-black p-2 rounded border border-slate-800">
                  <label className="text-[8px] text-slate-500 block mb-1">LIQUIDATIONS</label>
                  <select value={onchainData.liquidations} disabled={onchainData.isAutoSynced} onChange={e => setOnchainData({...onchainData, liquidations: e.target.value})} className="w-full bg-transparent text-red-400 font-bold outline-none text-xs">
                    <option value="Chưa có Spike">Bình thường</option>
                    <option value="Long Spike">Quét Long</option>
                    <option value="Short Spike">Quét Short</option>
                  </select>
                </div>
                <div className="bg-black p-2 rounded border border-slate-800 flex items-center">
                   <label className="flex items-center gap-2 cursor-pointer text-[10px] text-slate-400">
                     <input type="checkbox" checked={onchainData.newsTrap} onChange={e => setOnchainData({...onchainData, newsTrap: e.target.checked})} className="accent-red-500"/>
                     Bẫy Tin Tức
                   </label>
                </div>
            </div>
          </div>

          {/* TRADE SETUP */}
          <div className="bg-[#111116] border border-slate-800 rounded-xl p-4">
             <button onClick={handleMasterAuto} disabled={!autoData} className="w-full mb-4 bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-500/30 font-bold py-2 rounded text-xs flex items-center justify-center gap-2 transition-all">
                <Zap className="w-4 h-4" /> AUTO-CALC QUANTS (V3.0)
             </button>

             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex gap-1">
                    <button onClick={() => setTradeSetup({...tradeSetup, tradeType: 'FUTURES'})} className={`flex-1 py-1 text-[10px] font-bold rounded ${tradeSetup.tradeType === 'FUTURES' ? 'bg-indigo-500 text-white' : 'bg-slate-900 text-slate-500'}`}>FUTURES</button>
                    <button onClick={() => setTradeSetup({...tradeSetup, tradeType: 'SPOT'})} className={`flex-1 py-1 text-[10px] font-bold rounded ${tradeSetup.tradeType === 'SPOT' ? 'bg-amber-500 text-black' : 'bg-slate-900 text-slate-500'}`}>SPOT</button>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => setTradeSetup({...tradeSetup, direction: 'LONG'})} className={`flex-1 py-1 text-[10px] font-bold rounded flex justify-center gap-1 ${tradeSetup.direction === 'LONG' ? 'bg-emerald-500 text-black' : 'bg-slate-900 text-slate-500'}`}><TrendingUp className="w-3 h-3"/> LONG</button>
                    <button onClick={() => setTradeSetup({...tradeSetup, direction: 'SHORT'})} className={`flex-1 py-1 text-[10px] font-bold rounded flex justify-center gap-1 ${tradeSetup.direction === 'SHORT' ? 'bg-red-500 text-white' : 'bg-slate-900 text-slate-500'}`}><TrendingDown className="w-3 h-3"/> SHORT</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                     <div className="bg-black p-1.5 rounded border border-slate-800">
                      <label className="text-[8px] text-slate-500 block">RISK (%)</label>
                      <input type="number" step="0.1" value={tradeSetup.riskPercent} onChange={handleRiskChange} className="w-full bg-transparent text-emerald-400 outline-none text-xs"/>
                     </div>
                     <div className="bg-black p-1.5 rounded border border-slate-800">
                      <label className="text-[8px] text-slate-500 block">ENTRY</label>
                      <input type="number" value={tradeSetup.entry} onChange={e=>setTradeSetup({...tradeSetup, entry:Number(e.target.value)})} className="w-full bg-transparent text-white outline-none text-xs"/>
                     </div>
                     <div className="bg-black p-1.5 rounded border border-slate-800">
                      <label className="text-[8px] text-red-500 block">STOP LOSS</label>
                      <input type="number" value={tradeSetup.slTech} onChange={e=>setTradeSetup({...tradeSetup, slTech:Number(e.target.value)})} className="w-full bg-transparent text-red-400 outline-none text-xs"/>
                     </div>
                     <div className="bg-black p-1.5 rounded border border-slate-800">
                      <label className="text-[8px] text-emerald-500 block">TAKE PROFIT</label>
                      <input type="number" value={tradeSetup.tpTech} onChange={e=>setTradeSetup({...tradeSetup, tpTech:Number(e.target.value)})} className="w-full bg-transparent text-emerald-400 outline-none text-xs"/>
                     </div>
                  </div>
                </div>

                <div className="bg-slate-900 p-3 rounded border border-slate-800 flex flex-col justify-between text-[10px]">
                  <div className="space-y-1.5">
                    <div className="flex justify-between"><span className="text-slate-500">ADX / Trend:</span><span className="text-white">{autoData?.adx.toFixed(1)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Kỳ Vọng (R:R):</span><span className={mathCore?.calculatedRR >= 1.5 ? 'text-emerald-400' : 'text-red-400'}>1 : {mathCore?.calculatedRR}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Loss / Lệnh:</span><span className="text-red-400">${mathCore?.riskAmountUSD}</span></div>
                    <div className="flex justify-between border-b border-slate-700 pb-1"><span className="text-slate-500">Size Lệnh (USD):</span><span className="text-white font-bold">${mathCore?.positionSizeUSD}</span></div>
                  </div>
                  <div className="mt-2 flex justify-between items-center">
                    <span className="text-slate-400 font-bold">EFFECTIVE LEV:</span>
                    <span className={`px-2 py-0.5 rounded font-bold ${mathCore?.isLeverageSafe ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                      {tradeSetup.tradeType === 'SPOT' ? '1.00x' : `${mathCore?.effectiveLeverage}x`}
                    </span>
                  </div>
                </div>
             </div>
          </div>

          {/* TRADE LOGS */}
          <div className="bg-[#111116] border border-slate-800 rounded-xl p-4 overflow-hidden">
            <h2 className="text-[10px] font-bold text-slate-400 uppercase mb-3 flex items-center gap-2"><History className="w-3 h-3 text-emerald-400" /> NHẬT KÝ DATABASE SUPABASE</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[9px] text-slate-400">
                <thead className="bg-slate-900 text-slate-500">
                  <tr><th className="p-1.5">Mã</th><th className="p-1.5">Loại</th><th className="p-1.5">Entry / SL</th><th className="p-1.5">Risk/RR</th><th className="p-1.5">Status</th><th className="p-1.5 text-right">PnL/Action</th></tr>
                </thead>
                <tbody>
                  {tradeLogs.length === 0 ? <tr><td colSpan="6" className="p-3 text-center">Trống</td></tr> :
                    tradeLogs.map(log => (
                      <tr key={log.id} className="border-b border-slate-800/50">
                        <td className="p-1.5 text-white">{log.symbol}</td>
                        <td className={`p-1.5 font-bold ${log.direction==='LONG'?'text-emerald-500':'text-red-500'}`}>{log.type} {log.direction}</td>
                        <td className="p-1.5">{log.entry} / <span className="text-red-400">{log.sl}</span></td>
                        <td className="p-1.5">${log.risk_amount_usd} / 1:{log.rr}</td>
                        <td className="p-1.5">{log.status === 'OPEN' ? <span className="text-blue-400 animate-pulse">OPEN</span> : log.status}</td>
                        <td className="p-1.5 text-right">
                          {log.status === 'OPEN' ? (
                            <button onClick={() => handleManualClose(log.id, log.direction, log.entry, log.sl, log.risk_amount_usd)} className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded border border-slate-700 hover:bg-slate-700">Chốt</button>
                          ) : (
                            <span className={log.pnl_usd > 0 ? 'text-emerald-500' : 'text-red-500'}>{log.pnl_usd > 0 ? '+' : ''}{log.pnl_usd?.toFixed(2)}$</span>
                          )}
                        </td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            </div>
          </div>

        </div>

        {/* COLUMN 2: FILTERS & AI */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          
          {/* AI QUANT */}
          <div className="bg-[#111116] border border-blue-900/30 rounded-xl p-4">
             <h2 className="text-[10px] font-bold text-blue-400 uppercase mb-3 flex items-center gap-2"><Bot className="w-3 h-3" /> GEMINI AI ANALYST</h2>
             <button onClick={runGeminiAnalysis} disabled={isAnalyzing || !autoData || geminiCooldown > 0} className="w-full py-2 mb-3 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded text-[10px] font-bold flex items-center justify-center gap-2 transition-all">
               {isAnalyzing ? <Loader2 className="w-3 h-3 animate-spin" /> : <BrainCircuit className="w-3 h-3" />}
               {geminiCooldown > 0 ? `ĐANG KHÔI PHỤC (${geminiCooldown}s)` : 'PHÂN TÍCH NHANH SETUP NÀY'}
             </button>
             {aiAnalysis && <div className="bg-black p-3 rounded border border-blue-900/30 text-[10px] text-slate-300 whitespace-pre-line leading-relaxed"><span className="text-blue-500 mr-1">{'>'}</span>{aiAnalysis}</div>}
          </div>

          {/* BOOLEAN CHECKLIST */}
          <div className="bg-[#111116] border border-slate-800 rounded-xl p-4 flex-grow flex flex-col">
             <h2 className="text-[10px] font-bold text-slate-300 uppercase mb-4 flex items-center gap-2 border-b border-slate-800 pb-2"><ShieldAlert className="w-3 h-3 text-emerald-500" /> BỘ LỌC DUYỆT LỆNH BOOLEAN (5/6)</h2>
             
             <div className="mb-3 space-y-2 bg-black p-2.5 rounded border border-slate-800">
               <div className="text-[9px] text-slate-500 font-bold uppercase flex items-center gap-1"><Crosshair className="w-3 h-3"/> Xác nhận con người</div>
               <label className="flex items-center gap-2 text-[10px] text-slate-300">
                 <input type="checkbox" checked={tradeSetup.has3Indicators} onChange={e => setTradeSetup({...tradeSetup, has3Indicators: e.target.checked})} className="accent-emerald-500"/>
                 3 Chỉ báo đồng thuận
               </label>
               <label className="flex items-center gap-2 text-[10px] text-slate-300">
                 <input type="checkbox" checked={tradeSetup.passedStopHunt} onChange={e => setTradeSetup({...tradeSetup, passedStopHunt: e.target.checked})} className="accent-emerald-500"/>
                 Đã quét thanh khoản (No Stop-hunt)
               </label>
             </div>

             <div className="flex-grow space-y-2.5">
               {checklist.map((item) => (
                 <div key={item.id} className="flex items-start gap-2 bg-slate-900/50 p-1.5 rounded">
                   {item.passed ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 text-slate-700 shrink-0 mt-0.5" />}
                   <span className={`text-[9px] leading-relaxed ${item.passed ? 'text-slate-300' : 'text-slate-600 line-through'}`}>{item.text}</span>
                 </div>
               ))}
             </div>

             <div className="mt-4 pt-4 border-t border-slate-800">
                <button disabled={!isApproved} onClick={handleSaveTradeLog} className={`w-full py-3 rounded font-bold text-xs tracking-wider flex items-center justify-center gap-2 transition-all shadow-lg
                    ${isApproved ? 'bg-emerald-500 text-black hover:bg-emerald-400' : 'bg-slate-800 text-slate-600 border border-slate-700 cursor-not-allowed'}`}>
                  {isApproved ? <><Save className="w-4 h-4"/> BẤM ĐỂ LƯU VÀO SUPABASE</> : 'HỆ THỐNG KHÓA (KHÔNG ĐỦ ĐIỀU KIỆN)'}
                </button>
             </div>
          </div>

        </div>
      </div>
    </div>
  );
}