import React, { useState, useEffect, useMemo } from 'react';
import { Activity, ShieldAlert, Crosshair, Database, Zap, Bot, Loader2, CheckCircle2, XCircle, BrainCircuit, TrendingUp, TrendingDown, Save, History, Bell, ServerCrash, Key, AlertTriangle, BarChart3 } from 'lucide-react';
import { createClient } from 'https://esm.sh/@supabase/supabase-js';

// ==========================================
// 1. SUPABASE & ENV SETUP (NETLIFY READY)
// ==========================================
const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL || ''; 
const supabaseKey = import.meta.env?.VITE_SUPABASE_ANON_KEY || ''; 
const geminiApiKey = import.meta.env?.VITE_GEMINI_API_KEY || ''; 

const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// --- LÕI TOÁN HỌC ĐỊNH LƯỢNG (BỔ SUNG KELLY & EXPECTED VALUE) ---
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
    if (closes.length < period) return { bbw: 0 };
    const slice = closes.slice(-period);
    const sma = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
    const dev = Math.sqrt(variance);
    const bbw = (((sma + (stdDev * dev)) - (sma - (stdDev * dev))) / sma) * 100; 
    return { bbw };
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
  costDrag: (entryPrice, tradeType, execution, fundingRate, holdingDays = 1) => {
    const slippage = execution === 'MARKET' ? 0.001 : 0;
    const fee = execution === 'MARKET' ? 0.0004 : 0.0002;
    const fundingDrag = tradeType === 'FUTURES' ? (fundingRate * holdingDays) : 0;
    return (slippage + fee * 2 + Math.abs(fundingDrag)) * entryPrice; 
  },
  // MỚI: Tính Tiêu chuẩn Kelly (Kelly Criterion) để xem R:R này có đáng đánh không dựa trên WinRate lịch sử
  kellyCriterion: (winRate, rewardRiskRatio) => {
    if(winRate === 0 || rewardRiskRatio === 0) return 0;
    const W = winRate / 100;
    const R = rewardRiskRatio;
    const kelly = W - ((1 - W) / R);
    return kelly > 0 ? (kelly * 100) : 0; // Trả về % vốn tối ưu, nếu < 0 nghĩa là hệ thống kỳ vọng âm
  }
};

