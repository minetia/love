// ==========================================
// NEXUS OMEGA: ULTRA HYBRID ENGINE
// ==========================================

const CONFIG = {
    upbitWS: "wss://api.upbit.com/websocket/v1",
    binanceWS: "wss://stream.binance.com:9443/ws",
    geckoAPI: "https://api.coingecko.com/api/v3",
    exchangeRate: 1450 // 고정 환율 (실제론 API로 가져와야 함)
};

class OmegaEngine {
    constructor() {
        this.sockets = { upbit: null, binance: null };
        this.target = "BTC"; // 기본 타겟
        this.prices = { upbit: 0, binance: 0 };
        this.isRunning = false;
        this.balance = 50000000;
        this.holdings = 0;
        
        // 차트 객체
        this.chart = null;
        this.series = null;
    }

    async init() {
        this.log("SYSTEM BOOT SEQUENCE INITIATED...", "SYS");
        this.initChart();
        await this.loadGeckoData(this.target);
        this.connectFeeds(this.target);
    }

    // [1] COINGECKO: 코인 정보 로드 (REST API)
    async loadGeckoData(symbol) {
        const idMap = { 'BTC':'bitcoin', 'ETH':'ethereum', 'XRP':'ripple', 'SOL':'solana', 'DOGE':'dogecoin' };
        const id = idMap[symbol] || 'bitcoin';
        
        try {
            document.getElementById('st-gecko').classList.add('active');
            const res = await axios.get(`${CONFIG.geckoAPI}/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false`);
            const d = res.data;
            
            document.getElementById('info-rank').innerText = `#${d.market_cap_rank}`;
            document.getElementById('info-mcap').innerText = `$${(d.market_data.market_cap.usd / 1e9).toFixed(2)} B`;
            document.getElementById('info-ath').innerText = `$${d.market_data.ath.usd.toLocaleString()}`;
            document.getElementById('info-change').innerText = `${d.market_data.price_change_percentage_24h.toFixed(2)}%`;
            
            this.log(`COINGECKO DATA SYNCED: ${id.toUpperCase()}`, "SYS");
        } catch (e) {
            this.log("COINGECKO API LIMIT REACHED.", "ERR");
        }
    }

    // [2] UPBIT & BINANCE WEBSOCKETS (Real-time)
    connectFeeds(symbol) {
        this.closeSockets();

        // 2-1. UPBIT WebSocket
        this.sockets.upbit = new WebSocket(CONFIG.upbitWS);
        this.sockets.upbit.binaryType = "arraybuffer";
        this.sockets.upbit.onopen = () => {
            const payload = [
                { ticket: "NEXUS_OMEGA" },
                { type: "ticker", codes: [`KRW-${symbol}`] },
                { type: "orderbook", codes: [`KRW-${symbol}`] }
            ];
            this.sockets.upbit.send(JSON.stringify(payload));
            this.log("UPBIT DATA STREAM: CONNECTED", "SYS");
        };
        this.sockets.upbit.onmessage = (e) => {
            const enc = new TextDecoder("utf-8");
            const data = JSON.parse(enc.decode(e.data));
            if(data.type === 'ticker') this.handleUpbitTicker(data);
            if(data.type === 'orderbook') this.renderOrderbook(data);
        };

        // 2-2. BINANCE WebSocket
        const binSymbol = symbol.toLowerCase() + "usdt";
        this.sockets.binance = new WebSocket(`${CONFIG.binanceWS}/${binSymbol}@trade`);
        this.sockets.binance.onopen = () => this.log("BINANCE DATA STREAM: CONNECTED", "SYS");
        this.sockets.binance.onmessage = (e) => {
            const data = JSON.parse(e.data);
            this.handleBinanceTicker(data);
        };
    }

    closeSockets() {
        if(this.sockets.upbit) this.sockets.upbit.close();
        if(this.sockets.binance) this.sockets.binance.close();
    }

    // [3] 데이터 처리 및 김프 계산
    handleUpbitTicker(data) {
        this.prices.upbit = data.trade_price;
        document.getElementById('price-upbit').innerText = data.trade_price.toLocaleString();
        
        // 차트 업데이트
        if(this.series) {
            this.series.update({
                time: Math.floor(Date.now() / 1000),
                value: data.trade_price
            });
        }

        // AI 매매 트리거
        if(this.isRunning) this.aiCore();
        this.calcKimp();
    }

    handleBinanceTicker(data) {
        this.prices.binance = parseFloat(data.p);
        document.getElementById('price-binance').innerText = this.prices.binance.toFixed(2);
        this.calcKimp();
    }

