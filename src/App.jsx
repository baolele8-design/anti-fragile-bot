import React, { useState, useEffect, useMemo } from 'react';
import { Activity, ShieldAlert, Crosshair, Database, Zap, Bot, Loader2, CheckCircle2, XCircle, BrainCircuit, TrendingUp, TrendingDown, Save, History, Bell, PowerOff } from 'lucide-react';
import { createClient } from 'https://esm.sh/@supabase/supabase-js';

// ==========================================
// 1. SUPABASE & ENV SETUP (NETLIFY VITE)
// ==========================================
// LƯU Ý: Các dòng import.meta.env này sẽ hoạt động hoàn hảo khi chạy trên Netlify.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''; 
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''; 
const geminiApiKey = import.meta.env.VITE_GEMINI_API_KEY || ''; 

const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// --- LÕI TOÁN HỌC ĐỊNH LƯỢNG (PURE MATH CORE) ---
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
      if (smoothedTR === 0) continue;
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
    if (closes.length < period) return { bbw: 0 };
    const slice = closes.slice(-period);
    const sma = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
    const dev = Math.sqrt(variance);
    const upper = sma + (stdDev * dev);
    const lower = sma - (stdDev * dev);
    const bbw = ((upper - lower) / sma) * 100; 
    return { bbw };
  }
};