export default function AntiFragileTerminal() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [intervalTime, setIntervalTime] = useState('15m');
  const [autoData, setAutoData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [tradeLogs, setTradeLogs] = useState([]);
  const [tradeStats, setTradeStats] = useState({ winRate: 0, totalClosed: 0, expectancy: 0 });
  
  const [lastUpdated, setLastUpdated] = useState(null);
  const [systemError, setSystemError] = useState(false);

  // Gemini State
  const [aiAnalysis, setAiAnalysis] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [geminiCooldown, setGeminiCooldown] = useState(0);

  // BỔ SUNG: Social Sentiment & Macro Correlation (Từ 5 bài báo mới)
  const [macroData, setMacroData] = useState({
    capital: 10000,
    fgiValue: 50, 
    longShortRatio: 1.0, 
    takerBuySellRatio: 1.0, 
    btcDominance: 55.0, 
    mvrvZScore: 1.2,    
    toxicFlow: 'LOW', 
    socialSentiment: 'NEUTRAL', // Bullish/Bearish/Neutral từ Twitter/Social
    macroCorrelation: 'HIGH', // Tương quan với Chứng khoán/SPX
    volatilitySkew: 'NORMAL', // Rủi ro đuôi béo (Fat-tail)
    newsTrap: false
  });

  const [tradeSetup, setTradeSetup] = useState({
    tradeType: 'FUTURES',
    direction: 'LONG',
    execution: 'LIMIT', 
    riskPercent: 1.0, 
    entry: 0,
    slTech: 0,
    tpTech: 0,
    htfAligned: false, 
    passedSFP: false 
  });

  useEffect(() => {
    if (geminiCooldown > 0) { const t = setTimeout(() => setGeminiCooldown(c => c - 1), 1000); return () => clearTimeout(t); }
  }, [geminiCooldown]);

  // --- SUPABASE SYNC & TÍNH TOÁN THỐNG KÊ LỊCH SỬ ---
  useEffect(() => {
    if (!supabase) return;
    const fetchLogs = async () => {
      try {
        const { data, error } = await supabase.from('trade_logs').select('*').order('created_at', { ascending: false }).limit(100);
        if (!error && data) {
          setTradeLogs(data);
          
          // Tính Win Rate và Số lệnh
          const closedTrades = data.filter(d => d.status === 'WIN' || d.status === 'LOSS');
          const wins = closedTrades.filter(d => d.status === 'WIN').length;
          const winRate = closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0;
          
          setTradeStats({ winRate: winRate, totalClosed: closedTrades.length });
        }
      } catch (err) { console.error(err); }
    };
    fetchLogs();

    const subscription = supabase.channel('public:trade_logs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trade_logs' }, (payload) => {
        if (payload.eventType === 'INSERT') setTradeLogs(current => [payload.new, ...current].slice(0, 100));
        else if (payload.eventType === 'UPDATE') setTradeLogs(current => current.map(log => log.id === payload.new.id ? payload.new : log));
      }).subscribe();
    return () => supabase.removeChannel(subscription);
  }, []);

  // --- FETCH DỮ LIỆU TỪ BINANCE (LTF + HTF 1D) ---
  useEffect(() => {
    let isMounted = true;
    const fetchData = async () => {
      setLoading(true);
      try {
        const oiInterval = ['15m', '1h', '4h', '1d'].includes(intervalTime) ? intervalTime : '1d';
        
        const [klinesLTFRes, klinesHTFRes, fundingRes, oiCurrentRes, oiHistRes, lsrRes, takerRes] = await Promise.all([
          fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${intervalTime}&limit=200`),
          fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=200`), 
          fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`),
          fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`),
          fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=${oiInterval}&limit=30`),
          fetch(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${oiInterval}&limit=1`),
          fetch(`https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${symbol}&period=${oiInterval}&limit=1`)
        ]);

        if (!isMounted) return;
        if (!klinesLTFRes.ok || !klinesHTFRes.ok) throw new Error("Binance API Error");

        const klinesLTF = await klinesLTFRes.json();
        const klinesHTF = await klinesHTFRes.json();
        const funding = await fundingRes.json();
        const oiCurrent = await oiCurrentRes.json();
        const oiHist = await oiHistRes.json();

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

        const closesLTF = klinesLTF.map(d => parseFloat(d[4]));
        const highsLTF = klinesLTF.map(d => parseFloat(d[2]));
        const lowsLTF = klinesLTF.map(d => parseFloat(d[3]));
        const volumesLTF = klinesLTF.map(d => parseFloat(d[5]));
        const currentPrice = closesLTF[closesLTF.length - 1] || 0;

        const closesHTF = klinesHTF.map(d => parseFloat(d[4]));
        const htfSma200 = QuantMath.sma(closesHTF, 200);

        const oiValues = Array.isArray(oiHist) ? oiHist.map(d => parseFloat(d.sumOpenInterestValue) || 0) : [0];
        const oiEma14 = QuantMath.ema(oiValues, 14) || oiValues[oiValues.length - 1] || 0;
        const currentOiValue = parseFloat(oiCurrent?.openInterest || 0) * currentPrice;

        const atr14 = QuantMath.atr(highsLTF, lowsLTF, closesLTF, 14);
        const adxValue = QuantMath.adx(highsLTF, lowsLTF, closesLTF, 14);
        const sma200 = QuantMath.sma(closesLTF, 200); 
        const ema34 = QuantMath.ema(closesLTF, 34); 
        const ema89 = QuantMath.ema(closesLTF, 89); 
        const rsiValue = QuantMath.rsi(closesLTF, 14);
        const bollinger = QuantMath.bollinger(closesLTF, 20);
        const obvValue = QuantMath.obv(closesLTF, volumesLTF);

        setAutoData({
          currentPrice, atr14, atrPercent: currentPrice > 0 ? (atr14 / currentPrice) * 100 : 0, 
          adx: adxValue, sma200, ema34, ema89, htfSma200,
          fundingRate: (funding && funding[0]) ? parseFloat(funding[0].fundingRate) * 100 : 0,
          currentOi: currentOiValue, oiEma: oiEma14, isOiSpiking: currentOiValue > oiEma14,
          rsi: rsiValue, bbw: bollinger.bbw, obv: obvValue
        });

        if(tradeSetup.entry === 0) setTradeSetup(prev => ({ ...prev, entry: currentPrice }));
        
        setMacroData(prev => ({ 
          ...prev, longShortRatio: currentLsr, takerBuySellRatio: currentTaker
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
    const safeResult = { slPercent: "0.00", riskAmountUSD: "0.00", positionSizeUSD: "0.00", effectiveLeverage: "0.00", isLeverageSafe: false, calculatedRR: "0.00", maxLeverage: 1, costDragUSD: "0.00", kelly: 0 };
    if (!autoData || !tradeSetup.entry || tradeSetup.entry <= 0 || tradeSetup.slTech <= 0) return safeResult;
    
    const riskDiff = Math.abs(tradeSetup.entry - tradeSetup.slTech);
    const rewardDiff = Math.abs(tradeSetup.tpTech - tradeSetup.entry);
    
    const costDragPerCoin = QuantMath.costDrag(tradeSetup.entry, tradeSetup.tradeType, tradeSetup.execution, autoData.fundingRate / 100, 1);
    
    let calculatedRR = riskDiff > 0 ? ((rewardDiff - costDragPerCoin) / (riskDiff + costDragPerCoin)) : 0;
    if (!isFinite(calculatedRR) || isNaN(calculatedRR) || calculatedRR < 0) calculatedRR = 0;

    const totalSlDistance = riskDiff + (1.2 * autoData.atr14);
    let slPercent = totalSlDistance / tradeSetup.entry;
    if (!isFinite(slPercent) || isNaN(slPercent) || slPercent === 0) slPercent = 0.01;

    const capitalSafe = macroData.capital > 0 ? macroData.capital : 10000;
    const riskAmountUSD = capitalSafe * (tradeSetup.riskPercent / 100);
    let positionSizeUSD = riskAmountUSD / slPercent;
    if (!isFinite(positionSizeUSD) || isNaN(positionSizeUSD)) positionSizeUSD = 0;

    const totalCostDragUSD = costDragPerCoin * (positionSizeUSD / tradeSetup.entry);

    let effectiveLeverage = tradeSetup.tradeType === 'SPOT' ? 1.0 : (positionSizeUSD / capitalSafe);
    if (!isFinite(effectiveLeverage) || isNaN(effectiveLeverage)) effectiveLeverage = 0;
    
    // ĐIỀU CHỈNH FAT-TAIL RISK: Rủi ro đuôi béo cao -> Giảm ngay đòn bẩy tối đa
    let maxLeverage = symbol === 'BTCUSDT' || symbol === 'ETHUSDT' ? 5 : 3;
    if (macroData.volatilitySkew === 'FAT_TAIL') maxLeverage = 2; // Ép đòn bẩy mùa thiên nga đen

    const isLeverageSafe = tradeSetup.tradeType === 'SPOT' ? true : effectiveLeverage <= maxLeverage;

    // TÍNH TOÁN KELLY DỰA TRÊN LỊCH SỬ
    // Dùng WinRate mặc định 40% nếu chưa có dữ liệu lịch sử
    const baseWinRate = tradeStats.totalClosed >= 10 ? tradeStats.winRate : 40; 
    const kellyPct = QuantMath.kellyCriterion(baseWinRate, calculatedRR);

    return {
      slPercent: (slPercent * 100).toFixed(2), riskAmountUSD: riskAmountUSD.toFixed(2), positionSizeUSD: positionSizeUSD.toFixed(2),
      effectiveLeverage: effectiveLeverage.toFixed(2), isLeverageSafe, calculatedRR: calculatedRR.toFixed(2), maxLeverage, costDragUSD: totalCostDragUSD.toFixed(2),
      kelly: kellyPct.toFixed(2)
    };
  }, [autoData, macroData, tradeSetup, symbol, tradeStats]);

  const handleMasterAuto = () => {
    if (!autoData || !mathCore) return;
    let suggestedType = 'FUTURES';
    let suggestedDirection = autoData.currentPrice > autoData.ema34 ? 'LONG' : 'SHORT'; 
    
    if (autoData.rsi < 30 && macroData.fgiValue < 20 && intervalTime === '1d') {
      suggestedType = 'SPOT'; suggestedDirection = 'LONG';
    }

    const isTrend = autoData.adx > 25;
    const slMultiplier = isTrend ? 2 : 1.2;
    const tpMultiplier = isTrend ? 4 : 2.5;

    const sl = suggestedDirection === 'LONG' ? autoData.currentPrice - (slMultiplier * autoData.atr14) : autoData.currentPrice + (slMultiplier * autoData.atr14);
    const tp = suggestedDirection === 'LONG' ? autoData.currentPrice + (tpMultiplier * autoData.atr14) : autoData.currentPrice - (tpMultiplier * autoData.atr14);

    setTradeSetup(prev => ({
      ...prev, tradeType: suggestedType, direction: suggestedDirection, execution: 'LIMIT',
      entry: autoData.currentPrice, slTech: parseFloat(sl.toFixed(2)), tpTech: parseFloat(tp.toFixed(2)),
      htfAligned: (suggestedDirection === 'LONG' && autoData.currentPrice > autoData.htfSma200) || (suggestedDirection === 'SHORT' && autoData.currentPrice < autoData.htfSma200)
    }));
    showToast("✅ Đã thiết lập thông số cơ học an toàn.");
  };

  const checklist = useMemo(() => {
    if (!autoData || !mathCore) return [];
    
    const isFundingExtreme = Math.abs(autoData.fundingRate) > 0.05;
    const isLsrExtreme = macroData.longShortRatio > 2.5 || macroData.longShortRatio < 0.4;
    const isPsychoTrap = (isFundingExtreme && autoData.isOiSpiking) || isLsrExtreme;
    const isSqueeze = autoData.bbw < 5 && autoData.adx < 20; 
    
    // Nếu Sentiment Euphoric mà Giá phân kỳ/đám đông xả -> Chặn
    const isSocialTrap = macroData.socialSentiment === 'EUPHORIA' && macroData.takerBuySellRatio < 1;

    return [
      { id: 1, passed: autoData.adx > 25 || isSqueeze, text: `MARKET REGIME: Xu hướng rõ (ADX: ${autoData.adx.toFixed(1)}) hoặc Squeeze (BBW: ${autoData.bbw.toFixed(1)}%).` },
      { id: 2, passed: !isSocialTrap, text: `SOCIAL SENTIMENT: Dòng tiền Social (${macroData.socialSentiment}) không bị phân kỳ với Taker Volume.` },
      { id: 3, passed: !isPsychoTrap && macroData.toxicFlow !== 'EXTREME', text: `MICROSTRUCTURE: Thanh khoản an toàn, Toxic Flow thấp (L/S: ${macroData.longShortRatio.toFixed(2)}).` },
      { id: 4, passed: tradeSetup.passedSFP && !macroData.newsTrap, text: "CHỐNG THAO TÚNG: Xác nhận SFP (Quét đỉnh/đáy) & Đặt Limit Order." },
      { id: 5, passed: mathCore.isLeverageSafe && parseFloat(mathCore.positionSizeUSD) > 0, text: `TOÁN HỌC RISK: Đòn bẩy hiệu dụng an toàn (${mathCore.effectiveLeverage}x <= ${mathCore.maxLeverage}x).` },
      { id: 6, passed: mathCore.kelly > 0 || tradeSetup.tradeType === 'SPOT', text: `KỲ VỌNG TOÁN HỌC (EV): Kelly Criterion > 0 (${mathCore.kelly}%), hệ thống sinh lời thực tế.` },
    ];
  }, [autoData, mathCore, tradeSetup, macroData]);

  const isApproved = checklist.filter(c => c.passed).length >= 5 && !systemError && tradeSetup.execution === 'LIMIT';

  // ==========================================
  // 🧠 QUẢN LÝ QUỸ QUANT (GEMINI V1BETA - MACRO ECONOMIST)
  // ==========================================
  const runGeminiAnalysis = async () => {
    if (geminiCooldown > 0) return;
    if (!autoData || !mathCore) return;
    
    const apiKey = geminiApiKey; 
    if (!apiKey) {
      setAiAnalysis('⚠️ LỖI: Chưa cấu hình VITE_GEMINI_API_KEY trên Netlify.');
      return;
    }

    setIsAnalyzing(true);
    setAiAnalysis('');
    
    try {
      // Bối cảnh dữ liệu lịch sử
      const winRateContext = tradeStats.totalClosed >= 10 
        ? `Trader này có lịch sử ${tradeStats.totalClosed} lệnh, Win Rate: ${tradeStats.winRate.toFixed(1)}%.` 
        : `Trader mới chưa đủ dữ liệu thống kê (Giả định Win Rate 40%).`;

      const prompt = `
        Giao thức "ANTI-FRAGILE V4.2 - MACRO ECONOMIST & QUANT MANAGER".
        Vai trò: Giám đốc Quản lý Quỹ Phòng hộ (Hedge Fund). Phân tích cấu trúc vi mô, rủi ro phân phối đuôi béo (Fat-tail), tương quan vĩ mô (Macro Correlation) và độ lệch Tâm lý xã hội (Social Sentiment Bias).
        
        THÔNG SỐ LỊCH SỬ TRADER: ${winRateContext}

        DỮ LIỆU MICROSTRUCTURE & VĨ MÔ (${symbol} - ${intervalTime}):
        - Biến động: Fat-Tail Risk = ${macroData.volatilitySkew} | Macro SPX/DXY Correlation = ${macroData.macroCorrelation}
        - Tâm lý Mạng xã hội (Twitter/X): ${macroData.socialSentiment}
        - Toxic Flow (VPIN): ${macroData.toxicFlow} | Taker Buy/Sell: ${macroData.takerBuySellRatio.toFixed(2)} | L/S Ratio: ${macroData.longShortRatio.toFixed(2)}
        - Hành động giá: $${autoData.currentPrice} | BBW (Squeeze) = ${autoData.bbw.toFixed(2)}% | MVRV = ${macroData.mvrvZScore}
        
        VỊ THẾ CHUẨN BỊ VÀO:
        - Setup: ${tradeSetup.tradeType} ${tradeSetup.direction} | Limit Order.
        - Đòn bẩy hiệu dụng: ${mathCore.effectiveLeverage}x (Max do rủi ro Altcoin/Fat-tail: ${mathCore.maxLeverage}x).
        - Kỳ vọng Kelly (Kelly Criterion): ${mathCore.kelly}% (Nếu < 0 nghĩa là lệnh này đánh bạc lỗ vốn dài hạn).
        - Chi phí ma sát (Slippage + Fee): $${mathCore.costDragUSD}.

        Yêu cầu:
        1. Phân tích sự lệch pha giữa Tâm lý đám đông (Social Sentiment) và Dòng tiền lớn (Taker Buy/Sell).
        2. Dựa vào rủi ro Fat-Tail và sự phá vỡ tương quan vĩ mô (nếu có), lệnh này có đối mặt rủi ro Thiên nga đen hay không?
        3. Kết luận cuối cùng dựa trên công thức Kelly: Lệnh này có "Kỳ vọng dương (EV > 0)" không?
        Trả lời sắc bén, chuyên môn cao trong đúng 4 câu tiếng Việt. Đừng dùng từ dư thừa.
      `;

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
      const outputStep = data.steps?.find(step => step.type === 'model_output');
      const textResponse = outputStep?.content?.[0]?.text || 'Lỗi trích xuất ngôn ngữ từ AI.';
      
      setAiAnalysis(textResponse);
      setGeminiCooldown(15); 
    } catch (error) {
      console.error(error);
      setAiAnalysis(error.message === 'RATE_LIMIT' ? '❌ Lỗi 429: Rate Limit (Quá tải). Chờ 30s.' : '❌ Lỗi kết nối Gemini AI.');
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
        oi_spiking: Boolean(autoData.isOiSpiking), fgi: parseFloat(macroData.fgiValue),
        trend_sma200: (autoData.currentPrice > autoData.sma200) ? 'ABOVE' : 'BELOW',
        mvrv: parseFloat(macroData.mvrvZScore), 
        liquidations: macroData.toxicFlow, 
        news_trap: Boolean(macroData.newsTrap), leverage: parseFloat(mathCore.effectiveLeverage),
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
    }
    try {
      await supabase.from('trade_logs').update({ status: pnl >= 0 ? 'WIN' : 'LOSS', close_price: currentPx, pnl_usd: pnl }).eq('id', logId);
      showToast(`✂️ Đã đóng vị thế. PnL: ${pnl.toFixed(2)}$`);
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
            <BrainCircuit className="w-7 h-7" /> ANTI-FRAGILE <span className="text-slate-500">V4.2 (Macro Quant)</span>
          </h1>
          <p className="text-slate-500 text-[10px] mt-1 uppercase tracking-widest flex items-center gap-2">
            {lastUpdated ? `Thị trường: ${lastUpdated.toLocaleTimeString()}` : 'Khởi động Core...'}
            {tradeStats.totalClosed > 0 && <span className="text-purple-400 border border-purple-900/50 bg-purple-900/10 px-1.5 rounded">WR: {tradeStats.winRate.toFixed(1)}% ({tradeStats.totalClosed} lệnh)</span>}
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
          
          {/* ĐỘNG LỰC HỌC VĨ MÔ & TÂM LÝ XÃ HỘI */}
          <div className="bg-[#111116] border border-slate-800 rounded-xl p-4 shadow-xl">
            <h2 className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-2 mb-4">
              <Database className="w-3 h-3 text-purple-400" /> ĐỘNG LỰC HỌC VĨ MÔ & TÂM LÝ XÃ HỘI (MANUAL & API)
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {/* Dữ liệu API tự động */}
                <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800">
                  <label className="text-[8px] text-slate-500 block mb-1">GLOBAL L/S RATIO</label>
                  <div className={`font-bold text-sm mt-1 ${macroData.longShortRatio > 2.5 ? 'text-red-500' : 'text-blue-400'}`}>
                    {macroData.longShortRatio.toFixed(2)}
                  </div>
                </div>
                <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800">
                  <label className="text-[8px] text-slate-500 block mb-1">TAKER BUY/SELL</label>
                  <div className={`font-bold text-sm mt-1 ${macroData.takerBuySellRatio > 1 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {macroData.takerBuySellRatio.toFixed(2)}
                  </div>
                </div>
                
                {/* Vùng Nhập liệu Phức hợp Mới */}
                <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800 focus-within:border-cyan-500/50">
                  <label className="text-[8px] font-bold text-cyan-500 block mb-1 flex gap-1 items-center">SOCIAL SENTIMENT</label>
                  <select value={macroData.socialSentiment} onChange={e => setMacroData({...macroData, socialSentiment: e.target.value})} className="w-full bg-transparent text-cyan-400 font-bold outline-none text-[10px] cursor-pointer mt-1">
                    <option value="NEUTRAL">Trung lập</option>
                    <option value="BEARISH">Tuyệt vọng (Đáy)</option>
                    <option value="EUPHORIA">Hưng phấn (Đỉnh)</option>
                  </select>
                </div>
                <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800 focus-within:border-purple-500/50">
                  <label className="text-[8px] font-bold text-purple-500 block mb-1 flex gap-1 items-center">FAT-TAIL RISK</label>
                  <select value={macroData.volatilitySkew} onChange={e => setMacroData({...macroData, volatilitySkew: e.target.value})} className="w-full bg-transparent text-purple-400 font-bold outline-none text-[10px] cursor-pointer mt-1">
                    <option value="NORMAL">Phân phối chuẩn</option>
                    <option value="FAT_TAIL">Đuôi béo (Nguy hiểm)</option>
                  </select>
                </div>

                {/* Các dữ liệu vĩ mô cũ */}
                <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800 focus-within:border-red-500/50">
                  <label className="text-[8px] font-bold text-red-500 block mb-1 flex gap-1 items-center"><Key className="w-2.5 h-2.5"/> TOXIC FLOW</label>
                  <select value={macroData.toxicFlow} onChange={e => setMacroData({...macroData, toxicFlow: e.target.value})} className="w-full bg-transparent text-red-400 font-bold outline-none text-xs cursor-pointer mt-1.5">
                    <option value="LOW">Thấp</option>
                    <option value="HIGH">Cao</option>
                    <option value="EXTREME">Cực đoan</option>
                  </select>
                </div>
                <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800 focus-within:border-amber-500/50">
                  <label className="text-[8px] text-slate-500 block mb-1">MACD / SPX CORREL</label>
                  <select value={macroData.macroCorrelation} onChange={e => setMacroData({...macroData, macroCorrelation: e.target.value})} className="w-full bg-transparent text-amber-400 font-bold outline-none text-xs cursor-pointer mt-1.5">
                    <option value="HIGH">Đồng pha vĩ mô</option>
                    <option value="LOW">Phân rã (Độc lập)</option>
                  </select>
                </div>
                <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800 focus-within:border-emerald-500/50">
                  <label className="text-[8px] text-slate-500 block mb-1">VỐN TỔNG (USD)</label>
                  <input type="number" value={macroData.capital} onChange={e => setMacroData({...macroData, capital: Number(e.target.value)})} className="w-full bg-transparent text-emerald-400 font-bold outline-none text-sm"/>
                </div>
                <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800 flex items-center justify-center">
                   <label className="flex items-center gap-1.5 cursor-pointer text-[9px] text-slate-400 hover:text-red-400 transition-colors">
                     <input type="checkbox" checked={macroData.newsTrap} onChange={e => setMacroData({...macroData, newsTrap: e.target.checked})} className="accent-red-500 w-3 h-3 bg-black"/>
                     Bẫy Tin Tức
                   </label>
                </div>
            </div>
            
            <div className="mt-4 p-2 bg-slate-900/50 rounded border border-slate-800 grid grid-cols-4 gap-2 text-center">
               <div><span className="block text-[8px] text-slate-500">RSI (14)</span><span className={`text-[10px] font-bold ${autoData?.rsi > 70 ? 'text-red-400' : autoData?.rsi < 30 ? 'text-emerald-400' : 'text-slate-300'}`}>{autoData?.rsi.toFixed(1) || '0.0'}</span></div>
               <div><span className="block text-[8px] text-slate-500">OBV</span><span className="text-[10px] font-bold text-blue-400">{autoData?.obv > 1000 ? (autoData?.obv/1000).toFixed(1)+'K' : autoData?.obv.toFixed(0) || '0'}</span></div>
               <div><span className="block text-[8px] text-slate-500">BBW SQUEEZE</span><span className={`text-[10px] font-bold ${autoData?.bbw < 5 ? 'text-amber-400' : 'text-slate-300'}`}>{autoData?.bbw.toFixed(2) || '0.00'}%</span></div>
               <div><span className="block text-[8px] text-slate-500">HTF D1 TREND</span><span className={`text-[10px] font-bold ${autoData?.currentPrice > autoData?.htfSma200 ? 'text-emerald-500' : 'text-red-500'}`}>{autoData?.currentPrice > autoData?.htfSma200 ? 'BULL' : 'BEAR'}</span></div>
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
                      <span className="text-[10px] font-bold text-slate-500">Chi phí ma sát (Slippage + Fee):</span>
                      <span className="text-amber-500 font-black text-[10px]">-${mathCore?.costDragUSD}</span>
                    </div>
                    <div className="flex justify-between items-end border-b border-slate-800 pb-1.5">
                      <span className="text-[10px] font-bold text-slate-500">Kỳ Vọng (R:R thực tế):</span>
                      <span className={`font-black text-sm ${parseFloat(mathCore?.calculatedRR) >= 1.5 ? 'text-emerald-400' : 'text-amber-500'}`}>1 : {mathCore?.calculatedRR}</span>
                    </div>
                    <div className="flex justify-between items-center bg-slate-950 p-2 rounded border border-slate-800">
                      <div className="flex flex-col gap-1">
                        <span className="text-[8px] text-slate-500 uppercase font-bold flex items-center gap-1"><BarChart3 className="w-3 h-3 text-cyan-500"/> Kỳ Vọng Toán Học (EV):</span>
                        <span className={`text-[11px] font-black ${mathCore?.kelly > 0 ? 'text-cyan-400' : 'text-red-400'}`}>{mathCore?.kelly > 0 ? `+${mathCore?.kelly}% VỐN` : 'ÂM (LỖ DÀI HẠN)'}</span>
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

          {/* SỔ TAY GHI CHÉP GIAO DỊCH */}
          <div className="bg-[#111116] border border-slate-800 rounded-xl p-4 overflow-hidden shadow-xl">
            <h2 className="text-[10px] font-bold text-slate-400 uppercase mb-3 flex items-center gap-2"><History className="w-3 h-3 text-emerald-400" /> SỔ TAY GIAO DỊCH (SUPABASE DB)</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[9px] text-slate-400">
                <thead className="bg-slate-900 text-slate-500">
                  <tr><th className="p-2 rounded-tl">Mã/Loại</th><th className="p-2">Hướng</th><th className="p-2">Giá Entry / Cắt lỗ</th><th className="p-2">Mất($) / Ăn(R)</th><th className="p-2">Status</th><th className="p-2 rounded-tr text-right">PnL/Hành động</th></tr>
                </thead>
                <tbody>
                  {tradeLogs.length === 0 ? <tr><td colSpan="6" className="p-6 text-center border-b border-slate-800 text-slate-600">DB đang trống...</td></tr> :
                    tradeLogs.slice(0, 8).map(log => (
                      <tr key={log.id} className="border-b border-slate-800/50 hover:bg-slate-900/40 transition-colors">
                        <td className="p-2 text-white font-bold">{log.symbol} <span className="text-slate-600 text-[8px] ml-1">{log.type}</span></td>
                        <td className={`p-2 font-black ${log.direction==='LONG'?'text-emerald-500':'text-red-500'}`}>{log.direction}</td>
                        <td className="p-2 font-mono">{log.entry} / <span className="text-red-400">{log.sl}</span></td>
                        <td className="p-2 font-mono">${log.risk_amount_usd} <span className="text-slate-600">|</span> 1:{log.rr}</td>
                        <td className="p-2 font-bold">{log.status === 'OPEN' ? <span className="text-blue-400 animate-pulse drop-shadow-[0_0_5px_rgba(96,165,250,0.5)]">OPEN</span> : <span className="text-slate-500">{log.status}</span>}</td>
                        <td className="p-2 text-right">
                          {log.status === 'OPEN' ? (
                            <button onClick={() => handleManualClose(log.id, log.direction, log.entry, log.sl, log.risk_amount_usd)} className="bg-slate-800 text-slate-300 px-3 py-1 rounded text-[8px] font-bold border border-slate-700 hover:bg-slate-700 hover:text-white transition-colors uppercase">Chốt Lời/Lỗ</button>
                          ) : (
                            <span className={`font-mono font-bold ${log.pnl_usd > 0 ? 'text-emerald-500' : 'text-red-500'}`}>{log.pnl_usd > 0 ? '+' : ''}{log.pnl_usd?.toFixed(2)}$</span>
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
             <h2 className="text-[10px] font-bold text-slate-300 uppercase mb-4 flex items-center gap-2 border-b border-slate-800 pb-3"><ShieldAlert className="w-4 h-4 text-emerald-500" /> BỘ LỌC KIỂM DUYỆT V4.2 (Tối thiểu 5/6 Passed)</h2>
             
             {/* BƯỚC CHECK TAY (Human Override) */}
             <div className="mb-4 space-y-2 bg-[#0a0a0c] p-3 rounded-lg border border-slate-800">
               <div className="text-[9px] text-slate-500 font-bold uppercase flex items-center gap-1 mb-2"><Crosshair className="w-3 h-3"/> Phân tích hành vi (Price Action)</div>
               <label className="flex items-center gap-2 text-[10px] text-slate-300 hover:text-white cursor-pointer transition-colors">
                 <input type="checkbox" checked={tradeSetup.htfAligned} onChange={e => setTradeSetup({...tradeSetup, htfAligned: e.target.checked})} className="accent-emerald-500 w-3.5 h-3.5 bg-black"/>
                 Giao dịch Thuận xu hướng khung lớn (D1)
               </label>
               <label className="flex items-center gap-2 text-[10px] text-slate-300 hover:text-white cursor-pointer transition-colors">
                 <input type="checkbox" checked={tradeSetup.passedSFP} onChange={e => setTradeSetup({...tradeSetup, passedSFP: e.target.checked})} className="accent-emerald-500 w-3.5 h-3.5 bg-black"/>
                 Nhận diện SFP (Quét thanh khoản) thành công
               </label>
             </div>

             {/* TỔNG HỢP KIỂM DUYỆT */}
             <div className="flex-grow space-y-3 mt-2">
               {checklist.map((item) => (
                 <div key={item.id} className="flex items-start gap-2.5 bg-slate-900/30 p-2.5 rounded border border-slate-800/50">
                   {item.passed ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> : <XCircle className="w-4 h-4 text-slate-700 shrink-0" />}
                   <span className={`text-[10px] leading-relaxed font-medium ${item.passed ? 'text-slate-300' : 'text-slate-600 line-through'}`}>{item.text}</span>
                 </div>
               ))}
             </div>

             {/* NÚT LƯU LỆNH DATABASE */}
             <div className="mt-5 pt-5 border-t border-slate-800 flex flex-col gap-2">
                {tradeSetup.execution === 'MARKET' && (
                  <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-[9px] p-2 rounded flex items-center gap-1.5 mb-2">
                    <AlertTriangle className="w-3 h-3 shrink-0" /> Hệ thống khóa: Cấm dùng Market Order. Trượt giá sẽ hủy diệt tài khoản của bạn.
                  </div>
                )}
                <button disabled={!isApproved} onClick={handleSaveTradeLog} className={`w-full py-4 rounded-lg font-black text-[11px] tracking-widest flex items-center justify-center gap-2 transition-all duration-300 shadow-xl
                    ${isApproved ? 'bg-emerald-500 text-black hover:bg-emerald-400 hover:scale-[1.01] shadow-[0_0_15px_rgba(16,185,129,0.3)]' : 'bg-slate-800/50 text-slate-600 border border-slate-700 cursor-not-allowed'}`}>
                  {isApproved ? <><Save className="w-4 h-4"/> ĐỦ ĐIỀU KIỆN - LƯU VÀO SỔ TAY DB</> : 'KHÓA BẢO VỆ: CHƯA ĐẠT CHUẨN'}
                </button>
             </div>
          </div>

        </div>
      </div>
    </div>
  );
}