    calcKimp() {
        if(!this.prices.upbit || !this.prices.binance) return;
        
        const binanceKrw = this.prices.binance * CONFIG.exchangeRate;
        const kimp = ((this.prices.upbit - binanceKrw) / binanceKrw) * 100;
        
        const el = document.getElementById('kimp-val');
        el.innerText = kimp.toFixed(2) + "%";
        el.style.color = kimp > 0 ? "var(--neon-green)" : "var(--neon-red)";
        
        // 바 게이지 업데이트
        const bar = document.getElementById('kimp-bar');
        bar.style.width = Math.min(Math.abs(kimp) * 10, 100) + "%";
        bar.style.background = kimp > 0 ? "var(--neon-green)" : "var(--neon-red)";
    }

    // [4] 호가창 렌더링 (업비트)
    renderOrderbook(data) {
        const list = document.getElementById('ob-list');
        let html = "";
        
        const asks = [...data.orderbook_units].reverse().slice(0, 8); // 매도
        const bids = data.orderbook_units.slice(0, 8); // 매수
        
        const maxVol = Math.max(...asks.map(u=>u.ask_size), ...bids.map(u=>u.bid_size));

        asks.forEach(u => {
            const w = (u.ask_size / maxVol) * 100;
            html += `<div class="ob-row"><div class="ob-bg bg-ask" style="width:${w}%"></div><span class="ob-p ask">${u.ask_price.toLocaleString()}</span><span class="ob-s">${u.ask_size.toFixed(3)}</span></div>`;
        });
        bids.forEach(u => {
            const w = (u.bid_size / maxVol) * 100;
            html += `<div class="ob-row"><div class="ob-bg bg-bid" style="width:${w}%"></div><span class="ob-p bid">${u.bid_price.toLocaleString()}</span><span class="ob-s">${u.bid_size.toFixed(3)}</span></div>`;
        });
        
        list.innerHTML = html;
    }

    // [5] AI 자동매매 로직
    aiCore() {
        const r = Math.random();
        const price = this.prices.upbit;
        
        // 단순 확률 로직 (실제 전략 대체)
        // 김프가 낮으면 매수 기회로 포착하는 로직 추가
        
        if (this.holdings === 0 && r > 0.98) {
            this.buy(price);
        } else if (this.holdings > 0) {
            // 이익 실현 or 손절
            const profit = (price - this.avgPrice) / this.avgPrice;
            if (profit > 0.005 || profit < -0.003 || r > 0.99) {
                this.sell(price);
            }
        }
    }

    buy(price) {
        const amt = this.balance * 0.99;
        this.holdings = amt / price;
        this.balance -= amt;
        this.avgPrice = price;
        this.log(`BUY EXECUTED: ${this.holdings.toFixed(4)} @ ${price}`, "TRADE");
        this.updateUI();
    }

    sell(price) {
        const total = this.holdings * price;
        this.balance = total; // 수수료 생략
        this.holdings = 0;
        this.log(`SELL EXECUTED @ ${price} | BAL: ${Math.floor(this.balance)}`, "TRADE");
        this.updateUI();
    }

    updateUI() {
        document.getElementById('my-balance').innerText = Math.floor(this.balance).toLocaleString();
    }

    log(msg, type) {
        const box = document.getElementById('sys-log');
        const div = document.createElement('div');
        div.className = 'log-entry';
        div.innerHTML = `<span class="log-ts">[${new Date().toLocaleTimeString()}]</span> <span class="log-${type.toLowerCase()}">${msg}</span>`;
        box.insertBefore(div, box.firstChild);
        if(box.children.length > 50) box.removeChild(box.lastChild);
    }

    initChart() {
        const container = document.getElementById('tv-chart');
        this.chart = LightweightCharts.createChart(container, {
            layout: { background: { color: '#0d1117' }, textColor: '#888' },
            grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
            width: container.clientWidth,
            height: container.clientHeight,
            timeScale: { timeVisible: true, secondsVisible: true }
        });
        this.series = this.chart.addAreaSeries({
            lineColor: '#00f0ff', topColor: 'rgba(0, 240, 255, 0.4)', bottomColor: 'rgba(0, 240, 255, 0.0)',
        });
    }
}

// Global Init
const nexus = new OmegaEngine();
window.onload = () => nexus.init();

function changeTarget(val) {
    nexus.target = val;
    nexus.log(`TARGET SWAPPED TO ${val}`, "SYS");
    nexus.loadGeckoData(val);
    nexus.connectFeeds(val);
    // 차트 초기화 로직 필요시 추가
}

function toggleEngine() {
    nexus.isRunning = !nexus.isRunning;
    const btn = document.getElementById('btn-engine');
    if(nexus.isRunning) {
        btn.innerHTML = '<i class="fas fa-spin fa-sync"></i> AI RUNNING...';
        btn.classList.add('running');
        nexus.log("AI AUTOMATION ENGAGED.", "SYS");
    } else {
        btn.innerHTML = '<i class="fas fa-power-off"></i> AI ENGINE START';
        btn.classList.remove('running');
        nexus.log("AI AUTOMATION STANDBY.", "SYS");
    }
}