import React, { useState, useEffect, useMemo } from 'react';
import { Activity, ShieldAlert, Crosshair, Database, Zap, Bot, Loader2, CheckCircle2, XCircle, BrainCircuit, TrendingUp, TrendingDown, Save, History, Bell, Link2, ServerCrash, PowerOff } from 'lucide-react';
import { createClient } from 'https://esm.sh/@supabase/supabase-js';

// ==========================================
// 1. SUPABASE & ENV SETUP (NETLIFY VITE)
// ==========================================
// Lưu ý: Canvas preview của AI có thể báo warning về import.meta, nhưng khi push lên Github 
// và deploy qua Netlify Vite, các dòng này sẽ hoạt động hoàn hảo.
const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL || ''; 
const supabaseKey = import.meta.env?.VITE_SUPABASE_ANON_KEY || ''; 
const cqApiKey = import.meta.env?.VITE_CQ_API_KEY || '';
const geminiApiKey = import.meta.env?.VITE_GEMINI_API_KEY || '';

const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// --- LÕI TOÁN HỌC ĐỊNH LƯỢNG (PHÒNG THỦ CHỐNG NaN/CRASH) ---
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

  // --- CRYPTOQUANT SYNC STATE ---
  const [isSyncingCq, setIsSyncingCq] = useState(false);
  const [cqCooldown, setCqCooldown] = useState(0); 

  // --- TRẠNG THÁI ON-CHAIN VÀ TÂM LÝ (Cho phép kết hợp API và Thủ công) ---
  const [onchainData, setOnchainData] = useState({
    capital: 10000,
    mvrvZScore: 1.2,
    liquidations: 'Chưa có Spike', 
    newsTrap: false,
    fgiValue: 50, // Fear & Greed Index
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

  // Quản lý Cooldown
  useEffect(() => {
    if (cqCooldown > 0) { const t = setTimeout(() => setCqCooldown(c => c - 1), 1000); return () => clearTimeout(t); }
  }, [cqCooldown]);

  // --- SUPABASE SYNC LOGS ---
  useEffect(() => {
    if (!supabase) {
      showToast("⚠️ Cảnh báo: VITE_SUPABASE_URL trống. App chạy ở chế độ không lưu Log.");
      return;
    }
    const fetchLogs = async () => {
      try {
        const { data, error } = await supabase.from('trade_logs').select('*').order('created_at', { ascending: false }).limit(50);
        if (error) throw error;
        if (data) setTradeLogs(data);
      } catch (err) {
        console.error("Lỗi fetch Supabase:", err.message);
      }
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

  // --- DATA FETCHING (BINANCE + FEAR/GREED INDEX) ---
  useEffect(() => {
    let isMounted = true;
    const fetchData = async () => {
      setLoading(true);
      try {
        const oiInterval = ['15m', '1h', '4h', '1d'].includes(intervalTime) ? intervalTime : '1d';
        
        // Fetch dữ liệu hoàn toàn miễn phí, an toàn với Rate Limit (1 phút/lần)
        const [klinesRes, fundingRes, oiCurrentRes, oiHistRes, fgiRes] = await Promise.all([
          fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${intervalTime}&limit=150`),
          fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`),
          fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`),
          fetch(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=${oiInterval}&limit=30`),
          fetch('https://api.alternative.me/fng/?limit=1') // Lấy FGI hiện tại
        ]);

        if (!isMounted) return;
        if (!klinesRes.ok || !oiCurrentRes.ok) throw new Error("Binance API bị gián đoạn");

        const klines = await klinesRes.json();
        const funding = await fundingRes.json();
        const oiCurrent = await oiCurrentRes.json();
        const oiHist = await oiHistRes.json();
        
        // Cố gắng parse FGI, nếu lỗi thì giữ nguyên FGI đang nhập tay
        let fetchedFgi = null;
        if (fgiRes.ok) {
          const fgiData = await fgiRes.json();
          if (fgiData?.data?.[0]?.value) {
            fetchedFgi = parseInt(fgiData.data[0].value);
          }
        }

        if (!Array.isArray(klines) || klines.length === 0) throw new Error("Binance trả về dữ liệu nến rỗng");

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

        // Update Auto Data (chỉ báo cơ học)
        setAutoData({
          currentPrice, 
          atr14, 
          atrPercent: currentPrice > 0 ? (atr14 / currentPrice) * 100 : 0, 
          adx: adxValue, 
          sma200,
          fundingRate: (funding && funding[0]) ? parseFloat(funding[0].fundingRate) * 100 : 0,
          currentOi: currentOiValue, 
          oiEma: oiEma14, 
          isOiSpiking: currentOiValue > oiEma14
        });

        // Tự điền Entry tạm nếu đang là 0
        setTradeSetup(prev => prev.entry === 0 ? { ...prev, entry: currentPrice } : prev);

        // Nạp FGI từ API nếu có, không thì giữ cái user đang chỉnh tay
        if (fetchedFgi !== null) {
          setOnchainData(prev => ({ ...prev, fgiValue: fetchedFgi }));
        }

        setSystemError(false); 
        setLastUpdated(new Date());

      } catch (error) {
        console.error("Lỗi đồng bộ Market Data:", error.message);
        setSystemError(true);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchData();
    const timer = setInterval(fetchData, 60000); // Polling 1 phút/lần bảo vệ Rate Limit
    return () => { isMounted = false; clearInterval(timer); };
  }, [symbol, intervalTime]);

  // --- CRYPTOQUANT ĐỒNG BỘ CÓ ĐIỀU KIỆN ---
  const syncCryptoQuantData = async () => {
    if (cqCooldown > 0) return;
    setIsSyncingCq(true);
    
    try {
      if (!cqApiKey) {
        showToast("⚠️ KHÔNG CÓ CQ KEY TRONG .ENV. Vui lòng nhập thông số On-chain thủ công.");
        setCqCooldown(10); // Cooldown ngắn để thử lại
        return; // Không random dữ liệu rác nữa
      }

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
      let newLiqStatus = onchainData.liquidations;

      if (mvrvData?.result?.data?.[0]?.mvrv) newMvrv = parseFloat(mvrvData.result.data[0].mvrv).toFixed(2);
      if (liqData?.result?.data?.[0]) {
        const longs = parseFloat(liqData.result.data[0].long_liquidations_usd || 0);
        const shorts = parseFloat(liqData.result.data[0].short_liquidations_usd || 0);
        if (longs > shorts * 2 && longs > 1000000) newLiqStatus = 'Long Spike';
        else if (shorts > longs * 2 && shorts > 1000000) newLiqStatus = 'Short Spike';
      }

      setOnchainData(prev => ({...prev, mvrvZScore: newMvrv, liquidations: newLiqStatus}));
      setCqCooldown(300); // 5 phút thành công
      showToast("🔗 Đã nạp thành công dữ liệu từ CryptoQuant!");

    } catch (e) {
      if (e.message === 'RATE_LIMIT') { 
        showToast("❌ CQ Rate Limit (Gói Free). Vui lòng nhập số liệu thủ công."); 
        setCqCooldown(3600); 
      } else { 
        showToast("❌ Lỗi API CryptoQuant. Hãy nhập số liệu thủ công."); 
        setCqCooldown(60);
      }
    } finally { setIsSyncingCq(false); }
  };

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  // --- QUẢN TRỊ RỦI RO (RISK <= 2%) ---
  const handleRiskChange = (e) => {
    let val = parseFloat(e.target.value);
    if (isNaN(val)) val = 0;
    if (val > 2.0) val = 2.0; // Ràng buộc bắt buộc theo hệ thống
    if (val < 0.1) val = 0.1;
    setTradeSetup(prev => ({ ...prev, riskPercent: val }));
  };

  // --- LÕI TOÁN HỌC TÍNH TOÁN VỊ THẾ ---
  const mathCore = useMemo(() => {
    const safeResult = {
      slPercent: "0.00", riskAmountUSD: "0.00", positionSizeUSD: "0.00",
      effectiveLeverage: "0.00", isLeverageSafe: false, calculatedRR: "0.00"
    };

    if (!autoData || !tradeSetup.entry || tradeSetup.entry <= 0) return safeResult;
    
    const riskDiff = Math.abs(tradeSetup.entry - tradeSetup.slTech);
    const rewardDiff = Math.abs(tradeSetup.tpTech - tradeSetup.entry);
    
    let calculatedRR = riskDiff > 0 ? (rewardDiff / riskDiff) : 0;
    if (!isFinite(calculatedRR) || isNaN(calculatedRR)) calculatedRR = 0;

    const atrSafe = autoData.atr14 || 0;
    const totalSlDistance = riskDiff + (1.2 * atrSafe);
    
    let slPercent = totalSlDistance / tradeSetup.entry;
    if (!isFinite(slPercent) || isNaN(slPercent) || slPercent === 0) slPercent = 0.01;

    const capitalSafe = onchainData.capital > 0 ? onchainData.capital : 10000;
    const riskAmountUSD = capitalSafe * (tradeSetup.riskPercent / 100);
    let positionSizeUSD = riskAmountUSD / slPercent;
    if (!isFinite(positionSizeUSD) || isNaN(positionSizeUSD)) positionSizeUSD = 0;

    let effectiveLeverage = tradeSetup.tradeType === 'SPOT' ? 1.0 : (positionSizeUSD / capitalSafe);
    if (!isFinite(effectiveLeverage) || isNaN(effectiveLeverage)) effectiveLeverage = 0;
    const isLeverageSafe = tradeSetup.tradeType === 'SPOT' ? true : effectiveLeverage <= 5;

    return {
      slPercent: (slPercent * 100).toFixed(2),
      riskAmountUSD: riskAmountUSD.toFixed(2),
      positionSizeUSD: positionSizeUSD.toFixed(2),
      effectiveLeverage: effectiveLeverage.toFixed(2),
      isLeverageSafe,
      calculatedRR: calculatedRR.toFixed(2)
    };
  }, [autoData, onchainData, tradeSetup]);

  // --- CHECKLIST BẢO MẬT HỆ THỐNG ---
  const checklist = useMemo(() => {
    if (!autoData || !mathCore) return [];
    
    const isFundingExtreme = Math.abs(autoData.fundingRate) > 0.05;
    const isPsychoTrap = isFundingExtreme && autoData.isOiSpiking;
    
    return [
      { id: 1, passed: autoData.adx < 20 || autoData.adx > 25, text: `MARKET REGIME: Lọc nhiễu ADX (${autoData.adx.toFixed(1)}).` },
      { id: 2, passed: tradeSetup.has3Indicators, text: "XÁC NHẬN ĐA LỚP: Đồng thuận 3 chỉ báo độc lập." },
      { id: 3, passed: !isPsychoTrap && onchainData.liquidations === 'Chưa có Spike', text: `BỘ LỌC TÂM LÝ: Thanh khoản sạch (MVRV: ${onchainData.mvrvZScore}, FGI: ${onchainData.fgiValue}).` },
      { id: 4, passed: tradeSetup.passedStopHunt && !onchainData.newsTrap, text: "CHỐNG THAO TÚNG: Hoàn tất Retest, bỏ qua Tin ồn." },
      { id: 5, passed: mathCore.isLeverageSafe && parseFloat(mathCore.positionSizeUSD) > 0, text: `TOÁN HỌC RISK: Đòn bẩy hiệu dụng an toàn (${mathCore.effectiveLeverage}x).` },
      { id: 6, passed: parseFloat(mathCore.calculatedRR) >= 1.5 || tradeSetup.tradeType === 'SPOT', text: `KỲ VỌNG DƯƠNG: Risk/Reward đạt 1:${mathCore.calculatedRR}` },
    ];
  }, [autoData, mathCore, tradeSetup, onchainData]);

  const isApproved = checklist.filter(c => c.passed).length >= 5 && !systemError;

  // --- LƯU LỆNH SUPABASE ---
  const handleSaveTradeLog = async () => {
    if (!supabase) { showToast("❌ Không có Supabase URL. Lệnh không được ghi lại."); return; }
    try {
      const payload = {
        symbol: symbol,
        interval: intervalTime,
        type: tradeSetup.tradeType,
        direction: tradeSetup.direction,
        entry: parseFloat(tradeSetup.entry) || 0,
        sl: parseFloat(tradeSetup.slTech) || 0,
        tp: parseFloat(tradeSetup.tpTech) || 0,
        risk_amount_usd: parseFloat(mathCore.riskAmountUSD) || 0,
        rr: parseFloat(mathCore.calculatedRR) || 0,
        adx: autoData.adx || 0,
        atr: autoData.atr14 || 0,
        funding_rate: autoData.fundingRate || 0,
        oi_spiking: Boolean(autoData.isOiSpiking),
        fgi: parseFloat(onchainData.fgiValue) || 50,
        trend_sma200: (autoData.currentPrice > autoData.sma200) ? 'ABOVE' : 'BELOW',
        mvrv: parseFloat(onchainData.mvrvZScore) || 0,
        liquidations: onchainData.liquidations || 'Chưa có Spike',
        news_trap: Boolean(onchainData.newsTrap),
        leverage: parseFloat(mathCore.effectiveLeverage) || 1,
        status: 'OPEN',
        close_price: null,
        pnl_usd: 0
      };

      const { error } = await supabase.from('trade_logs').insert([payload]);
      if (error) throw error;
      showToast("☁️ Lệnh đã được đưa lên hệ thống DB an toàn!");
    } catch (e) { 
      console.error(e); 
      showToast(`❌ Lỗi Ghi Log: ${e.message}`); 
    }
  };

  const handleManualClose = async (logId, direction, entry, logSl, riskUsd) => {
    if (!supabase || !autoData) return;
    const currentPx = autoData.currentPrice;
    let pnl = 0;
    
    const riskDistance = Math.abs(entry - logSl);
    if (riskDistance > 0) {
       const positionCoins = riskUsd / riskDistance;
       if (direction === 'LONG') { pnl = (currentPx - entry) * positionCoins; } 
       else { pnl = (entry - currentPx) * positionCoins; }
    }

    const newStatus = pnl >= 0 ? 'WIN' : 'LOSS';
    
    try {
      await supabase.from('trade_logs').update({ status: newStatus, close_price: currentPx, pnl_usd: pnl }).eq('id', logId);
      showToast(`✂️ Đã chốt sổ lệnh! Cập nhật PnL: ${pnl.toFixed(2)}$`);
    } catch (e) { console.error(e); }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-slate-200 font-mono p-2 md:p-6 selection:bg-emerald-500/30 relative">
      
      {/* CẢNH BÁO */}
      {systemError && (
        <div className="fixed top-0 left-0 w-full bg-red-600/90 text-white text-center py-1.5 text-xs font-bold z-[100] flex justify-center items-center gap-2 shadow-lg">
          <ServerCrash className="w-4 h-4 animate-pulse"/> KẾT NỐI API BINANCE THẤT BẠI. DỮ LIỆU CÓ THỂ BỊ SAI LỆCH!
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
            <PowerOff className="w-7 h-7" /> ANTI-FRAGILE <span className="text-slate-500">V3.2 (Hybrid API/Manual)</span>
          </h1>
          <p className="text-slate-500 text-[10px] mt-1 uppercase tracking-widest">
            {lastUpdated ? `Cập nhật nến: ${lastUpdated.toLocaleTimeString()}` : 'Đang xử lý dữ liệu...'}
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
        
        {/* CỘT TRÁI: THÔNG SỐ VÀ TOÁN HỌC */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* THÔNG SỐ VĨ MÔ ON-CHAIN (Nhập tay kết hợp API) */}
          <div className="bg-[#111116] border border-slate-800 rounded-xl p-4 shadow-xl relative">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-2">
                <Database className="w-3 h-3 text-purple-400" /> THÔNG SỐ VĨ MÔ (Tự động cập nhật hoặc Sửa tay)
              </h2>
              <button onClick={syncCryptoQuantData} disabled={isSyncingCq || cqCooldown > 0} className="text-[8px] bg-purple-500/10 text-purple-400 px-2 py-1 rounded border border-purple-500/30 font-bold flex items-center gap-1 hover:bg-purple-500/20 transition-all">
                {isSyncingCq ? <Loader2 className="w-3 h-3 animate-spin"/> : <Link2 className="w-3 h-3"/>}
                TẢI MVRV (CQ) {cqCooldown > 0 && `(${cqCooldown}s)`}
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800 focus-within:border-emerald-500/50 transition-colors">
                  <label className="text-[8px] text-slate-500 block mb-1">VỐN TỔNG (USD)</label>
                  <input type="number" value={onchainData.capital} onChange={e => setOnchainData({...onchainData, capital: Number(e.target.value)})} className="w-full bg-transparent text-emerald-400 font-bold outline-none text-sm"/>
                </div>
                <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800 focus-within:border-blue-500/50 transition-colors">
                  <label className="text-[8px] text-slate-500 block mb-1">MVRV Z-SCORE</label>
                  <input type="number" step="0.1" value={onchainData.mvrvZScore} onChange={e => setOnchainData({...onchainData, mvrvZScore: Number(e.target.value)})} className="w-full bg-transparent text-blue-400 font-bold outline-none text-sm" placeholder="Điền MVRV"/>
                </div>
                <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800 focus-within:border-amber-500/50 transition-colors">
                  <label className="text-[8px] text-slate-500 block mb-1">FEAR & GREED</label>
                  <input type="number" value={onchainData.fgiValue} onChange={e => setOnchainData({...onchainData, fgiValue: Number(e.target.value)})} className="w-full bg-transparent text-amber-400 font-bold outline-none text-sm" placeholder="FGI (0-100)"/>
                </div>
                <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800">
                  <label className="text-[8px] text-slate-500 block mb-1">LIQUIDATIONS</label>
                  <select value={onchainData.liquidations} onChange={e => setOnchainData({...onchainData, liquidations: e.target.value})} className="w-full bg-transparent text-red-400 font-bold outline-none text-[10px]">
                    <option value="Chưa có Spike">Bình thường</option>
                    <option value="Long Spike">Quét Long</option>
                    <option value="Short Spike">Quét Short</option>
                  </select>
                </div>
                <div className="bg-[#0a0a0c] p-2 rounded border border-slate-800 flex items-center justify-center">
                   <label className="flex items-center gap-1.5 cursor-pointer text-[9px] text-slate-400 hover:text-red-400 transition-colors">
                     <input type="checkbox" checked={onchainData.newsTrap} onChange={e => setOnchainData({...onchainData, newsTrap: e.target.checked})} className="accent-red-500 w-3 h-3 bg-black"/>
                     Bẫy Tin Tức
                   </label>
                </div>
            </div>
            <p className="text-[8px] text-slate-600 italic mt-3">* Các ô này sẽ tự điền nếu có API. Nếu API báo lỗi/giới hạn, bạn cứ việc sửa tay số liệu tham khảo từ Web ngoài.</p>
          </div>

          {/* VÙNG THIẾT LẬP LỆNH */}
          <div className="bg-[#111116] border border-slate-800 rounded-xl p-4 shadow-xl">
             <div className="flex items-center justify-between mb-4 border-b border-slate-800/80 pb-3">
                <h2 className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-2"><Crosshair className="w-3 h-3 text-emerald-500" /> THÔNG SỐ VỊ THẾ (RỦI RO ĐƯỢC KIỂM SOÁT)</h2>
                <div className="text-[9px] px-2 py-0.5 bg-slate-800 rounded text-slate-400 border border-slate-700">Thị giá Binance: <span className="text-white font-bold">${autoData?.currentPrice || '---'}</span></div>
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
                  <div className="grid grid-cols-2 gap-2 mt-2">
                     <div className="bg-slate-900/50 p-2 rounded border border-slate-700 focus-within:border-emerald-500/50">
                      <label className="text-[8px] font-bold text-slate-400 block mb-1">RISK (%) [MAX 2.0%]</label>
                      <input type="number" step="0.1" value={tradeSetup.riskPercent} onChange={handleRiskChange} className="w-full bg-transparent text-emerald-400 font-bold outline-none text-sm"/>
                     </div>
                     <div className="bg-slate-900/50 p-2 rounded border border-slate-700 focus-within:border-blue-500/50">
                      <label className="text-[8px] font-bold text-slate-400 block mb-1">GIÁ ENTRY</label>
                      <input type="number" value={tradeSetup.entry} onChange={e=>setTradeSetup({...tradeSetup, entry:Number(e.target.value)})} className="w-full bg-transparent text-white font-bold outline-none text-sm" placeholder="Ví dụ: 62000"/>
                     </div>
                     <div className="bg-red-950/20 p-2 rounded border border-red-900/30 focus-within:border-red-500/50">
                      <label className="text-[8px] font-bold text-red-500 block mb-1">STOP LOSS</label>
                      <input type="number" value={tradeSetup.slTech} onChange={e=>setTradeSetup({...tradeSetup, slTech:Number(e.target.value)})} className="w-full bg-transparent text-red-400 font-bold outline-none text-sm"/>
                     </div>
                     <div className="bg-emerald-950/20 p-2 rounded border border-emerald-900/30 focus-within:border-emerald-500/50">
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
                      <span className="text-[10px] font-bold text-slate-500">Mức Chịu Lỗ (Risk USD):</span>
                      <span className="text-red-400 font-black text-sm">${mathCore?.riskAmountUSD}</span>
                    </div>
                    <div className="flex justify-between items-end border-b border-slate-800 pb-1.5">
                      <span className="text-[10px] font-bold text-slate-500">Tỉ Lệ Reward/Risk:</span>
                      <span className={`font-black text-sm ${parseFloat(mathCore?.calculatedRR) >= 1.5 ? 'text-emerald-400' : 'text-amber-500'}`}>1 : {mathCore?.calculatedRR}</span>
                    </div>
                    <div className="flex justify-between items-end border-b border-slate-800 pb-1.5">
                      <span className="text-[10px] font-bold text-slate-500">Quy Mô Lệnh Vào (Size):</span>
                      <span className="text-white font-black text-base">${mathCore?.positionSizeUSD}</span>
                    </div>
                    <div className="flex justify-between items-center bg-slate-950 p-2 rounded border border-slate-800">
                      <span className="text-[9px] text-slate-400 font-bold uppercase">Đòn Bẩy Hiệu Dụng:</span>
                      <span className={`px-2 py-1 rounded text-[11px] font-black ${mathCore?.isLeverageSafe ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                        {tradeSetup.tradeType === 'SPOT' ? '1.00x (AN TOÀN)' : `${mathCore?.effectiveLeverage}x / 5.0x`}
                      </span>
                    </div>
                  </div>
                </div>
             </div>
          </div>

          {/* SỔ TAY GHI CHÉP GIAO DỊCH */}
          <div className="bg-[#111116] border border-slate-800 rounded-xl p-4 overflow-hidden shadow-xl">
            <h2 className="text-[10px] font-bold text-slate-400 uppercase mb-3 flex items-center gap-2"><History className="w-3 h-3 text-emerald-400" /> SỔ TAY GIAO DỊCH LƯU TRỮ (SUPABASE DB)</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[9px] text-slate-400">
                <thead className="bg-slate-900 text-slate-500">
                  <tr><th className="p-2 rounded-tl">Mã/Loại</th><th className="p-2">Hướng</th><th className="p-2">Giá Entry / Cắt lỗ</th><th className="p-2">Mất($) / Ăn(R)</th><th className="p-2">Status</th><th className="p-2 rounded-tr text-right">PnL/Hành động</th></tr>
                </thead>
                <tbody>
                  {tradeLogs.length === 0 ? <tr><td colSpan="6" className="p-6 text-center border-b border-slate-800 text-slate-600">DB đang trống hoặc chưa đồng bộ...</td></tr> :
                    tradeLogs.map(log => (
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
          
          <div className="bg-[#111116] border border-slate-800 rounded-xl p-4 flex-grow flex flex-col shadow-xl">
             <h2 className="text-[10px] font-bold text-slate-300 uppercase mb-4 flex items-center gap-2 border-b border-slate-800 pb-3"><ShieldAlert className="w-4 h-4 text-emerald-500" /> BỘ LỌC KIỂM DUYỆT V3.0 (Tối thiểu 5/6 Passed)</h2>
             
             {/* BƯỚC CHECK TAY (Human Override) */}
             <div className="mb-4 space-y-2 bg-[#0a0a0c] p-3 rounded-lg border border-slate-800">
               <div className="text-[9px] text-slate-500 font-bold uppercase flex items-center gap-1 mb-2"><Crosshair className="w-3 h-3"/> Xác nhận Hành động giá trên Chart</div>
               <label className="flex items-center gap-2 text-[10px] text-slate-300 hover:text-white cursor-pointer transition-colors">
                 <input type="checkbox" checked={tradeSetup.has3Indicators} onChange={e => setTradeSetup({...tradeSetup, has3Indicators: e.target.checked})} className="accent-emerald-500 w-3.5 h-3.5 bg-black"/>
                 Thỏa mãn đồng thuận 3 chỉ báo kỹ thuật
               </label>
               <label className="flex items-center gap-2 text-[10px] text-slate-300 hover:text-white cursor-pointer transition-colors">
                 <input type="checkbox" checked={tradeSetup.passedStopHunt} onChange={e => setTradeSetup({...tradeSetup, passedStopHunt: e.target.checked})} className="accent-emerald-500 w-3.5 h-3.5 bg-black"/>
                 Thấy nến rút chân xác nhận (Tránh Stop-hunt)
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
             <div className="mt-5 pt-5 border-t border-slate-800">
                <button disabled={!isApproved} onClick={handleSaveTradeLog} className={`w-full py-4 rounded-lg font-black text-[11px] tracking-widest flex items-center justify-center gap-2 transition-all duration-300 shadow-xl
                    ${isApproved ? 'bg-emerald-500 text-black hover:bg-emerald-400 hover:scale-[1.01] shadow-[0_0_15px_rgba(16,185,129,0.3)]' : 'bg-slate-800/50 text-slate-600 border border-slate-700 cursor-not-allowed'}`}>
                  {isApproved ? <><Save className="w-4 h-4"/> ĐỦ ĐIỀU KIỆN - LƯU VÀO SỔ TAY DB</> : 'KHÓA BẢO VỆ: CHƯA ĐẠT CHUẨN'}
                </button>
                <p className="text-center text-[9px] text-slate-500 mt-3 font-mono">
                  {isApproved ? 'Các bộ lọc rủi ro đã cho qua. Bạn có thể lưu sổ.' : 'Hãy đảm bảo các thông số Toán học hoặc On-chain hợp lệ.'}
                </p>
             </div>
          </div>

        </div>
      </div>
    </div>
  );
}