import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Activity, ShieldAlert, Crosshair, Database, Zap, Bot, Loader2, CheckCircle2, XCircle, BrainCircuit, TrendingUp, TrendingDown, Target, AlertTriangle, Save, History, Bell, Link2 } from 'lucide-react';
import { createClient } from 'https://esm.sh/@supabase/supabase-js';

// ==========================================
// 1. SUPABASE INITIALIZATION (CẤU HÌNH NETLIFY)
// ==========================================
// KHI CHẠY TRÊN NETLIFY HOẶC LOCAL VITE:
// Nếu bạn thiết lập biến môi trường ở file .env (ví dụ: VITE_SUPABASE_URL), Vite tự động nạp.
// Ở đây tôi dùng biến trực tiếp để đảm bảo web xem trước không bị lỗi. 
// ĐỂ DÙNG THẬT: thay 'YOUR_SUPABASE_URL' bằng URL thực tế của bạn hoặc dùng import.meta.env.VITE_SUPABASE_URL
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL; 
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY; 

const supabase = (supabaseUrl !== 'YOUR_SUPABASE_URL' && supabaseUrl) 
  ? createClient(supabaseUrl, supabaseKey) 
  : null;

// --- LÕI TOÁN HỌC ĐỊNH LƯỢNG (QUANT MATH CORE) ---
const QuantMath = {
  sma: (data, period) => {
    if (data.length < period) return null;
    return data.slice(-period).reduce((a, b) => a + b, 0) / period;
  },
  
  ema: (data, period) => {
    if (data.length < period) return null;
    const k = 2 / (period + 1);
    let emaVal = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) {
      emaVal = (data[i] * k) + (emaVal * (1 - k));
    }
    return emaVal;
  },

  trueRange: (h, l, pc) => Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)),

  atr: (highs, lows, closes, period) => {
    if (closes.length < period + 1) return null;
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
    if (closes.length < period * 2) return 0;
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

  // Cấu hình Rate Limit (Cooldown)
  const [isSyncingCq, setIsSyncingCq] = useState(false);
  const [cqCooldown, setCqCooldown] = useState(0); 
  const [geminiCooldown, setGeminiCooldown] = useState(0);

  // Gemini AI State
  const [aiAnalysis, setAiAnalysis] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // States Dữ Liệu (Hỗ trợ Thủ công & Đồng bộ CryptoQuant)
  const [onchainData, setOnchainData] = useState({
    capital: 10000,
    mvrvZScore: 1.2,
    liquidations: 'Chưa có Spike', 
    newsTrap: false,
    isAutoSynced: false
  });

  // States Thiết Lập Giao Dịch
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

  // --- QUẢN LÝ THỜI GIAN COOLDOWN (BẢO VỆ API RATE LIMIT) ---
  useEffect(() => {
    if (cqCooldown > 0) {
      const timer = setTimeout(() => setCqCooldown(c => c - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cqCooldown]);

  useEffect(() => {
    if (geminiCooldown > 0) {
      const timer = setTimeout(() => setGeminiCooldown(c => c - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [geminiCooldown]);

  // --- LẤY DỮ LIỆU TỪ SUPABASE ---
  useEffect(() => {
    if (!supabase) return;

    const fetchLogs = async () => {
      const { data, error } = await supabase
        .from('trade_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (error) {
        console.error("Lỗi lấy dữ liệu Supabase:", error);
      } else if (data) {
        setTradeLogs(data);
      }
    };

    fetchLogs();

    // Subscribe realtime database thay đổi
    const subscription = supabase
      .channel('public:trade_logs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trade_logs' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setTradeLogs(current => [payload.new, ...current].slice(0, 50));
        } else if (payload.eventType === 'UPDATE') {
          setTradeLogs(current => current.map(log => log.id === payload.new.id ? payload.new : log));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, []);

  // --- VỆ TINH THEO DÕI GIÁ VÀ TỰ ĐỘNG CHỐT LỆNH ---
  useEffect(() => {
    if (!supabase || !autoData || tradeLogs.length === 0) return;

    const checkOpenTrades = async () => {
      const openTrades = tradeLogs.filter(log => log.status === 'OPEN' && log.symbol === symbol);
      
      for (const log of openTrades) {
        let newStatus = null;
        let closePrice = null;
        let pnl = 0;
        const currentPx = autoData.currentPrice;

        if (log.direction === 'LONG') {
          if (currentPx >= log.tp) {
            newStatus = 'WIN';
            closePrice = log.tp;
            pnl = log.rr * log.risk_amount_usd; 
          } else if (currentPx <= log.sl) {
            newStatus = 'LOSS';
            closePrice = log.sl;
            pnl = -log.risk_amount_usd; 
          }
        } else if (log.direction === 'SHORT') {
          if (currentPx <= log.tp) {
            newStatus = 'WIN';
            closePrice = log.tp;
            pnl = log.rr * log.risk_amount_usd;
          } else if (currentPx >= log.sl) {
            newStatus = 'LOSS';
            closePrice = log.sl;
            pnl = -log.risk_amount_usd;
          }
        }

        if (newStatus) {
          try {
            await supabase
              .from('trade_logs')
              .update({ status: newStatus, close_price: closePrice, pnl_usd: pnl })
              .eq('id', log.id);
            showToast(`🤖 Lệnh ${log.symbol} đã tự động chốt: ${newStatus} (${pnl > 0 ? '+' : ''}${pnl.toFixed(2)}$)`);
          } catch (err) {
            console.error("Lỗi Auto-Close:", err);
          }
        }
      }
    };

    checkOpenTrades();
  }, [autoData?.currentPrice, tradeLogs]);

  // --- ĐỒNG BỘ DỮ LIỆU CRYPTOQUANT (QUẢN TRỊ RATE LIMIT) ---
  const syncCryptoQuantData = async () => {
    if (cqCooldown > 0) {
      showToast(`⏳ Vui lòng đợi ${cqCooldown}s để đồng bộ CryptoQuant (Bảo vệ Rate Limit).`);
      return;
    }

    setIsSyncingCq(true);
    try {
      // Netlify: Hãy thay "YOUR_CRYPTOQUANT_API_KEY" bằng api thật (hoặc lấy từ môi trường)
      const cqApiKey = "zAdtqmnl6tdh70g1YiNUq5brGjQgFCIBVNJOJNWp5yDnAh73syuWAQODaFQzAlr"; 
      
      if (!cqApiKey || cqApiKey === "YOUR_CRYPTOQUANT_API_KEY") {
        showToast("⚠️ Chưa cấu hình CryptoQuant Key. Sẽ dùng dữ liệu mô phỏng.");
        setTimeout(() => {
          setOnchainData(prev => ({
            ...prev,
            mvrvZScore: (Math.random() * (2.5 - 0.5) + 0.5).toFixed(2),
            liquidations: Math.random() > 0.6 ? 'Long Spike' : 'Chưa có Spike',
            isAutoSynced: true
          }));
          setIsSyncingCq(false);
          setCqCooldown(30); 
          showToast("🔗 Đã đồng bộ On-chain Data (Dữ liệu mô phỏng)");
        }, 1500);
        return;
      }

      const coinFormat = symbol.substring(0, 3).toLowerCase();
      const headers = { 'Authorization': `Bearer ${cqApiKey}` };

      // Gọi MVRV Z-Score
      const mvrvRes = await fetch(`https://api.cryptoquant.com/v1/${coinFormat}/market-indicator/mvrv?limit=1`, { headers });
      if (mvrvRes.status === 429) throw new Error('RATE_LIMIT');
      if (!mvrvRes.ok) throw new Error('API_ERROR');
      const mvrvData = await mvrvRes.json();
      
      // Gọi Dữ liệu thanh lý
      const liqRes = await fetch(`https://api.cryptoquant.com/v1/${coinFormat}/market-data/liquidations?limit=1`, { headers });
      if (liqRes.status === 429) throw new Error('RATE_LIMIT');
      if (!liqRes.ok) throw new Error('API_ERROR');
      const liqData = await liqRes.json();

      let newMvrv = onchainData.mvrvZScore;
      let newLiqStatus = 'Chưa có Spike';

      if (mvrvData?.result?.data?.length > 0) {
        newMvrv = parseFloat(mvrvData.result.data[0].mvrv).toFixed(2);
      }

      if (liqData?.result?.data?.length > 0) {
        const longs = parseFloat(liqData.result.data[0].long_liquidations_usd);
        const shorts = parseFloat(liqData.result.data[0].short_liquidations_usd);
        
        if (longs > shorts * 2 && longs > 1000000) newLiqStatus = 'Long Spike';
        else if (shorts > longs * 2 && shorts > 1000000) newLiqStatus = 'Short Spike';
      }

      setOnchainData(prev => ({
        ...prev,
        mvrvZScore: newMvrv,
        liquidations: newLiqStatus,
        isAutoSynced: true
      }));

      setCqCooldown(300); // 5 phút cooldown tránh bị block
      showToast("🔗 Đã đồng bộ On-chain chuẩn từ CryptoQuant!");

    } catch (e) {
      console.error(e);
      if (e.message === 'RATE_LIMIT') {
        showToast("❌ Lỗi 429: Vượt quá giới hạn gói Free CryptoQuant (Max 50 req/ngày). Khóa 1 giờ.");
        setCqCooldown(3600); 
      } else {
        showToast("❌ Lỗi API CryptoQuant. Vui lòng kiểm tra lại Key.");
      }
    } finally {
      setIsSyncingCq(false);
    }
  };

  // --- TỰ ĐỘNG LẤY DỮ LIỆU THỊ TRƯỜNG TỪ BINANCE ---
  useEffect(() => {
    let isMounted = true;
    const fetchData = async () => {
      setLoading(true);
      try {
        const oiInterval = ['15m', '1h', '4h', '1d'].includes(interval) ? interval : '1d';
        const [klinesRes, fundingRes, oiCurrentRes, oiHistRes, fgiRes] = await Promise.all([
          fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=150`),
          fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`),
          fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`),
          fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=${oiInterval}&limit=30`),
          fetch('https://api.alternative.me/fng/?limit=7')
        ]);

        if (!isMounted) return;

        const klines = await klinesRes.json();
        const funding = await fundingRes.json();
        const oiCurrent = await oiCurrentRes.json();
        const oiHist = await oiHistRes.json();
        const fgi = await fgiRes.json();

        const closes = klines.map(d => parseFloat(d[4]));
        const highs = klines.map(d => parseFloat(d[2]));
        const lows = klines.map(d => parseFloat(d[3]));
        const currentPrice = closes[closes.length - 1];

        const oiValues = oiHist.map(d => parseFloat(d.sumOpenInterestValue));
        const oiEma14 = QuantMath.ema(oiValues, 14) || oiValues[oiValues.length - 1];
        const currentOiValue = parseFloat(oiCurrent.openInterest) * currentPrice;

        const fgiValues = fgi.data.map(d => parseInt(d.value));
        const currentFGI = fgiValues[0];
        const isFgiUnder20For7Days = fgiValues.length === 7 && fgiValues.every(v => v < 20);

        const atr14 = QuantMath.atr(highs, lows, closes, 14);
        const adxValue = QuantMath.adx(highs, lows, closes, 14);
        const sma200 = QuantMath.sma(closes, 200); 

        if (tradeSetup.entry === 0) {
          setTradeSetup(prev => ({ ...prev, entry: currentPrice }));
        }

        setAutoData({
          currentPrice,
          atr14,
          atrPercent: (atr14 / currentPrice) * 100,
          adx: adxValue,
          sma200,
          fundingRate: funding[0] ? parseFloat(funding[0].fundingRate) * 100 : 0,
          currentOi: currentOiValue,
          oiEma: oiEma14,
          isOiSpiking: currentOiValue > oiEma14,
          fgiValue: currentFGI,
          fgi7DaysLimit: isFgiUnder20For7Days
        });

      } catch (error) {
        console.error("Lỗi Fetch Data Binance:", error);
      }
      if (isMounted) setLoading(false);
    };

    fetchData();
    const timer = setInterval(fetchData, 60000);
    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [symbol, interval]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const handleRiskChange = (e) => {
    let val = parseFloat(e.target.value);
    if (isNaN(val)) val = 0;
    if (val > 1.5) val = 1.5; 
    if (val < 0.1) val = 0.1;
    setTradeSetup(prev => ({ ...prev, riskPercent: val }));
  };

  // --- CORE TOÁN HỌC ---
  const mathCore = useMemo(() => {
    if (!autoData || !tradeSetup.entry || !tradeSetup.slTech) return null;
    
    const riskDiff = Math.abs(tradeSetup.entry - tradeSetup.slTech);
    const rewardDiff = Math.abs(tradeSetup.tpTech - tradeSetup.entry);
    const calculatedRR = riskDiff > 0 ? (rewardDiff / riskDiff) : 0;

    const totalSlDistance = riskDiff + (1.2 * autoData.atr14);
    const slPercent = totalSlDistance / tradeSetup.entry;
    
    const riskAmountUSD = onchainData.capital * (tradeSetup.riskPercent / 100);
    const positionSizeUSD = riskAmountUSD / (slPercent || 1);
    
    const effectiveLeverage = tradeSetup.tradeType === 'SPOT' ? (positionSizeUSD / onchainData.capital) : (positionSizeUSD / onchainData.capital);

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
      isLeverageSafe: tradeSetup.tradeType === 'SPOT' ? true : effectiveLeverage <= 5,
      calculatedRR: calculatedRR.toFixed(2),
      spotScore: spotScore > 4 ? 4 : spotScore 
    };
  }, [autoData, onchainData, tradeSetup]);

  // --- MASTER AUTO ENGINE ---
  const handleMasterAuto = () => {
    if (!autoData || !mathCore) {
      showToast("Chưa có dữ liệu, hãy đợi 1 chút!");
      return;
    }

    let suggestedType = 'FUTURES';
    let suggestedDirection = 'LONG';
    let suggestedRisk = 1.0;

    if (mathCore.spotScore >= 3 && (interval === '1d' || interval === '1w')) {
      suggestedType = 'SPOT';
      suggestedDirection = 'LONG'; 
    } else {
      suggestedType = 'FUTURES';
      if (autoData.currentPrice > autoData.sma200) {
        suggestedDirection = 'LONG';
      } else {
        suggestedDirection = 'SHORT';
      }
    }

    if (autoData.atrPercent > 5 || autoData.adx > 40) {
      suggestedRisk = 0.5; 
    } else if (autoData.adx > 25) {
      suggestedRisk = 1.2; 
    } else {
      suggestedRisk = 0.8; 
    }

    const isTrend = autoData.adx > 25;
    const slMultiplier = isTrend ? 2 : 1.2;
    const tpMultiplier = isTrend ? 4 : 2.5;

    const sl = suggestedDirection === 'LONG' 
      ? autoData.currentPrice - (slMultiplier * autoData.atr14) 
      : autoData.currentPrice + (slMultiplier * autoData.atr14);
      
    const tp = suggestedDirection === 'LONG' 
      ? autoData.currentPrice + (tpMultiplier * autoData.atr14) 
      : autoData.currentPrice - (tpMultiplier * autoData.atr14);

    setTradeSetup(prev => ({
      ...prev,
      tradeType: suggestedType,
      direction: suggestedDirection,
      riskPercent: suggestedRisk,
      entry: autoData.currentPrice,
      slTech: parseFloat(sl.toFixed(2)),
      tpTech: parseFloat(tp.toFixed(2))
    }));

    showToast("✅ Auto-Engine đã lên kịch bản giao dịch chuẩn xác!");
  };

  const checklist = useMemo(() => {
    if (!autoData || !mathCore) return [];
    const c1 = autoData.adx < 20 || autoData.adx > 25; 
    const c2 = tradeSetup.has3Indicators; 
    const isFundingExtreme = Math.abs(autoData.fundingRate) > 0.05;
    const isPsychoTrap = isFundingExtreme && autoData.isOiSpiking;
    const c3 = !isPsychoTrap && onchainData.liquidations === 'Chưa có Spike';
    const c4 = tradeSetup.passedStopHunt && !onchainData.newsTrap; 
    const c5 = mathCore.isLeverageSafe && parseFloat(mathCore.positionSizeUSD) > 0; 
    const c6 = mathCore.calculatedRR >= 1.5 || tradeSetup.tradeType === 'SPOT'; 

    return [
      { id: 1, passed: c1, text: `MARKET REGIME: ADX = ${autoData.adx.toFixed(1)} (Thoát vùng nhiễu).` },
      { id: 2, passed: c2, text: "XÁC NHẬN ĐA LỚP: Đồng thuận 3 chỉ báo kỹ thuật độc lập." },
      { id: 3, passed: c3, text: `TÂM LÝ & DÒNG TIỀN: Phái sinh an toàn, không có Trap (OI/Funding).` },
      { id: 4, passed: c4, text: "CHỐNG THAO TÚNG: Hoàn thành nến rút chân quét thanh khoản." },
      { id: 5, passed: c5, text: `TOÁN HỌC RISK: Đòn bẩy hiệu dụng an toàn (${mathCore.effectiveLeverage}x <= 5x).` },
      { id: 6, passed: c6, text: `KỲ VỌNG DƯƠNG: ${tradeSetup.tradeType === 'SPOT' ? 'Lệnh Spot dài hạn (Bỏ qua R:R ngắn).' : `Tỷ lệ R:R chuẩn (1:${mathCore.calculatedRR}).`}` },
    ];
  }, [autoData, mathCore, tradeSetup, onchainData]);

  const passedCount = checklist.filter(c => c.passed).length;
  const isApproved = passedCount >= 5;

  const handleSaveTradeLog = async () => {
    if (!supabase) {
      showToast("❌ Supabase chưa được cấu hình! Thêm VITE_SUPABASE_URL vào .env");
      return;
    }
    try {
      const { error } = await supabase
        .from('trade_logs')
        .insert([{
          symbol,
          interval,
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
          mvrv: onchainData.mvrvZScore,
          liquidations: onchainData.liquidations,
          news_trap: onchainData.newsTrap,
          leverage: parseFloat(mathCore.effectiveLeverage),
          status: 'OPEN',
          pnl_usd: 0,
          close_price: null
        }]);

      if (error) throw error;
      showToast("☁️ Đã sao lưu Bối cảnh & Mở trạng thái OPEN trên Supabase!");
    } catch (e) {
      console.error(e);
      showToast("❌ Lỗi lưu dữ liệu: Kiểm tra quyền (RLS) trên Supabase.");
    }
  };

  const handleManualClose = async (logId, direction, entry, riskUsd, rr) => {
    if (!supabase || !autoData) return;
    const currentPx = autoData.currentPrice;
    let pnl = 0;
    
    if (direction === 'LONG') {
       const percentMove = (currentPx - entry) / entry;
       pnl = percentMove * 100 * (riskUsd / (Math.abs(entry - tradeSetup.slTech)/entry*100)); 
    } else {
       const percentMove = (entry - currentPx) / entry;
       pnl = percentMove * 100 * (riskUsd / (Math.abs(entry - tradeSetup.slTech)/entry*100));
    }

    const newStatus = pnl >= 0 ? 'WIN' : 'LOSS';
    
    try {
      await supabase
        .from('trade_logs')
        .update({ status: newStatus, close_price: currentPx, pnl_usd: pnl })
        .eq('id', logId);
      showToast(`✂️ Đã chốt thủ công lệnh ${logId.substring(0,4)}...`);
    } catch (e) {
      console.error(e);
    }
  };

  // ==========================================
  // 3. GEMINI AI QUANT ANALYST CẤP CAO (QUẢN TRỊ RATE LIMIT)
  // ==========================================
  const runGeminiAnalysis = async () => {
    if (geminiCooldown > 0) {
      showToast(`⏳ Vui lòng đợi ${geminiCooldown}s để phân tích lại AI.`);
      return;
    }

    if (!autoData || !mathCore) return;
    setIsAnalyzing(true);
    setAiAnalysis('');
    
    try {
      const apiKey = "YOUR_GEMINI_API_KEY_HERE"; 
      
      if (!apiKey || apiKey === "YOUR_GEMINI_API_KEY_HERE") {
        setAiAnalysis('LỖI: Chưa cấu hình VITE_GEMINI_API_KEY. Hãy cấp key từ Netlify.');
        setIsAnalyzing(false);
        return;
      }

      const recentLogs = tradeLogs.slice(0, 3).map(log => 
        `- Lệnh cũ: ${log.type} ${log.direction} ${log.symbol}, R:R=1:${log.rr}, Status: ${log.status}`
      ).join('\n');

      const prompt = `
        Đóng vai AI Quant Analyst trong hệ thống "ANTI-FRAGILE V3.6".
        Dữ liệu thời gian thực (${symbol} - ${interval}):
        - Giá: $${autoData.currentPrice}
        - ADX: ${autoData.adx.toFixed(2)} | Biến động (ATR): ${autoData.atr14.toFixed(2)}
        - MVRV Z-Score: ${onchainData.mvrvZScore}
        - OI Spike: ${autoData.isOiSpiking ? 'Có' : 'Không'}
        - Setup hiện: ${tradeSetup.tradeType} ${tradeSetup.direction}, R:R = 1:${mathCore.calculatedRR}, Đòn bẩy hiệu dụng: ${mathCore.effectiveLeverage}x.
        
        Lịch sử 3 lệnh gần nhất:
        ${recentLogs || 'Chưa có dữ liệu lệnh cũ.'}
        
        Nhiệm vụ: Dựa vào trạng thái thị trường và lịch sử, trả lời bằng 3 câu tiếng Việt siêu ngắn gọn, lạnh lùng, máy móc. Lệnh hiện tại có tối ưu không? Lịch sử User có đang FOMO không?
      `;

      // Cập nhật dùng endpoint interactions của Gemini API (gemini-3.5-flash)
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

      if (response.status === 429) {
        throw new Error('RATE_LIMIT');
      }
      if (!response.ok) {
        throw new Error('API_ERROR');
      }

      const data = await response.json();
      
      // Parse output từ cấu trúc của interactions
      const outputStep = data.steps?.find(step => step.type === 'model_output');
      const text = outputStep?.content?.[0]?.text || data?.candidates?.[0]?.content?.parts?.[0]?.text;
      
      setAiAnalysis(text || 'Vệ tinh AI Quant không phản hồi.');
      setGeminiCooldown(15); 

    } catch (error) {
      console.error(error);
      if (error.message === 'RATE_LIMIT') {
        setAiAnalysis('Lỗi 429: Vượt quá giới hạn Gemini API (Quá số lượt/phút). Đang khóa 1 phút để bảo vệ tài khoản...');
        setGeminiCooldown(60); 
      } else {
        setAiAnalysis('Lỗi kết nối vệ tinh AI Quant. Mạng lưới ngoại tuyến.');
      }
    }
    setIsAnalyzing(false);
  };

  const regimeName = useMemo(() => {
    if (!autoData) return 'ĐANG PHÂN TÍCH...';
    if (autoData.adx < 20) return 'TÍCH LŨY SQUEEZE (< 20)';
    if (autoData.adx > 25) return 'XU HƯỚNG MẠNH (> 25)';
    return 'NO-TRADE ZONE (20-25)';
  }, [autoData]);

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-slate-200 font-sans p-2 md:p-6 selection:bg-emerald-500/30 relative">
      
      {/* TOAST THÔNG BÁO TỪ HỆ THỐNG */}
      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 border border-slate-700 text-white px-5 py-3 rounded-full shadow-2xl flex items-center gap-3 animate-bounce">
          <Bell className="w-5 h-5 text-emerald-400" />
          <span className="font-mono text-sm tracking-wide">{toast}</span>
        </div>
      )}

      {/* HEADER / NAVIGATION */}
      <div className="max-w-7xl mx-auto mb-6 flex flex-col md:flex-row justify-between items-center gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-500 flex items-center gap-2">
            <BrainCircuit className="w-8 h-8 text-emerald-500 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
            ANTI-FRAGILE V3.6
          </h1>
          <p className="text-slate-500 text-xs mt-1 uppercase font-semibold tracking-[0.2em]">PostgreSQL Supabase & Gemini 3.5</p>
        </div>
        
        <div className="flex items-center gap-2 bg-slate-900/50 p-1.5 rounded-lg border border-slate-800">
          <select 
            className="bg-black text-emerald-400 font-mono font-bold px-3 py-1.5 rounded outline-none border border-slate-700/50 text-sm cursor-pointer"
            value={symbol} onChange={(e) => setSymbol(e.target.value)}
          >
            <option value="BTCUSDT">BTC/USDT</option>
            <option value="ETHUSDT">ETH/USDT</option>
            <option value="SOLUSDT">SOL/USDT</option>
          </select>
          <select 
            className="bg-black text-blue-400 font-mono font-bold px-3 py-1.5 rounded outline-none border border-slate-700/50 text-sm cursor-pointer"
            value={interval} onChange={(e) => setIntervalTime(e.target.value)}
          >
            <option value="15m">M15 (Scalp)</option>
            <option value="1h">H1 (Day)</option>
            <option value="4h">H4 (Swing)</option>
            <option value="1d">D1 (Trend)</option>
          </select>
          <div className="px-3 border-l border-slate-700/50">
            {loading ? <div className="animate-pulse text-slate-500 text-xs font-mono flex items-center"><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin"/> LẤY DATA...</div> 
                     : <div className="text-emerald-500 text-xs font-mono flex items-center"><Activity className="w-3.5 h-3.5 mr-1"/> ĐỒNG BỘ MẠNG</div>}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        <div className="lg:col-span-7 space-y-6">
          
          {/* KHỐI 1: MANUAL & AUTO CQ INPUT */}
          <div className="bg-[#111116] border border-slate-800/80 rounded-2xl p-5 shadow-2xl relative">
            <div className="flex items-center justify-between mb-4 border-b border-slate-800/80 pb-3">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-[0.15em] flex items-center gap-2">
                <Database className="w-4 h-4 text-purple-400" /> THÔNG SỐ ON-CHAIN & TÂM LÝ
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-[8px] text-slate-500 hidden sm:block">* Free Limit: 25 syncs/ngày</span>
                <button onClick={syncCryptoQuantData} disabled={isSyncingCq || cqCooldown > 0} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${cqCooldown > 0 ? 'bg-slate-800 text-slate-500 cursor-not-allowed' : 'bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/30 shadow-[0_0_10px_rgba(168,85,247,0.1)]'}`}>
                  {isSyncingCq ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
                  {cqCooldown > 0 ? `ĐỢI ${cqCooldown}s` : 'Sync CryptoQuant'}
                </button>
              </div>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-[#16161c] p-2 rounded-lg border border-slate-800 focus-within:border-emerald-500/50 transition-colors">
                  <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Vốn Hiện Tại ($)</label>
                  <input type="number" value={onchainData.capital} onChange={e => setOnchainData({...onchainData, capital: Number(e.target.value)})} className="w-full bg-transparent text-emerald-400 font-black font-mono outline-none text-base"/>
                </div>
                
                <div className="bg-[#16161c] p-2 rounded-lg border border-slate-800 relative">
                  <label className="text-[9px] text-slate-500 uppercase font-bold block mb-1 flex items-center justify-between">
                    MVRV Z-Score 
                    {onchainData.isAutoSynced && <span className="text-[7px] bg-purple-500/20 text-purple-400 px-1 rounded">AUTO</span>}
                  </label>
                  <input type="number" step="0.1" value={onchainData.mvrvZScore} readOnly={onchainData.isAutoSynced} onChange={e => setOnchainData({...onchainData, mvrvZScore: Number(e.target.value)})} className={`w-full bg-transparent text-blue-400 font-mono outline-none text-sm ${onchainData.isAutoSynced ? 'opacity-70' : ''}`}/>
                </div>
                
                <div className="bg-[#16161c] p-2 rounded-lg border border-slate-800">
                  <label className="text-[9px] text-slate-500 uppercase font-bold block mb-1 flex items-center justify-between">
                    Liquidations
                    {onchainData.isAutoSynced && <span className="text-[7px] bg-purple-500/20 text-purple-400 px-1 rounded">AUTO</span>}
                  </label>
                  {onchainData.isAutoSynced ? (
                     <div className="text-blue-400 font-mono text-xs mt-1.5 opacity-70">{onchainData.liquidations}</div>
                  ) : (
                    <select value={onchainData.liquidations} onChange={e => setOnchainData({...onchainData, liquidations: e.target.value})} className="w-full bg-transparent text-blue-400 font-mono outline-none text-xs cursor-pointer">
                      <option value="Chưa có Spike">Bình thường</option>
                      <option value="Long Spike">Quét Long</option>
                      <option value="Short Spike">Quét Short</option>
                    </select>
                  )}
                </div>
                
                <div className="bg-[#16161c] p-2 rounded-lg border border-slate-800 flex items-center justify-center">
                   <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300 hover:text-white transition-colors group">
                     <input type="checkbox" checked={onchainData.newsTrap} onChange={e => setOnchainData({...onchainData, newsTrap: e.target.checked})} className="w-4 h-4 accent-red-500 bg-black"/>
                     Bẫy Tin Tức
                   </label>
                </div>
            </div>
          </div>

          <div className="bg-[#111116] border border-slate-800/80 rounded-2xl p-5 shadow-2xl relative overflow-hidden">
             
             <button onClick={handleMasterAuto} disabled={!autoData} className="w-full mb-6 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black py-4 rounded-xl shadow-[0_0_20px_rgba(79,70,229,0.3)] transition-all flex items-center justify-center gap-3 uppercase tracking-widest text-sm hover:scale-[1.01]">
                <Zap className="w-5 h-5 fill-current" /> SÁNG TẠO CHIẾN LƯỢC TỰ ĐỘNG (AUTO-ENGINE)
             </button>

             <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                
                <div className="md:col-span-7 space-y-4">
                  
                  <div className="flex gap-2">
                    <div className="flex bg-[#16161c] rounded-lg p-1 border border-slate-800 flex-1">
                      <button onClick={() => setTradeSetup({...tradeSetup, tradeType: 'FUTURES'})} className={`flex-1 py-1.5 text-[10px] font-black uppercase rounded-md transition-all ${tradeSetup.tradeType === 'FUTURES' ? 'bg-indigo-500 text-white shadow-md' : 'text-slate-500 hover:text-slate-300'}`}>
                        FUTURES
                      </button>
                      <button onClick={() => setTradeSetup({...tradeSetup, tradeType: 'SPOT'})} className={`flex-1 py-1.5 text-[10px] font-black uppercase rounded-md transition-all ${tradeSetup.tradeType === 'SPOT' ? 'bg-amber-500 text-black shadow-md' : 'text-slate-500 hover:text-slate-300'}`}>
                        SPOT (HOLD)
                      </button>
                    </div>

                    <div className="flex bg-[#16161c] rounded-lg p-1 border border-slate-800 flex-1">
                      <button onClick={() => setTradeSetup({...tradeSetup, direction: 'LONG'})} className={`flex-1 py-1.5 text-[10px] font-black uppercase rounded-md flex items-center justify-center gap-1 transition-all ${tradeSetup.direction === 'LONG' ? 'bg-emerald-500 text-black shadow-md' : 'text-slate-500 hover:text-slate-300'}`}>
                        <TrendingUp className="w-3 h-3" /> LONG
                      </button>
                      <button onClick={() => setTradeSetup({...tradeSetup, direction: 'SHORT'})} className={`flex-1 py-1.5 text-[10px] font-black uppercase rounded-md flex items-center justify-center gap-1 transition-all ${tradeSetup.direction === 'SHORT' ? 'bg-red-500 text-white shadow-md' : 'text-slate-500 hover:text-slate-300'}`}>
                        <TrendingDown className="w-3 h-3" /> SHORT
                      </button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-4 gap-2">
                    <div className="bg-[#16161c] p-2 rounded-lg border border-slate-800/50">
                      <label className="text-[8px] font-bold text-slate-500 uppercase block mb-1">Risk (%)</label>
                      <input type="number" step="0.1" max="1.5" value={tradeSetup.riskPercent} onChange={handleRiskChange} className="w-full bg-transparent text-emerald-400 font-mono outline-none text-xs"/>
                    </div>
                    <div className="bg-[#16161c] p-2 rounded-lg border border-slate-800/50">
                      <label className="text-[8px] font-bold text-slate-500 uppercase block mb-1">Entry</label>
                      <input type="number" value={tradeSetup.entry} onChange={e => setTradeSetup({...tradeSetup, entry: Number(e.target.value)})} className="w-full bg-transparent text-blue-400 font-mono outline-none text-xs"/>
                    </div>
                    <div className="bg-[#16161c] p-2 rounded-lg border border-slate-800/50">
                      <label className="text-[8px] font-bold text-red-500 uppercase block mb-1">Stop Loss</label>
                      <input type="number" value={tradeSetup.slTech} onChange={e => setTradeSetup({...tradeSetup, slTech: Number(e.target.value)})} className="w-full bg-transparent text-red-400 font-mono outline-none text-xs"/>
                    </div>
                    <div className="bg-[#16161c] p-2 rounded-lg border border-slate-800/50">
                      <label className="text-[8px] font-bold text-emerald-500 uppercase block mb-1">Take Profit</label>
                      <input type="number" value={tradeSetup.tpTech} onChange={e => setTradeSetup({...tradeSetup, tpTech: Number(e.target.value)})} className="w-full bg-transparent text-emerald-400 font-mono outline-none text-xs"/>
                    </div>
                  </div>
                </div>

                <div className="md:col-span-5 bg-[#16161c] p-4 rounded-xl border border-slate-800 font-mono text-xs flex flex-col justify-between shadow-inner">
                  <div>
                    <div className="flex justify-between items-center border-b border-slate-800/80 pb-2 mb-2">
                      <span className="text-slate-500 text-[10px]">Thị trường hiện tại:</span>
                      <span className={`font-bold text-[10px] ${autoData && (autoData.adx > 25 || autoData.adx < 20) ? 'text-emerald-400' : 'text-red-400'}`}>ADX: {autoData?.adx.toFixed(1)}</span>
                    </div>
                    <div className="flex justify-between items-center border-b border-slate-800/80 pb-2 mb-2">
                      <span className="text-slate-500 text-[10px]">Tỷ Lệ R:R Hệ Thống</span>
                      <span className={`font-black text-sm ${mathCore?.calculatedRR >= 1.5 ? 'text-emerald-400' : 'text-red-400'}`}>1 : {mathCore ? mathCore.calculatedRR : '0.00'}</span>
                    </div>
                    <div className="flex justify-between items-center border-b border-slate-800/80 pb-2 mb-2">
                      <span className="text-slate-500 text-[10px]">Max Loss (1R)</span>
                      <span className="text-red-400 font-bold">${mathCore ? mathCore.riskAmountUSD : '0.00'}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 text-[10px]">Quy Mô (Size USD)</span>
                      <span className="text-emerald-400 font-black text-base">${mathCore ? mathCore.positionSizeUSD : '0.00'}</span>
                    </div>
                  </div>
                  
                  <div className="mt-4 pt-3 border-t border-slate-800 flex justify-between items-center">
                    <span className="text-[10px] text-slate-500 uppercase font-sans font-bold">Đòn bẩy hiệu dụng:</span>
                    <span className={`px-2 py-1 rounded text-[10px] font-black ${mathCore?.isLeverageSafe ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                      {tradeSetup.tradeType === 'SPOT' ? '1x (SPOT)' : `${mathCore ? mathCore.effectiveLeverage : '0'}x / 5x`}
                    </span>
                  </div>
                </div>
             </div>
          </div>

          <div className="bg-[#111116] border border-slate-800/80 rounded-2xl p-5 shadow-2xl relative">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-[0.15em] mb-4 flex items-center gap-2 border-b border-slate-800/80 pb-3">
               <History className="w-4 h-4 text-emerald-400" /> SUPABASE TRADE LOGS ({tradeLogs.length})
            </h2>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[10px] font-mono text-slate-400">
                <thead className="text-xs bg-slate-900 text-slate-500">
                  <tr>
                    <th className="p-2 rounded-tl">Thời gian</th>
                    <th className="p-2">Cặp</th>
                    <th className="p-2">Hướng</th>
                    <th className="p-2">R:R (Risk)</th>
                    <th className="p-2">Status</th>
                    <th className="p-2 rounded-tr text-right">Hành động/PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {tradeLogs.length === 0 ? (
                    <tr><td colSpan="6" className="p-4 text-center text-slate-600">Chưa cấu hình Supabase hoặc chưa có dữ liệu</td></tr>
                  ) : (
                    tradeLogs.map(log => (
                      <tr key={log.id} className="border-b border-slate-800 hover:bg-slate-900/50">
                        <td className="p-2">{log.created_at ? new Date(log.created_at).toLocaleString('vi-VN', {hour:'2-digit', minute:'2-digit', day:'2-digit', month:'2-digit'}) : '...'}</td>
                        <td className="p-2 font-bold text-white">{log.symbol}</td>
                        <td className={`p-2 font-bold ${log.direction === 'LONG' ? 'text-emerald-500' : 'text-red-500'}`}>{log.direction}</td>
                        <td className="p-2">1:{log.rr?.toFixed(1)} (${log.risk_amount_usd?.toFixed(0)})</td>
                        <td className="p-2">
                          {log.status === 'OPEN' && <span className="text-blue-400 animate-pulse font-bold">OPEN</span>}
                          {log.status === 'WIN' && <span className="text-emerald-500 font-bold">WIN</span>}
                          {log.status === 'LOSS' && <span className="text-red-500 font-bold">LOSS</span>}
                        </td>
                        <td className="p-2 text-right">
                          {log.status === 'OPEN' ? (
                            <button onClick={() => handleManualClose(log.id, log.direction, log.entry, log.risk_amount_usd, log.rr)} className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded text-[9px] uppercase border border-slate-700">Chốt Sớm</button>
                          ) : (
                            <span className={`font-bold ${log.pnl_usd > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                              {log.pnl_usd > 0 ? '+' : ''}{log.pnl_usd?.toFixed(2)}$
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <div className="text-center mt-2 text-[9px] text-slate-600 italic">* Hệ thống tự động quét giá chạm SL/TP để chốt sổ lệnh OPEN (Cần mở web).</div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 flex flex-col gap-6">
          
          <div className="bg-[#111116] border border-blue-900/30 rounded-2xl p-5 shadow-2xl relative">
             <div className="absolute top-3 right-3 text-blue-500/20"><Bot className="w-12 h-12" /></div>
             <h2 className="text-xs font-bold text-blue-400 uppercase tracking-[0.15em] mb-4 flex items-center gap-2">
               <Bot className="w-4 h-4" /> AI QUANT & LOG ANALYZER
             </h2>
             
             <div className="space-y-4 relative z-10">
               
               <button onClick={runGeminiAnalysis} disabled={isAnalyzing || !autoData || geminiCooldown > 0} className={`w-full py-3 rounded-lg text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${geminiCooldown > 0 ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700' : 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30'}`}>
                 {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <BrainCircuit className="w-4 h-4" />}
                 {geminiCooldown > 0 ? `ĐANG KHÔI PHỤC KẾT NỐI AI (${geminiCooldown}s)` : 'AI ĐỌC LỊCH SỬ & THỊ TRƯỜNG'}
               </button>

               {aiAnalysis && (
                 <div className="bg-[#0a0a0c] p-4 rounded-lg border border-blue-900/30 text-[11px] text-slate-300 leading-relaxed font-mono whitespace-pre-line shadow-inner">
                   <span className="text-blue-500 font-bold mr-2 text-sm">{'>'}</span>{aiAnalysis}
                 </div>
               )}
             </div>
          </div>

          <div className="bg-[#111116] border border-slate-800/80 rounded-2xl p-5 flex-grow flex flex-col shadow-2xl relative">
             <div className="absolute top-0 right-0 p-3"><ShieldAlert className="w-20 h-20 text-slate-800/30 pointer-events-none" /></div>
             <h2 className="text-xs font-black text-slate-300 uppercase tracking-[0.15em] mb-4 flex items-center gap-2 border-b border-slate-800/80 pb-3 relative z-10">
               <Crosshair className="w-4 h-4 text-emerald-500" /> BỘ LỌC DUYỆT LỆNH BẢO MẬT
             </h2>
             
             <div className="mb-4 space-y-2.5 bg-[#16161c] p-3 rounded-xl border border-slate-800/50">
               <div className="text-[9px] text-slate-500 font-bold uppercase tracking-widest mb-2 flex items-center gap-1"><AlertTriangle className="w-3 h-3"/> Xác nhận con người</div>
               <label className="flex items-center gap-3 cursor-pointer text-xs text-slate-300 hover:text-white transition-colors group">
                 <input type="checkbox" checked={tradeSetup.has3Indicators} onChange={e => setTradeSetup({...tradeSetup, has3Indicators: e.target.checked})} className="w-3.5 h-3.5 accent-emerald-500 rounded-sm bg-black border-slate-700"/>
                 Đã thấy 3 chỉ báo đồng thuận
               </label>
               <label className="flex items-center gap-3 cursor-pointer text-xs text-slate-300 hover:text-white transition-colors group">
                 <input type="checkbox" checked={tradeSetup.passedStopHunt} onChange={e => setTradeSetup({...tradeSetup, passedStopHunt: e.target.checked})} className="w-3.5 h-3.5 accent-emerald-500 rounded-sm bg-black border-slate-700"/>
                 Đã có nến rút chân (No Stop-hunt)
               </label>
             </div>

             <div className="flex-grow space-y-3 relative z-10">
               {checklist.map((item) => (
                 <div key={item.id} className="flex items-start gap-2.5 bg-black/20 p-2 rounded-lg border border-white/[0.02]">
                   {item.passed ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 text-slate-700 shrink-0 mt-0.5" />}
                   <span className={`text-[10.5px] leading-relaxed ${item.passed ? 'text-slate-300 font-medium' : 'text-slate-600 line-through'}`}>{item.text}</span>
                 </div>
               ))}
             </div>

             <div className="mt-5 pt-5 border-t border-slate-800/80 flex flex-col gap-3">
                <button disabled={!isApproved} className={`w-full py-3.5 rounded-xl font-black text-[13px] tracking-[0.2em] flex items-center justify-center gap-2 transition-all duration-300 shadow-xl
                    ${isApproved ? 'bg-emerald-500 text-black shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:bg-emerald-400 hover:scale-[1.02]' : 'bg-[#16161c] text-slate-600 border border-slate-800 cursor-not-allowed'}`}>
                  {isApproved ? 'PHÊ DUYỆT (PASS)' : 'KHÓA BẢO VỆ TÀI KHOẢN'}
                </button>
                
                <button disabled={!isApproved} onClick={handleSaveTradeLog} className={`w-full py-2.5 rounded-lg font-bold text-xs tracking-wider flex items-center justify-center gap-2 transition-all
                    ${isApproved ? 'bg-slate-800 text-emerald-400 hover:bg-slate-700 border border-slate-600' : 'bg-transparent text-slate-700 border border-slate-800 cursor-not-allowed'}`}>
                  <Save className="w-4 h-4" /> LƯU NHẬT KÝ VÀO SUPABASE
                </button>
             </div>
          </div>

        </div>
      </div>
    </div>
  );
}