export default function AntiFragileTerminal() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [intervalTime, setIntervalTime] = useState('15m');
  const [autoData, setAutoData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [tradeLogs, setTradeLogs] = useState([]);
  
  const [lastUpdated, setLastUpdated] = useState(null);
  const [systemError, setSystemError] = useState(false);

  // Gemini State
  const [aiAnalysis, setAiAnalysis] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [geminiCooldown, setGeminiCooldown] = useState(0);

  // Trạng thái Sentiment từ Binance API
  const [sentimentData, setSentimentData] = useState({
    capital: 10000,
    fgiValue: 50, 
    longShortRatio: 1.0, 
    takerBuySellRatio: 1.0, 
    newsTrap: false
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
    if (geminiCooldown > 0) { const t = setTimeout(() => setGeminiCooldown(c => c - 1), 1000); return () => clearTimeout(t); }
  }, [geminiCooldown]);

  // --- SUPABASE SYNC ---
  useEffect(() => {
    if (!supabase) return;
    const fetchLogs = async () => {
      try {
        const { data, error } = await supabase.from('trade_logs').select('*').order('created_at', { ascending: false }).limit(50);
        if (!error && data) setTradeLogs(data);
      } catch (err) { console.error(err); }
    };
    fetchLogs();

    const subscription = supabase.channel('public:trade_logs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trade_logs' }, (payload) => {
        if (payload.eventType === 'INSERT') setTradeLogs(current => [payload.new, ...current].slice(0, 50));
        else if (payload.eventType === 'UPDATE') setTradeLogs(current => current.map(log => log.id === payload.new.id ? payload.new : log));
      }).subscribe();
    return () => supabase.removeChannel(subscription);
  }, []);

  // --- TỔNG LỰC DATA FETCHING TỪ BINANCE ---
  useEffect(() => {
    let isMounted = true;
    const fetchData = async () => {
      setLoading(true);
      try {
        const oiInterval = ['15m', '1h', '4h', '1d'].includes(intervalTime) ? intervalTime : '1d';
        
        const [klinesRes, fundingRes, oiCurrentRes, oiHistRes, fgiRes, lsrRes, takerRes] = await Promise.all([
          fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${intervalTime}&limit=150`),
          fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`),
          fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`),
          fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=${oiInterval}&limit=30`),
          fetch('https://api.alternative.me/fng/?limit=1'),
          fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${oiInterval}&limit=1`),
          fetch(`https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${symbol}&period=${oiInterval}&limit=1`)
        ]);

        if (!isMounted) return;
        if (!klinesRes.ok || !oiCurrentRes.ok) throw new Error("Binance API Error");

        const klines = await klinesRes.json();
        const funding = await fundingRes.json();
        const oiCurrent = await oiCurrentRes.json();
        const oiHist = await oiHistRes.json();
        
        let fetchedFgi = null;
        if (fgiRes.ok) {
          const fgiData = await fgiRes.json();
          if (fgiData?.data?.[0]?.value) fetchedFgi = parseInt(fgiData.data[0].value);
        }

        let currentLsr = 1.0;
        let currentTaker = 1.0;
        if (lsrRes.ok) {
          const lsrData = await lsrRes.json();
          if (lsrData && lsrData.length > 0) currentLsr = parseFloat(lsrData[lsrData.length-1].longShortRatio);
        }
        if (takerRes.ok) {
          const takerData = await takerRes.json();
          if (takerData && takerData.length > 0) currentTaker = parseFloat(takerData[takerData.length-1].buySellRatio);
        }

        if (!Array.isArray(klines) || klines.length === 0) throw new Error("Empty Klines");

        const closes = klines.map(d => parseFloat(d[4]) || 0);
        const highs = klines.map(d => parseFloat(d[2]) || 0);
        const lows = klines.map(d => parseFloat(d[3]) || 0);
        const currentPrice = closes[closes.length - 1] || 0;

        const oiValues = Array.isArray(oiHist) ? oiHist.map(d => parseFloat(d.sumOpenInterestValue) || 0) : [0];
        const oiEma14 = QuantMath.ema(oiValues, 14) || oiValues[oiValues.length - 1] || 0;
        const currentOiValue = parseFloat(oiCurrent?.openInterest || 0) * currentPrice;

        const atr14 = QuantMath.atr(highs, lows, closes, 14);
        const adxValue = QuantMath.adx(highs, lows, closes, 14);
        const sma200 = QuantMath.sma(closes, 200); 
        const rsiValue = QuantMath.rsi(closes, 14);
        const bollinger = QuantMath.bollinger(closes, 20);

        setAutoData({
          currentPrice, atr14, atrPercent: currentPrice > 0 ? (atr14 / currentPrice) * 100 : 0, 
          adx: adxValue, sma200, fundingRate: (funding && funding[0]) ? parseFloat(funding[0].fundingRate) * 100 : 0,
          currentOi: currentOiValue, oiEma: oiEma14, isOiSpiking: currentOiValue > oiEma14,
          rsi: rsiValue, bbw: bollinger.bbw
        });

        setTradeSetup(prev => prev.entry === 0 ? { ...prev, entry: currentPrice } : prev);
        
        setSentimentData(prev => ({ 
          ...prev, 
          fgiValue: fetchedFgi !== null ? fetchedFgi : prev.fgiValue,
          longShortRatio: currentLsr,
          takerBuySellRatio: currentTaker
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
    const safeResult = { slPercent: "0.00", riskAmountUSD: "0.00", positionSizeUSD: "0.00", effectiveLeverage: "0.00", isLeverageSafe: false, calculatedRR: "0.00" };
    if (!autoData || !tradeSetup.entry || tradeSetup.entry <= 0) return safeResult;
    
    const riskDiff = Math.abs(tradeSetup.entry - tradeSetup.slTech);
    const rewardDiff = Math.abs(tradeSetup.tpTech - tradeSetup.entry);
    let calculatedRR = riskDiff > 0 ? (rewardDiff / riskDiff) : 0;
    if (!isFinite(calculatedRR) || isNaN(calculatedRR)) calculatedRR = 0;

    const atrSafe = autoData.atr14 || 0;
    const totalSlDistance = riskDiff + (1.2 * atrSafe);
    
    let slPercent = totalSlDistance / tradeSetup.entry;
    if (!isFinite(slPercent) || isNaN(slPercent) || slPercent === 0) slPercent = 0.01;

    const capitalSafe = sentimentData.capital > 0 ? sentimentData.capital : 10000;
    const riskAmountUSD = capitalSafe * (tradeSetup.riskPercent / 100);
    let positionSizeUSD = riskAmountUSD / slPercent;
    if (!isFinite(positionSizeUSD) || isNaN(positionSizeUSD)) positionSizeUSD = 0;

    let effectiveLeverage = tradeSetup.tradeType === 'SPOT' ? 1.0 : (positionSizeUSD / capitalSafe);
    if (!isFinite(effectiveLeverage) || isNaN(effectiveLeverage)) effectiveLeverage = 0;
    const isLeverageSafe = tradeSetup.tradeType === 'SPOT' ? true : effectiveLeverage <= 5;

    return {
      slPercent: (slPercent * 100).toFixed(2), riskAmountUSD: riskAmountUSD.toFixed(2), positionSizeUSD: positionSizeUSD.toFixed(2),
      effectiveLeverage: effectiveLeverage.toFixed(2), isLeverageSafe, calculatedRR: calculatedRR.toFixed(2)
    };
  }, [autoData, sentimentData, tradeSetup]);

  const handleMasterAuto = () => {
    if (!autoData || !mathCore) return;
    let suggestedType = 'FUTURES';
    let suggestedDirection = autoData.currentPrice > autoData.sma200 ? 'LONG' : 'SHORT';
    
    if (autoData.rsi < 30 && sentimentData.fgiValue < 20 && intervalTime === '1d') {
      suggestedType = 'SPOT'; suggestedDirection = 'LONG';
    }

    const isTrend = autoData.adx > 25;
    const slMultiplier = isTrend ? 2 : 1.2;
    const tpMultiplier = isTrend ? 4 : 2.5;

    const sl = suggestedDirection === 'LONG' ? autoData.currentPrice - (slMultiplier * autoData.atr14) : autoData.currentPrice + (slMultiplier * autoData.atr14);
    const tp = suggestedDirection === 'LONG' ? autoData.currentPrice + (tpMultiplier * autoData.atr14) : autoData.currentPrice - (tpMultiplier * autoData.atr14);

    setTradeSetup(prev => ({
      ...prev, tradeType: suggestedType, direction: suggestedDirection,
      entry: autoData.currentPrice, slTech: parseFloat(sl.toFixed(2)), tpTech: parseFloat(tp.toFixed(2))
    }));
    showToast("✅ Đã thiết lập thông số cơ học.");
  };

  const checklist = useMemo(() => {
    if (!autoData || !mathCore) return [];
    
    const isFundingExtreme = Math.abs(autoData.fundingRate) > 0.05;
    const isLsrExtreme = sentimentData.longShortRatio > 2.5 || sentimentData.longShortRatio < 0.4;
    const isPsychoTrap = (isFundingExtreme && autoData.isOiSpiking) || isLsrExtreme;

    const isSqueeze = autoData.bbw < 5 && autoData.adx < 20; 
    
    return [
      { id: 1, passed: autoData.adx > 25 || isSqueeze, text: `MARKET REGIME: Xu hướng rõ (ADX: ${autoData.adx.toFixed(1)}) hoặc Squeeze (BBW: ${autoData.bbw.toFixed(1)}%).` },
      { id: 2, passed: tradeSetup.has3Indicators, text: "XÁC NHẬN ĐA LỚP: Đồng thuận 3 chỉ báo kỹ thuật." },
      { id: 3, passed: !isPsychoTrap, text: `TÂM LÝ (BINANCE): Không dính bẫy (L/S Ratio: ${sentimentData.longShortRatio.toFixed(2)}, Taker: ${sentimentData.takerBuySellRatio.toFixed(2)}).` },
      { id: 4, passed: tradeSetup.passedStopHunt && !sentimentData.newsTrap, text: "CHỐNG THAO TÚNG: Hoàn tất Retest, không kẹt bẫy Tin tức." },
      { id: 5, passed: mathCore.isLeverageSafe && parseFloat(mathCore.positionSizeUSD) > 0, text: `TOÁN HỌC RISK: Đòn bẩy hiệu dụng an toàn (${mathCore.effectiveLeverage}x <= 5x).` },
      { id: 6, passed: parseFloat(mathCore.calculatedRR) >= 1.5 || tradeSetup.tradeType === 'SPOT', text: `KỲ VỌNG DƯƠNG: Risk/Reward đạt 1:${mathCore.calculatedRR}` },
    ];
  }, [autoData, mathCore, tradeSetup, sentimentData]);

  const isApproved = checklist.filter(c => c.passed).length >= 5 && !systemError;

  // ==========================================
  // 🧠 GEMINI INTERACTIONS API (CHUẨN TÀI LIỆU V1BETA)
  // ==========================================
  const runGeminiAnalysis = async () => {
    if (geminiCooldown > 0) return;
    if (!autoData || !mathCore) return;
    
    // Đọc API Key từ Netlify.
    const apiKey = geminiApiKey; 
    
    if (!apiKey) {
      setAiAnalysis('⚠️ LỖI: Chưa cấu hình VITE_GEMINI_API_KEY. Vui lòng thêm biến này vào Environment Variables trên Netlify.');
      return;
    }

    setIsAnalyzing(true);
    setAiAnalysis('');
    
    try {
      const prompt = `
        Đóng vai AI Quant Analyst hệ thống "ANTI-FRAGILE V3.8". Phân tích dữ liệu Binance sau:
        - Giá: $${autoData.currentPrice} | RSI(14): ${autoData.rsi.toFixed(1)}
        - ADX: ${autoData.adx.toFixed(1)} | BBW (Squeeze): ${autoData.bbw.toFixed(2)}%
        - Binance L/S Ratio: ${sentimentData.longShortRatio.toFixed(2)}
        - Binance Taker Buy/Sell: ${sentimentData.takerBuySellRatio.toFixed(2)}
        - Setup: ${tradeSetup.tradeType} ${tradeSetup.direction}, R:R=1:${mathCore.calculatedRR}.
        
        Nhiệm vụ: Dựa vào sự đối lập hoặc đồng thuận của L/S Ratio và Taker Volume với hành động giá, lệnh này có rủi ro bị Stop-hunt không? Trả lời bằng đúng 3 câu tiếng Việt, lạnh lùng, định lượng.
      `;

      // Sử dụng Interactions API theo tài liệu Google với header x-goog-api-key
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/interactions`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({ 
          model: "gemini-3.5-flash",
          input: prompt 
        })
      });

      if (!response.ok) {
        if (response.status === 429) throw new Error('RATE_LIMIT');
        throw new Error('API_ERROR');
      }
      
      const data = await response.json();
      
      // Trích xuất text từ response schema của Interactions API
      const outputStep = data.steps?.find(step => step.type === 'model_output');
      const textResponse = outputStep?.content?.[0]?.text || 'Vệ tinh AI không thể trích xuất phản hồi.';
      
      setAiAnalysis(textResponse);
      setGeminiCooldown(15); 
    } catch (error) {
      console.error(error);
      if (error.message === 'RATE_LIMIT') {
        setAiAnalysis('❌ Lỗi 429: Rate Limit (Quá tải yêu cầu). Vui lòng thử lại sau 1 phút.');
      } else {
        setAiAnalysis('❌ Lỗi kết nối Gemini AI. Vui lòng kiểm tra lại cấu hình API Key của bạn trên Netlify.');
      }
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
        risk_amount_usd: parseFloat(mathCore.riskAmountUSD), rr: parseFloat(mathCore.calculatedRR),
        adx: autoData.adx, atr: autoData.atr14, funding_rate: autoData.fundingRate,
        oi_spiking: Boolean(autoData.isOiSpiking), fgi: parseFloat(sentimentData.fgiValue),
        trend_sma200: (autoData.currentPrice > autoData.sma200) ? 'ABOVE' : 'BELOW',
        mvrv: sentimentData.longShortRatio, // Lưu L/S Ratio vào cột mvrv tạm thời
        liquidations: sentimentData.takerBuySellRatio.toFixed(2), // Lưu Taker vào cột liquidations tạm
        news_trap: Boolean(sentimentData.newsTrap), leverage: parseFloat(mathCore.effectiveLeverage),
        status: 'OPEN', pnl_usd: 0
      };
      const { error } = await supabase.from('trade_logs').insert([payload]);
      if (error) throw error;
      showToast("☁️ Đã lưu Nhật ký giao dịch vào Supabase!");
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
    }
    try {
      await supabase.from('trade_logs').update({ status: pnl >= 0 ? 'WIN' : 'LOSS', close_price: currentPx, pnl_usd: pnl }).eq('id', logId);
      showToast(`✂️ Đã chốt lệnh! PnL: ${pnl.toFixed(2)}$`);
    } catch (e) { console.error(e); }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-slate-200 font-mono p-2 md:p-6 selection:bg-emerald-500/30 relative">
      
      {/* HEADER */}
      <div className="max-w-7xl mx-auto mb-6 flex flex-col md:flex-row justify-between items-center gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <h1 className="text-xl md:text-2xl font-black text-emerald-500 flex items-center gap-2 tracking-tighter">
            <BrainCircuit className="w-7 h-7" /> ANTI-FRAGILE <span className="text-slate-500">V3.8</span>
          </h1>
          <p className="text-slate-500 text-[10px] mt-1 uppercase tracking-widest">
            {lastUpdated ? `Binance Sync: ${lastUpdated.toLocaleTimeString()}` : 'Đang kết nối API...'}
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
          
          {/* BINANCE SENTIMENT */}
          <div className="bg-[#111116] border border-slate-800 rounded-xl p-4 shadow-xl">
            <h2 className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-2 mb-4">
              <Database className="w-3 h-3 text-purple-400" /> THÔNG SỐ TÂM LÝ & DÒNG TIỀN (BINANCE API)
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800">
                  <label className="text-[8px] text-slate-500 block mb-1">VỐN TỔNG (USD)</label>
                  <input type="number" value={sentimentData.capital} onChange={e => setSentimentData({...sentimentData, capital: Number(e.target.value)})} className="w-full bg-transparent text-emerald-400 font-bold outline-none text-sm"/>
                </div>
                <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800">
                  <label className="text-[8px] text-slate-500 block mb-1">GLOBAL L/S RATIO</label>
                  <div className={`font-bold text-sm mt-1 ${sentimentData.longShortRatio > 2.5 ? 'text-red-500' : 'text-blue-400'}`}>
                    {sentimentData.longShortRatio.toFixed(2)}
                  </div>
                </div>
                <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800">
                  <label className="text-[8px] text-slate-500 block mb-1">TAKER BUY/SELL</label>
                  <div className={`font-bold text-sm mt-1 ${sentimentData.takerBuySellRatio > 1 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {sentimentData.takerBuySellRatio.toFixed(2)}
                  </div>
                </div>
                <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800">
                  <label className="text-[8px] text-slate-500 block mb-1">FEAR & GREED</label>
                  <input type="number" value={sentimentData.fgiValue} onChange={e => setSentimentData({...sentimentData, fgiValue: Number(e.target.value)})} className="w-full bg-transparent text-amber-400 font-bold outline-none text-sm"/>
                </div>
                <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800 flex items-center justify-center">
                   <label className="flex items-center gap-1.5 cursor-pointer text-[9px] text-slate-400 hover:text-red-400 transition-colors">
                     <input type="checkbox" checked={sentimentData.newsTrap} onChange={e => setSentimentData({...sentimentData, newsTrap: e.target.checked})} className="accent-red-500 w-3 h-3 bg-black"/>
                     Bẫy Tin Tức
                   </label>
                </div>
            </div>
            <div className="mt-3 flex gap-4 text-[9px] text-slate-500">
              <span>* RSI(14): <strong className={autoData?.rsi > 70 ? 'text-red-400' : autoData?.rsi < 30 ? 'text-emerald-400' : 'text-slate-300'}>{autoData?.rsi.toFixed(1) || '0.0'}</strong></span>
              <span>* BBW (Squeeze): <strong>{autoData?.bbw.toFixed(2) || '0.00'}%</strong></span>
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
                    <button onClick={() => setTradeSetup({...tradeSetup, tradeType: 'FUTURES'})} className={`flex-1 py-1.5 text-[10px] font-bold rounded ${tradeSetup.tradeType === 'FUTURES' ? 'bg-indigo-500 text-white' : 'bg-[#0a0a0c] border border-slate-800 text-slate-500'}`}>FUTURES</button>
                    <button onClick={() => setTradeSetup({...tradeSetup, tradeType: 'SPOT'})} className={`flex-1 py-1.5 text-[10px] font-bold rounded ${tradeSetup.tradeType === 'SPOT' ? 'bg-amber-500 text-black' : 'bg-[#0a0a0c] border border-slate-800 text-slate-500'}`}>SPOT</button>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setTradeSetup({...tradeSetup, direction: 'LONG'})} className={`flex-1 py-1.5 text-[10px] font-bold rounded flex justify-center gap-1 ${tradeSetup.direction === 'LONG' ? 'bg-emerald-500 text-black' : 'bg-[#0a0a0c] border border-slate-800 text-slate-500'}`}><TrendingUp className="w-3 h-3"/> LONG</button>
                    <button onClick={() => setTradeSetup({...tradeSetup, direction: 'SHORT'})} className={`flex-1 py-1.5 text-[10px] font-bold rounded flex justify-center gap-1 ${tradeSetup.direction === 'SHORT' ? 'bg-red-500 text-white' : 'bg-[#0a0a0c] border border-slate-800 text-slate-500'}`}><TrendingDown className="w-3 h-3"/> SHORT</button>
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

                <div className="bg-[#0a0a0c] p-4 rounded-lg border border-slate-800 flex flex-col justify-between">
                  <div className="space-y-3">
                    <div className="flex justify-between border-b border-slate-800 pb-1.5">
                      <span className="text-[10px] text-slate-500">Mất tối đa (Risk USD):</span>
                      <span className="text-red-400 font-black text-sm">${mathCore?.riskAmountUSD}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800 pb-1.5">
                      <span className="text-[10px] text-slate-500">Kỳ Vọng (Reward/Risk):</span>
                      <span className={`font-black text-sm ${parseFloat(mathCore?.calculatedRR) >= 1.5 ? 'text-emerald-400' : 'text-amber-500'}`}>1 : {mathCore?.calculatedRR}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800 pb-1.5">
                      <span className="text-[10px] text-slate-500">Vị thế (Size USD):</span>
                      <span className="text-white font-black text-sm">${mathCore?.positionSizeUSD}</span>
                    </div>
                    <div className="flex justify-between items-center mt-2">
                      <span className="text-[9px] text-slate-500 uppercase">Đòn Bẩy Thực Tế:</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-black ${mathCore?.isLeverageSafe ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                        {tradeSetup.tradeType === 'SPOT' ? '1.00x' : `${mathCore?.effectiveLeverage}x`}
                      </span>
                    </div>
                  </div>
                </div>
             </div>
          </div>
        </div>

        {/* CỘT PHẢI */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          
          <div className="bg-[#111116] border border-blue-900/40 rounded-xl p-4">
             <h2 className="text-[10px] font-bold text-blue-400 uppercase flex items-center gap-2 mb-3">
               <Bot className="w-3.5 h-3.5" /> GEMINI AI QUANT (v1beta Interactions)
             </h2>
             <button onClick={runGeminiAnalysis} disabled={isAnalyzing || !autoData || geminiCooldown > 0} className="w-full py-2 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded text-[10px] font-bold flex items-center justify-center gap-2">
               {isAnalyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BrainCircuit className="w-3.5 h-3.5" />}
               PHÂN TÍCH RỦI RO LỆNH NÀY
             </button>
             {aiAnalysis && (
               <div className="mt-3 bg-[#0a0a0c] p-3 rounded border border-blue-900/30 text-[10px] text-slate-300 whitespace-pre-line leading-relaxed">
                 <span className="text-blue-500 mr-1">{'>'}</span> {aiAnalysis}
               </div>
             )}
          </div>

          <div className="bg-[#111116] border border-slate-800 rounded-xl p-4 flex-grow flex flex-col">
             <h2 className="text-[10px] font-bold text-slate-300 uppercase mb-4 flex items-center gap-2 border-b border-slate-800 pb-2"><ShieldAlert className="w-4 h-4 text-emerald-500" /> BỘ LỌC KIỂM DUYỆT (5/6 PASSED)</h2>
             
             <div className="mb-3 space-y-2 bg-[#0a0a0c] p-2.5 rounded border border-slate-800">
               <label className="flex items-center gap-2 text-[10px] text-slate-300">
                 <input type="checkbox" checked={tradeSetup.has3Indicators} onChange={e => setTradeSetup({...tradeSetup, has3Indicators: e.target.checked})} className="accent-emerald-500"/>
                 3 Chỉ báo kỹ thuật đồng thuận
               </label>
               <label className="flex items-center gap-2 text-[10px] text-slate-300">
                 <input type="checkbox" checked={tradeSetup.passedStopHunt} onChange={e => setTradeSetup({...tradeSetup, passedStopHunt: e.target.checked})} className="accent-emerald-500"/>
                 Hoàn tất Retest (Có nến rút chân)
               </label>
             </div>

             <div className="flex-grow space-y-2.5">
               {checklist.map((item) => (
                 <div key={item.id} className="flex items-start gap-2 bg-[#0a0a0c] p-2 rounded border border-slate-800/50">
                   {item.passed ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 text-slate-700 shrink-0 mt-0.5" />}
                   <span className={`text-[9px] leading-relaxed ${item.passed ? 'text-slate-300' : 'text-slate-600 line-through'}`}>{item.text}</span>
                 </div>
               ))}
             </div>

             <div className="mt-4 pt-4 border-t border-slate-800">
                <button disabled={!isApproved} onClick={handleSaveTradeLog} className={`w-full py-3 rounded font-black text-[11px] tracking-widest flex items-center justify-center gap-2
                    ${isApproved ? 'bg-emerald-500 text-black hover:bg-emerald-400' : 'bg-slate-800 text-slate-600 cursor-not-allowed'}`}>
                  {isApproved ? 'ĐỦ ĐIỀU KIỆN - LƯU SỔ TAY' : 'CHƯA ĐẠT CHUẨN'}
                </button>
             </div>
          </div>

        </div>
      </div>
    </div>
  );
}