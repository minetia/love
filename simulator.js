// ==========================================
// NEXUS HYPERCORE V3 (Fail-Safe Engine)
// 파일명: simulator.js (index.html과 연결됨)
// ==========================================

const API = {
    upbit: "wss://api.upbit.com/websocket/v1",
    binance: "wss://stream.binance.com:9443/ws",
    rate: 1450 // 고정 환율 (안전장치)
};

class HyperEngine {
    constructor() {
        this.sockets = { upbit: null, binance: null };
        this.market = "KRW-BTC";
        this.isRunning = false;
        
        this.balance = 50000000;
        this.holdings = 0;
        this.avgPrice = 0;
        
        this.prices = { upbit: 0, binance: 0 };
        this.isOffline = false; // 오프라인 모드 플래그
    }

    init() {
        this.log("SYSTEM BOOTING...", "SYS");
        
        // 1. 차트 생성 (트레이딩뷰 위젯 - 무조건 나옴)
        this.renderChart(this.market);
        
        // 2. 데이터 스트림 연결 시도
        this.connectStreams(this.market);
        
        // [핵심] 2초 뒤 무조건 로딩 해제 (무한로딩 방지)
        setTimeout(() => {
            const overlay = document.getElementById('loadingOverlay');
            if (overlay) overlay.classList.add('hidden');
            
            // 데이터가 안 들어왔으면 오프라인 모드 강제 실행
            if (this.prices.upbit === 0) {
                this.startOfflineMode();
            }
        }, 2000);
    }

    // [1] 차트 렌더링 (TradingView Widget)
    renderChart(market) {
        const container = document.getElementById('tv_chart_container');
        if(container) {
            container.innerHTML = ""; // 초기화
            
            const symbol = `UPBIT:${market.replace('KRW-', '')}KRW`;
            
            new TradingView.widget({
                "autosize": true,
                "symbol": symbol,
                "interval": "1",
                "timezone": "Asia/Seoul",
                "theme": "dark",
                "style": "1",
                "locale": "kr",
                "toolbar_bg": "#f1f3f6",
                "enable_publishing": false,
                "hide_side_toolbar": true,
                "allow_symbol_change": false,
                "container_id": "tv_chart_container"
            });
        }
    }

    // [2] 데이터 연결
    connectStreams(market) {
        if(this.sockets.upbit) this.sockets.upbit.close();
        if(this.sockets.binance) this.sockets.binance.close();
        
        try {
            // UPBIT
            this.sockets.upbit = new WebSocket(API.upbit);
            this.sockets.upbit.binaryType = "arraybuffer";
            this.sockets.upbit.onopen = () => {
                const payload = [
                    { ticket: "NEXUS" },
                    { type: "ticker", codes: [market] },
                    { type: "orderbook", codes: [market] },
                    { type: "trade", codes: [market] }
                ];
                this.sockets.upbit.send(JSON.stringify(payload));
                this.log(`UPBIT CONNECTED: ${market}`, "SYS");
            };
            this.sockets.upbit.onmessage = (e) => {
                this.isOffline = false; // 데이터 들어오면 온라인
                const enc = new TextDecoder("utf-8");
                const data = JSON.parse(enc.decode(e.data));
                if(data.type === 'ticker') this.handleUpbit(data);
                if(data.type === 'orderbook') this.renderOrderbook(data);
                if(data.type === 'trade') this.renderTrade(data);
            };

            // BINANCE
            const binSymbol = market.replace('KRW-', '').toLowerCase() + "usdt";
            this.sockets.binance = new WebSocket(`${API.binance}/${binSymbol}@trade`);
            this.sockets.binance.onmessage = (e) => {
                const data = JSON.parse(e.data);
                this.handleBinance(data);
            };

        } catch (e) {
            // 에러 발생 시 조용히 오프라인 모드 전환
            this.startOfflineMode();
        }
    }

    // [3] 오프라인 모드 (가상 데이터 생성기)
    startOfflineMode() {
        if(this.isOffline) return;
        this.isOffline = true;
        this.log("NETWORK DELAY DETECTED. SWITCHING TO SIMULATION MODE.", "SYS");
        
        let price = 135000000; // BTC 기준
        if(this.market.includes('ETH')) price = 3800000;
        if(this.market.includes('XRP')) price = 3500;

        // 0.5초마다 가짜 데이터 생성
        setInterval(() => {
            const change = (Math.random() - 0.5) * 0.002;
            price = price * (1 + change);
            
            // 가짜 업비트 데이터 주입
            this.handleUpbit({
                trade_price: price,
                signed_change_rate: (Math.random() * 0.05) - 0.025,
                change: Math.random() > 0.5 ? 'RISE' : 'FALL'
            });
            
            // 가짜 호가창
            const asks = [], bids = [];
            for(let i=0; i<5; i++) {
                asks.push({ ask_price: price*(1+(i+1)*0.0005), ask_size: Math.random()*2 });
                bids.push({ bid_price: price*(1-(i+1)*0.0005), bid_size: Math.random()*2 });
            }
            this.renderOrderbook({ orderbook_units: [...bids, ...asks], total_ask_size:10, total_bid_size:10 });
            
            // 가짜 체결
            if(Math.random() > 0.6) {
                this.renderTrade({
                    timestamp: Date.now(),
                    ask_bid: Math.random()>0.5 ? 'BID' : 'ASK',
                    trade_price: price,
                    trade_volume: Math.random()
                });
            }
        }, 500);
    }

    // [4] 데이터 처리 핸들러
    handleUpbit(data) {
        this.prices.upbit = data.trade_price;
        
        // UI
        const el = document.getElementById('ticker-price');
        if(el) {
            el.innerText = data.trade_price.toLocaleString();
            el.style.color = data.change === 'RISE' ? 'var(--up)' : 'var(--down)';
        }
        
        const krwEl = document.getElementById('price-krw');
        if(krwEl) krwEl.innerText = data.trade_price.toLocaleString();
        
        const chgEl = document.getElementById('ticker-change');
        if(chgEl && data.signed_change_rate) {
            chgEl.innerText = (data.signed_change_rate * 100).toFixed(2) + "%";
        }

        this.calcKimp();
        if(this.isRunning) this.aiCore();
    }

    handleBinance(data) {
        this.prices.binance = parseFloat(data.p);
        const el = document.getElementById('price-usd');
        if(el) el.innerText = this.prices.binance.toFixed(2);
        this.calcKimp();
    }

    calcKimp() {
        if(!this.prices.upbit || !this.prices.binance) return;
        const binKrw = this.prices.binance * API.rate;
        const kimp = ((this.prices.upbit - binKrw) / binKrw) * 100;
        
        const el = document.getElementById('kimp-rate');
        if(el) {
            el.innerText = kimp.toFixed(2) + "%";
            el.style.color = kimp > 0 ? 'var(--neon)' : '#ff3333';
        }
        
        const bar = document.getElementById('kimp-fill');
        if(bar) bar.style.width = Math.min(Math.abs(kimp)*20, 100) + "%";
    }

    renderOrderbook(data) {
        const list = document.getElementById('ob-list');
        if(!list) return;
        
        let html = '';
        
        // 호가 데이터 정제
        const units = data.orderbook_units || [];
        const asks = units.filter(u=>u.ask_price).slice(0, 5).reverse();
        const bids = units.filter(u=>u.bid_price).slice(0, 5);
        
        if (asks.length === 0 && bids.length === 0) return;

        asks.forEach(u => {
            html += `<div class="ob-row"><div class="ob-bg bg-ask" style="width:${Math.random()*100}%"></div><span class="ask">${u.ask_price.toLocaleString()}</span><span>${u.ask_size.toFixed(3)}</span></div>`;
        });
        bids.forEach(u => {
            html += `<div class="ob-row"><div class="ob-bg bg-bid" style="width:${Math.random()*100}%"></div><span class="bid">${u.bid_price.toLocaleString()}</span><span>${u.bid_size.toFixed(3)}</span></div>`;
        });
        list.innerHTML = html;
    }

    renderTrade(data) {
        const feed = document.getElementById('trade-feed');
        if(!feed) return;

        const div = document.createElement('div');
        div.className = `feed-row ${data.ask_bid==='BID'?'buy':'sell'}`;
        const time = new Date(data.timestamp).toLocaleTimeString('ko-KR',{hour12:false});
        
        div.innerHTML = `
            <span>${time}</span>
            <span>${data.ask_bid==='BID'?'매수':'매도'}</span>
            <span>${data.trade_price.toLocaleString()}</span>
            <span>${data.trade_volume.toFixed(4)}</span>
        `;
        feed.prepend(div);
        if(feed.children.length > 20) feed.removeChild(feed.lastChild);
    }

    // [5] AI 매매 로직
    aiCore() {
        const r = Math.random();
        const price = this.prices.upbit;
        
        if(this.holdings === 0 && r > 0.97) this.buy(price);
        else if(this.holdings > 0) {
            const pnl = (price - this.avgPrice)/this.avgPrice;
            if(pnl > 0.005 || pnl < -0.003 || r > 0.98) this.sell(price);
        }
    }

    buy(price) {
        const amt = this.balance * 0.99;
        this.holdings = amt / price;
        this.balance -= amt;
        this.avgPrice = price;
        this.log(`BUY EXECUTED: ${price.toLocaleString()}`, "BUY");
        this.updateWallet();
    }

    sell(price) {
        const total = this.holdings * price * 0.9995;
        this.balance += total;
        this.holdings = 0;
        this.log(`SELL EXECUTED: ${price.toLocaleString()}`, "SELL");
        this.updateWallet();
    }

    updateWallet() {
        const el = document.getElementById('core-balance');
        if(el) el.innerHTML = Math.floor(this.balance).toLocaleString() + ' <span style="font-size:14px">KRW</span>';
    }

    log(msg, type) {
        const box = document.getElementById('ai-log');
        if(!box) return;

        const div = document.createElement('div');
        div.className = `log-line log-${type.toLowerCase()}`;
        div.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
        box.prepend(div);
        if(box.children.length > 20) box.removeChild(box.lastChild);
    }
}

// 초기화 실행
const core = new HyperEngine();
window.onload = () => core.init();

function changeMarket(val) {
    core.market = val;
    core.log(`MARKET CHANGED: ${val}`, "SYS");
    core.renderChart(val);
    core.connectStreams(val);
}

function toggleEngine() {
    core.isRunning = !core.isRunning;
    const btn = document.getElementById('btn-hyper');
    if(core.isRunning) {
        btn.innerHTML = '<i class="fas fa-spin fa-sync"></i> AI RUNNING...';
        btn.classList.add('running');
        core.log("AI AUTO TRADING STARTED.", "SYS");
    } else {
        btn.innerHTML = '<i class="fas fa-power-off"></i> AUTO TRADING START';
        btn.classList.remove('running');
        core.log("AI STOPPED.", "SYS");
    }
}