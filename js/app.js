/**
 * QQ Music Web Player - Main Application
 * Sidebar Layout Version
 */

import { searchByType } from './api/search.js';
import { getSongUrlWithFallback } from './api/song.js';
import { getCredential } from './api/credential.js';
import { checkExpired, refreshCredential } from './api/login.js';
import { getLyric } from './api/lyric.js';
import { getSongListDetail, getUserSongLists } from './api/songlist.js';
import { getValidCoverUrl, getCoverUrlSync, getCoverCandidates, DEFAULT_COVER } from './utils/cover.js';

// Utility functions
function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function debounce(func, wait) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}


// History Manager
class HistoryManager {
    constructor(ui) {
        this.ui = ui;
        this.history = [];
        this.MAX_HISTORY = 100;
        this.load();
    }

    load() {
        try {
            const saved = localStorage.getItem('qqmusic_history');
            if (saved) {
                this.history = JSON.parse(saved);
            }
        } catch (e) {
            console.warn('Failed to load history', e);
        }
    }

    save() {
        try {
            localStorage.setItem('qqmusic_history', JSON.stringify(this.history));
        } catch (e) {
            console.warn('Failed to save history', e);
        }
    }

    add(song) {
        // Remove duplicates (move to top)
        this.history = this.history.filter(s => s.mid !== song.mid);
        this.history.unshift(song);

        if (this.history.length > this.MAX_HISTORY) {
            this.history.pop();
        }

        this.save();
        if (this.ui.currentPage === 'history') {
            this.render();
        }
    }

    clear() {
        this.history = [];
        this.save();
        this.render();
    }

    render() {
        // Reuse renderPlaylist logic with custom container
        // We pass -1 as currentIndex so nothing highlighter unless playing?
        // Actually history doesn't need highlight active
        this.ui.renderPlaylist(this.history, -1, 'history-list', true);
    }
}

// Saved Playlist Manager
class SavedPlaylistManager {
    constructor(ui) {
        this.ui = ui;
        this.playlists = [];
        this.load();
    }

    load() {
        try {
            const saved = localStorage.getItem('qqmusic_saved_playlists');
            if (saved) {
                this.playlists = JSON.parse(saved);
            }
        } catch (e) {
            console.warn('Failed to load saved playlists', e);
        }
    }

    save() {
        localStorage.setItem('qqmusic_saved_playlists', JSON.stringify(this.playlists));
    }

    async importPlaylist(disstid) {
        return this.importPlaylists([disstid]);
    }

    async importPlaylists(playlistsInfo) {
        if (!playlistsInfo || playlistsInfo.length === 0) return;

        this.ui.showLoading(true);
        let successCount = 0;
        let failCount = 0;

        for (const item of playlistsInfo) {
            // item can be ID (string/number) or Object {id, name, cover}
            let id, name, cover;

            if (typeof item === 'object') {
                id = item.id || item.tid || item.disstid;
                name = item.name || item.dirName || '未命名歌单';
                cover = item.cover || item.dirPic || item.pic || '';
            } else {
                id = item;
                name = null;
                cover = null;
            }

            try {
                this.ui.notify(`正在导入: ${name || id}`, 'info');
                const data = await getSongListDetail(id);

                const playlist = {
                    id: data.info.disstid || id,
                    name: name || data.info.dissname || 'Imported Playlist',
                    cover: cover || data.info.logo || '',
                    songs: data.songs.map(s => this.normalizeSong(s)),
                    count: data.songs.length,
                    createTime: Date.now()
                };

                // Check if exists
                const idx = this.playlists.findIndex(p => p.id == playlist.id);
                if (idx !== -1) {
                    this.playlists[idx] = playlist; // Update
                } else {
                    this.playlists.push(playlist);
                }
                successCount++;
            } catch (e) {
                console.error(`Import failed for ${id}:`, e);
                failCount++;
            }
        }

        this.save();
        this.render();
        this.ui.showLoading(false);

        if (successCount > 0) {
            this.ui.notify(`成功导入 ${successCount} 个歌单${failCount > 0 ? `，失败 ${failCount} 个` : ''}`);
        } else if (failCount > 0) {
            this.ui.notify(`导入失败 ${failCount} 个歌单`, 'error');
        }

        return successCount > 0;
    }



    normalizeSong(s) {
        // Convert API format to App format
        return {
            mid: s.mid || s.songmid,
            name: s.name || s.songname,
            singers: s.singer ? s.singer.map(singer => singer.name).join('/') : (s.singername || ''),
            album: s.album ? { name: s.album.name, mid: s.album.mid } : { name: s.albumname, mid: s.albummid },
            interval: s.interval,
            vs: s.vs || []
        };
    }

    deletePlaylist(id) {
        this.playlists = this.playlists.filter(p => p.id != id);
        this.save();
        this.render();
    }

    render() {
        const container = document.getElementById('saved-playlists');
        if (!container) return;

        if (this.playlists.length === 0) {
            container.innerHTML = '<div class="empty-hint">暂无收藏歌单</div>';
            return;
        }

        container.innerHTML = '';
        this.playlists.forEach(p => {
            const el = document.createElement('div');
            el.className = 'playlist-card';
            el.innerHTML = `
                <div class="card-cover">
                    <img src="${p.cover}" loading="lazy" onerror="this.src='https://y.gtimg.cn/mediastyle/global/img/playlist_300.png'">
                </div>
                <div class="card-title" title="${p.name}">${p.name}</div>
                <div class="card-info">${p.count}首</div>
                <button class="delete-btn" title="删除"><i class="fas fa-times"></i></button>
            `;

            el.onclick = (e) => {
                if (e.target.closest('.delete-btn')) return;
                // Show Detail Page instead of playing immediately
                this.ui.showPlaylistDetail(p);
            };

            el.querySelector('.delete-btn').onclick = (e) => {
                e.stopPropagation();
                // Direct delete without confirmation
                this.deletePlaylist(p.id);
            };

            container.appendChild(el);
        });
    }
}

// UI Manager Class
class UIManager {
    constructor() {
        this.els = {
            // Background
            bgLayer1: document.getElementById('bg-layer-1'),
            bgLayer2: document.getElementById('bg-layer-2'),

            // Bottom bar info
            thumbImg: document.getElementById('thumb-img'),
            barTitle: document.getElementById('bar-title'),
            barArtist: document.getElementById('bar-artist'),
            nowPlaying: document.querySelector('.now-playing'),

            // Controls
            playBtn: document.getElementById('play-btn'),
            currentTime: document.getElementById('current-time'),
            totalTime: document.getElementById('total-time'),
            progressFill: document.getElementById('progress-fill'),
            progressBar: document.getElementById('progress-bar'),

            // Pages
            searchPage: document.getElementById('search-page'),
            playlistPage: document.getElementById('playlist-page'),
            queuePage: document.getElementById('queue-page'),
            historyPage: document.getElementById('history-page'),

            // Search
            searchInput: document.getElementById('search-input'),
            resultsList: document.getElementById('results-list'),
            loadingSpinner: document.getElementById('loading-spinner'),
            pagination: document.getElementById('pagination'),
            pageInfo: document.getElementById('page-info'),

            // Playlist
            playlistList: document.getElementById('playlist-list'), // Current Queue
            savedPlaylists: document.getElementById('saved-playlists'), // Saved Playlists container

            // History
            historyList: document.getElementById('history-list'),

            // Immersive Player (只保留歌词)
            immersivePlayer: document.getElementById('immersive-player'),
            immersiveClose: document.getElementById('immersive-close'),
            immersivePrev: document.getElementById('immersive-prev'),
            immersiveNext: document.getElementById('immersive-next'),
            lyricsScroll: document.getElementById('lyrics-scroll'),

            // Notifications
            notificationContainer: document.getElementById('notification-container'),

            // Detail Page
            detailPage: document.getElementById('detail-page'),
            detailBackBtn: document.getElementById('detail-back-btn'),
            detailCoverImg: document.getElementById('detail-cover-img'),
            detailTitle: document.getElementById('detail-title'),
            detailMeta: document.getElementById('detail-meta'),
            detailPlayAll: document.getElementById('detail-play-all'),
            detailList: document.getElementById('detail-list')
        };

        this.activeBgLayer = 1;
        this.currentPage = 'search';

        this.initNavigation();
        this.initImmersivePlayer();
    }

    initNavigation() {
        // 侧边栏导航点击事件
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const page = btn.dataset.page;
                this.switchPage(page);
                // switch page logic handles this class toggle
            });
        });
    }

    switchPage(pageName) {
        this.currentPage = pageName;

        // Update nav
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.page === pageName);
        });

        // Hide all pages
        document.querySelectorAll('.page').forEach(page => {
            page.classList.remove('active');
        });

        // Show target page
        const targetPage = document.getElementById(`${pageName}-page`);
        if (targetPage) {
            targetPage.classList.add('active');
        }

        // Trigger render updates if needed
        if (pageName === 'playlist') {
            window.savedPlaylistManager.render();
        } else if (pageName === 'queue') {
            // Queue page: ensure scroll to active
            setTimeout(() => {
                const active = this.els.playlistList.querySelector('.active');
                if (active) active.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }, 100);
        } else if (pageName === 'history') {
            window.historyManager.render();
        }
    }

    showPlaylistDetail(playlist) {
        this.switchPage('detail');

        // Store current playlist reference for click handlers
        this.currentDetailPlaylist = playlist;

        const cover = playlist.cover || 'https://y.gtimg.cn/mediastyle/global/img/playlist_300.png';
        const count = playlist.songs ? playlist.songs.length : playlist.count;

        this.els.detailCoverImg.src = cover;
        this.els.detailTitle.textContent = playlist.name;
        this.els.detailMeta.textContent = `${count}首歌曲`;

        // Play All Action
        this.els.detailPlayAll.onclick = () => {
            if (playlist.songs && playlist.songs.length > 0) {
                window.player.replaceQueue(playlist.songs);
            } else {
                this.notify('歌单为空', 'info');
            }
        };

        // Render List with special flag for detail page
        this.renderPlaylist(playlist.songs || [], -1, 'detail-list', false, true);
    }

    showLoading(show) {
        // Implement simple loading overlay or toast
        if (show) {
            this.notify('正在加载...', 'info');
        }
    }

    notify(msg, type = 'success') {
        this.els.notificationContainer.innerHTML = '';

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `<span>${msg}</span>`;
        this.els.notificationContainer.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400);
        }, 3000);
    }

    setPlaying(isPlaying) {
        this.els.playBtn.innerHTML = isPlaying
            ? '<i class="fas fa-pause"></i>'
            : '<i class="fas fa-play"></i>';

        document.body.classList.toggle('playing', isPlaying);
    }

    updateProgress(curr, total) {
        if (!total) return;
        this.els.currentTime.textContent = formatTime(curr);
        this.els.totalTime.textContent = formatTime(total);
        this.els.progressFill.style.width = `${(curr / total) * 100}%`;
    }

    updateSongInfo(song) {
        // 更新底部栏信息
        this.els.barTitle.textContent = song.name;
        this.els.barArtist.textContent = song.singers;

        // 更新封面 - 使用候选列表和回退机制
        const coverCandidates = getCoverCandidates(song, 300);
        this.els.thumbImg.src = coverCandidates[0];
        this.els.thumbImg._coverCandidates = coverCandidates;
        this.els.thumbImg.dataset.coverIndex = '0';
        this.els.thumbImg.onerror = function () {
            const currentIndex = parseInt(this.dataset.coverIndex) || 0;
            const nextIndex = currentIndex + 1;
            if (nextIndex < this._coverCandidates.length) {
                this.dataset.coverIndex = nextIndex;
                this.src = this._coverCandidates[nextIndex];
            }
        };

        // 更新背景 (使用第一个候选)
        this.setBackground(coverCandidates[0]);

        // Update Media Session
        if ('mediaSession' in navigator) {
            const coverCandidates800 = getCoverCandidates(song, 800);
            navigator.mediaSession.metadata = new MediaMetadata({
                title: song.name,
                artist: song.singers,
                album: song.album || '',
                artwork: [
                    { src: coverCandidates[0], sizes: '300x300', type: 'image/jpeg' },
                    { src: coverCandidates800[0], sizes: '800x800', type: 'image/jpeg' }
                ]
            });
        }
    }

    setBackground(coverUrl) {
        const nextLayer = this.activeBgLayer === 1 ? 2 : 1;
        const nextEl = this.activeBgLayer === 1 ? this.els.bgLayer2 : this.els.bgLayer1;
        const currEl = this.activeBgLayer === 1 ? this.els.bgLayer1 : this.els.bgLayer2;

        nextEl.style.backgroundImage = `url(${coverUrl})`;
        nextEl.classList.remove('fade-out');
        currEl.classList.add('fade-out');

        this.activeBgLayer = nextLayer;
    }

    renderPlaylist(queue, currentIndex, containerId = 'playlist-list', isHistory = false, isDetailPage = false) {
        const container = document.getElementById(containerId) || this.els.playlistList;
        if (!container) return;

        if (queue.length === 0) {
            const emptyText = isHistory ? '暂无播放记录' : '播放列表为空';
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-music"></i>
                    <p>${emptyText}</p>
                </div>
            `;
            return;
        }

        container.innerHTML = '';
        const fragment = document.createDocumentFragment();

        queue.forEach((song, i) => {
            const cover = getCoverUrlSync(song, 300);
            const isActive = !isHistory && !isDetailPage && i === currentIndex;

            const div = document.createElement('div');
            div.className = `song-item ${isActive ? 'active' : ''}`;
            div.innerHTML = `
                <div class="item-cover">
                    <img src="${cover}" loading="lazy">
                </div>
                <div class="item-info">
                    <div class="item-title">${song.name}</div>
                    <div class="item-artist">${song.singers}</div>
                </div>
                ${!isHistory && !isDetailPage ? `
                <div class="item-actions">
                    <button class="action-btn remove-btn" data-idx="${i}" title="移除">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                ` : ''}
            `;

            div.addEventListener('click', (e) => {
                if (!e.target.closest('.remove-btn')) {
                    if (isHistory) {
                        // Play from history: add to queue and play
                        window.player.addToQueue(song);
                        window.player.playFromQueue(window.player.queue.length - 1);
                    } else if (isDetailPage) {
                        // Play from detail page: replace queue with playlist songs and play from index
                        const playlistSongs = this.currentDetailPlaylist?.songs || queue;
                        window.player.replaceQueue(playlistSongs);
                        window.player.playFromQueue(i);
                    } else {
                        window.player.playFromQueue(i);
                    }
                }
            });

            fragment.appendChild(div);
        });

        container.appendChild(fragment);

        if (!isHistory && !isDetailPage) {
            container.querySelectorAll('.remove-btn').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const idx = parseInt(btn.dataset.idx);
                    window.player.removeFromQueue(idx);
                };
            });
        }
    }

    // ========== 沉浸式播放页 ==========

    openImmersivePlayer() {
        this.els.immersivePlayer.classList.add('active');
        document.body.style.overflow = 'hidden';
        this.startRenderLoop();
    }

    closeImmersivePlayer() {
        this.els.immersivePlayer.classList.remove('active');
        document.body.style.overflow = '';
        this.stopRenderLoop();
    }

    renderLyrics(lyrics) {
        // Get toggle elements
        const toggleContainer = document.getElementById('lyrics-toggle-container');
        const toggleBtn = document.getElementById('lyrics-toggle-btn');
        const toggleLabel = document.getElementById('lyrics-toggle-label');

        // Reset toggle state
        this.showSubText = false;
        this.subTextType = 'trans'; // 'trans' or 'roma'
        toggleBtn?.classList.remove('active');

        if (!lyrics || !lyrics.lyric) {
            // Show "暂无歌词" as a single active lyric line
            this.els.lyricsScroll.innerHTML = '';
            const el = document.createElement('div');
            el.className = 'lyric-line active';
            el.textContent = '暂无歌词';
            el.style.transform = 'rotate(-6deg)';
            el.style.opacity = '1';
            el.style.visibility = 'visible';
            this.els.lyricsScroll.appendChild(el);
            this.currentLyrics = [];
            this.lyricElements = [];
            if (toggleContainer) toggleContainer.style.display = 'none';
            return;
        }

        // Parse lyrics
        const mainLines = this.parseLyrics(lyrics.lyric).filter(l => l.text);
        const transLines = lyrics.trans ? this.parseLyrics(lyrics.trans).filter(l => l.text) : [];
        const romaLines = lyrics.roma ? this.parseLyrics(lyrics.roma).filter(l => l.text) : [];

        // Store parsed trans/roma for lookup
        this.transMap = new Map(transLines.map(l => [l.time, l.text]));
        this.romaMap = new Map(romaLines.map(l => [l.time, l.text]));

        // Determine what's available
        const hasTrans = transLines.length > 0;
        const hasRoma = romaLines.length > 0;

        // Show/hide toggle button
        if (toggleContainer) {
            if (hasTrans || hasRoma) {
                toggleContainer.style.display = 'block';
                // Set default label based on availability
                if (hasTrans) {
                    this.subTextType = 'trans';
                    toggleLabel.textContent = '译';
                } else {
                    this.subTextType = 'roma';
                    toggleLabel.textContent = '音';
                }
            } else {
                toggleContainer.style.display = 'none';
            }
        }

        this.currentLyrics = mainLines;

        if (mainLines.length === 0) {
            this.els.lyricsScroll.innerHTML = '';
            const el = document.createElement('div');
            el.className = 'lyric-line active';
            el.textContent = '暂无歌词';
            el.style.transform = 'rotate(-6deg)';
            el.style.opacity = '1';
            el.style.visibility = 'visible';
            this.els.lyricsScroll.appendChild(el);
            this.lyricElements = [];
            if (toggleContainer) toggleContainer.style.display = 'none';
            return;
        }

        // Render lyric lines with sub-text
        const fragment = document.createDocumentFragment();
        mainLines.forEach((line, i) => {
            const el = document.createElement('div');
            el.className = 'lyric-line';
            el.dataset.time = line.time;
            el.dataset.index = i;

            // Main text
            const mainSpan = document.createElement('span');
            mainSpan.className = 'lyric-main';
            mainSpan.textContent = line.text;
            el.appendChild(mainSpan);

            // Sub text (trans or roma)
            const subSpan = document.createElement('div');
            subSpan.className = 'lyric-sub';
            // Get matching sub-text by time
            const transText = this.transMap.get(line.time) || '';
            const romaText = this.romaMap.get(line.time) || '';
            subSpan.dataset.trans = transText;
            subSpan.dataset.roma = romaText;
            subSpan.textContent = this.subTextType === 'trans' ? transText : romaText;
            el.appendChild(subSpan);

            fragment.appendChild(el);
        });

        this.els.lyricsScroll.innerHTML = '';
        this.els.lyricsScroll.appendChild(fragment);

        // Cache DOM elements
        this.lyricElements = Array.from(this.els.lyricsScroll.querySelectorAll('.lyric-line'));
        this.lineRenderIndices = null;

        this.lastHighlightIdx = -1;
        this.targetRenderIndex = 0;
        this.currentRenderIndex = 0;
    }

    parseLyrics(lyricText) {
        const lines = [];
        const regex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/g;
        let match;

        while ((match = regex.exec(lyricText)) !== null) {
            const minutes = parseInt(match[1]);
            const seconds = parseInt(match[2]);
            const ms = parseInt(match[3].padEnd(3, '0'));
            const time = minutes * 60 + seconds + ms / 1000;
            const text = match[4].trim();
            lines.push({ time, text });
        }

        return lines.sort((a, b) => a.time - b.time);
    }

    highlightLyric(currentTime) {
        // 如果没有歌词或元素，直接返回
        if (!this.lyricElements || this.lyricElements.length === 0) return;

        // 找到当前歌词行
        let activeIdx = -1;
        // 倒序查找（微优化）
        for (let i = this.currentLyrics.length - 1; i >= 0; i--) {
            if (currentTime >= this.currentLyrics[i].time) {
                activeIdx = i;
                break;
            }
        }

        // 只有当行发生变化时才更新 active 状态，减少 DOM 操作
        if (activeIdx !== this.lastHighlightIdx) {
            // 移除旧的高亮
            if (this.lastHighlightIdx >= 0 && this.lyricElements[this.lastHighlightIdx]) {
                this.lyricElements[this.lastHighlightIdx].classList.remove('active');
            }
            // 添加新的高亮
            if (activeIdx >= 0 && this.lyricElements[activeIdx]) {
                this.lyricElements[activeIdx].classList.add('active');
            }
            this.lastHighlightIdx = activeIdx;
        }

        // 设置目标渲染索引，渲染循环会负责平滑过渡
        if (!this.userScrolling) {
            this.targetRenderIndex = activeIdx !== -1 ? activeIdx : 0;
        }
    }

    startRenderLoop() {
        if (this.renderLoopId) return;
        const loop = () => {
            this.renderFrame();
            this.renderLoopId = requestAnimationFrame(loop);
        };
        this.renderLoopId = requestAnimationFrame(loop);
    }

    stopRenderLoop() {
        if (this.renderLoopId) {
            cancelAnimationFrame(this.renderLoopId);
            this.renderLoopId = null;
        }
    }

    // 初始化沉浸式播放页逻辑
    initImmersivePlayer() {
        this.updateImmersiveLayout();
        window.addEventListener('resize', () => {
            if (this.resizeTimeout) cancelAnimationFrame(this.resizeTimeout);
            this.resizeTimeout = requestAnimationFrame(() => this.updateImmersiveLayout());
        });
    }

    updateImmersiveLayout() {
        const h = window.innerHeight;
        // 动态半径：高度越高，半径越小
        let radius = 640000 / Math.max(400, h);
        radius = Math.max(400, Math.min(1200, radius));
        this.els.lyricsScroll.style.setProperty('--lyric-radius', `${radius}px`);

        const spacing = 80;
        this.currentAngleStep = (spacing / radius) * 57.2958;
    }

    renderFrame() {
        if (!this.lyricElements || this.lyricElements.length === 0) return;

        if (!this.userScrolling) {
            const diff = this.targetRenderIndex - this.currentRenderIndex;
            if (Math.abs(diff) > 0.001) {
                this.currentRenderIndex += diff * 0.1;
            } else {
                this.currentRenderIndex = this.targetRenderIndex;
            }
        }

        // 初始化每行的独立位置状态
        if (!this.lineRenderIndices || this.lineRenderIndices.length !== this.lyricElements.length) {
            this.lineRenderIndices = new Array(this.lyricElements.length).fill(this.currentRenderIndex);
        }

        const angleStep = this.currentAngleStep || 6;
        const bias = -1;
        const visibleRange = 25;
        const centerIndex = Math.floor(this.currentRenderIndex);

        for (let i = 0; i < this.lyricElements.length; i++) {
            // 目标位置：追随全局焦点
            const targetPos = this.currentRenderIndex;
            let currentPos = this.lineRenderIndices[i];

            // 计算视差滞后系数
            const visualOffset = i - targetPos;

            // 关键逻辑：加强版果冻效果
            // 顶部(offset<0)响应更快，底部(offset>0)拖尾更明显
            // 系数从 0.005 增加到 0.008，拉大差异
            let k = 0.20 - visualOffset * 0.03;

            // 降低下限到 0.02 (非常拖拽)，提高上限到 0.3 (非常灵敏)
            k = Math.max(0.002, Math.min(0.8, k));

            // 插值更新
            const diff = targetPos - currentPos;
            if (Math.abs(diff) > 0.001) {
                currentPos += diff * k;
            } else {
                currentPos = targetPos;
            }
            this.lineRenderIndices[i] = currentPos;

            // 使用该行独立的位置计算最终 offset
            const offset = i - currentPos + bias;
            if (Math.abs(offset) < visibleRange) {
                const el = this.lyricElements[i];
                const angle = offset * angleStep;
                const opacity = Math.max(0, 1 - Math.abs(offset) * 0.2);
                el.style.transform = `rotate(${angle}deg)`;
                el.style.opacity = opacity;
                if (el.style.visibility !== 'visible') el.style.visibility = 'visible';
            } else {
                if (this.lyricElements[i].style.visibility !== 'hidden') {
                    this.lyricElements[i].style.visibility = 'hidden';
                }
            }
        }
    }

    setUserScrolling(scrolling) {
        this.userScrolling = scrolling;
        if (scrolling) {
            clearTimeout(this.scrollTimeout);
            this.scrollTimeout = setTimeout(() => {
                this.userScrolling = false;
            }, 5000);
        }
    }
}

// Player Manager Class
class PlayerManager {
    constructor(ui) {
        this.ui = ui;
        this.audio = new Audio();
        this.queue = [];
        this.currentIndex = -1;
        this.playMode = 'sequence'; // sequence, repeat_one, shuffle

        this.urlCache = new Map();

        this.loadFromStorage();
        this.initAudio();

        // Debounce playSong to prevent lag during rapid switching
        this.playSongDebounced = this.debounce(this.playSong.bind(this), 300);
    }

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    loadFromStorage() {
        try {
            const savedQueue = localStorage.getItem('qqmusic_queue');
            if (savedQueue) {
                this.queue = JSON.parse(savedQueue);
                this.ui.renderPlaylist(this.queue, this.currentIndex);
            }

            const savedMode = localStorage.getItem('qqmusic_playmode');
            if (savedMode) {
                this.playMode = savedMode;
                this.updateModeUI();
            }
        } catch (e) {
            console.warn('Failed to load from storage:', e);
        }
    }

    saveQueue() {
        try {
            localStorage.setItem('qqmusic_queue', JSON.stringify(this.queue));
        } catch (e) {
            console.warn('Failed to save queue:', e);
        }
    }

    initAudio() {
        this.audio.onended = () => {
            if (this.playMode === 'repeat_one') {
                this.audio.currentTime = 0;
                this.audio.play();
            } else {
                this.next();
            }
        };

        this.audio.ontimeupdate = () => {
            this.ui.updateProgress(this.audio.currentTime, this.audio.duration);
        };

        this.audio.onplay = () => this.ui.setPlaying(true);
        this.audio.onpause = () => this.ui.setPlaying(false);

        // Media Session
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', () => this.play());
            navigator.mediaSession.setActionHandler('pause', () => this.pause());
            navigator.mediaSession.setActionHandler('previoustrack', () => this.prev());
            navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
        }
    }

    async playSong(song) {
        // Track the song we are trying to load
        this.loadingMid = song.mid;

        try {
            this.ui.updateSongInfo(song);

            // Add to history
            if (window.historyManager) {
                window.historyManager.add(song);
            }

            // Get playURL
            const preferFlac = document.getElementById('quality-value')?.value === 'flac';
            const result = await getSongUrlWithFallback(song.mid, preferFlac);

            // Race condition check
            if (this.loadingMid !== song.mid) {
                console.log(`Playback cancelled for ${song.name} (race condition)`);
                return;
            }

            if (!result.url) {
                console.warn('无法获取播放链接');
                return;
            }

            // Set src and play
            this.audio.src = result.url;

            try {
                await this.audio.play();
            } catch (playError) {
                if (playError.name === 'AbortError') {
                    console.log('Playback interrupted by new request');
                    return;
                }
                throw playError;
            }

        } catch (error) {
            console.error('Play song failed:', error);
            if (error.name !== 'AbortError') {
                console.error('播放失败:', error.message);
            }
        } finally {
            if (this.loadingMid === song.mid) {
                this.loadingMid = null;
            }
        }
    }

    play() {
        if (this.audio.src) {
            this.audio.play();
        } else if (this.queue.length > 0) {
            this.playFromQueue(0);
        }
    }

    pause() {
        this.audio.pause();
    }

    togglePlay() {
        if (this.audio.paused) {
            this.play();
        } else {
            this.pause();
        }
    }

    seek(time) {
        this.audio.currentTime = time;
    }

    addToQueue(song, silent = false) {
        // 检查是否已存在相同歌曲
        const existingIndex = this.queue.findIndex(s => s.mid === song.mid);
        if (existingIndex !== -1) {
            this.queue.splice(existingIndex, 1);
            if (existingIndex < this.currentIndex) {
                this.currentIndex--;
            } else if (existingIndex === this.currentIndex) {
                this.currentIndex = -1;
            }
        }

        this.queue.push(song);
        this.saveQueue();
        this.ui.renderPlaylist(this.queue, this.currentIndex);
        if (!silent) {
            this.ui.notify(`已添加: ${song.name}`);
        }
    }

    addNext(song) {
        // 检查是否已存在
        const existingIndex = this.queue.findIndex(s => s.mid === song.mid);
        if (existingIndex !== -1) {
            this.queue.splice(existingIndex, 1);
            if (existingIndex < this.currentIndex) {
                this.currentIndex--;
            }
        }

        if (this.currentIndex === -1) {
            this.queue.push(song);
            this.currentIndex = 0; // 如果是第一首，不自动播？
        } else {
            this.queue.splice(this.currentIndex + 1, 0, song);
        }

        this.saveQueue();
        this.ui.renderPlaylist(this.queue, this.currentIndex);
        this.ui.notify(`下一首播放: ${song.name}`);
    }

    saveQueue() {
        localStorage.setItem('qqmusic_queue', JSON.stringify(this.queue));
    }

    replaceQueue(newQueue) {
        this.queue = newQueue;
        this.currentIndex = 0;
        this.saveQueue();
        this.ui.renderPlaylist(this.queue, this.currentIndex);
        this.playFromQueue(0);
        this.ui.notify(`已播放歌单，共 ${newQueue.length} 首`);
    }

    playFromQueue(index) {
        if (index < 0 || index >= this.queue.length) return;
        this.currentIndex = index;
        localStorage.setItem('qqmusic_currentIndex', index.toString());

        const song = this.queue[index];
        this.ui.updateSongInfo(song);
        this.ui.renderPlaylist(this.queue, this.currentIndex);

        this.playSongDebounced(song);
    }

    removeFromQueue(index) {
        if (index < 0 || index >= this.queue.length) return;

        this.queue.splice(index, 1);

        if (index < this.currentIndex) {
            this.currentIndex--;
        } else if (index === this.currentIndex) {
            this.pause();
            this.currentIndex = -1;
        }

        this.saveQueue();
        this.ui.renderPlaylist(this.queue, this.currentIndex);
    }

    clearQueue() {
        this.queue = [];
        this.currentIndex = -1;
        this.pause();
        this.saveQueue();
        this.ui.renderPlaylist(this.queue, this.currentIndex);
    }

    next() {
        if (this.queue.length === 0) return;

        let nextIndex;
        if (this.playMode === 'shuffle') {
            nextIndex = Math.floor(Math.random() * this.queue.length);
        } else {
            nextIndex = (this.currentIndex + 1) % this.queue.length;
        }

        this.playFromQueue(nextIndex);
    }

    prev() {
        if (this.queue.length === 0) return;

        let prevIndex;
        if (this.playMode === 'shuffle') {
            prevIndex = Math.floor(Math.random() * this.queue.length);
        } else {
            prevIndex = (this.currentIndex - 1 + this.queue.length) % this.queue.length;
        }

        this.playFromQueue(prevIndex);
    }

    toggleMode() {
        const modes = ['sequence', 'repeat_one', 'shuffle'];
        const currentIdx = modes.indexOf(this.playMode);
        this.playMode = modes[(currentIdx + 1) % modes.length];

        localStorage.setItem('qqmusic_playmode', this.playMode);
        this.updateModeUI();

        const modeNames = { sequence: '顺序播放', repeat_one: '单曲循环', shuffle: '随机播放' };
        console.log(`播放模式: ${modeNames[this.playMode]}`);
    }

    updateModeUI() {
        const modeBtn = document.getElementById('mode-btn');
        if (!modeBtn) return;

        switch (this.playMode) {
            case 'sequence':
                modeBtn.innerHTML = '<i class="fas fa-repeat"></i>';
                modeBtn.title = '顺序播放';
                break;
            case 'repeat_one':
                modeBtn.innerHTML = '<i class="fas fa-repeat"></i><span style="font-size:10px;position:absolute;">1</span>';
                modeBtn.title = '单曲循环';
                break;
            case 'shuffle':
                modeBtn.innerHTML = '<i class="fas fa-shuffle"></i>';
                modeBtn.title = '随机播放';
                break;
        }
    }
}

// Search Manager Class
class SearchManager {
    constructor(ui) {
        this.ui = ui;
        this.currentKeyword = '';
        this.currentPage = 1;
        this.isLoading = false;
        this.hasMore = true;
        this.perPage = 60;

        this.setupInfiniteScroll();
    }

    setupInfiniteScroll() {
        // 监听主内容区滚动
        const mainContent = document.querySelector('.main-content');
        if (mainContent) {
            mainContent.addEventListener('scroll', () => {
                // 只在搜索页面激活时触发
                if (!this.ui.els.searchPage.classList.contains('active')) return;
                if (this.isLoading || !this.hasMore || !this.currentKeyword) return;

                const { scrollTop, scrollHeight, clientHeight } = mainContent;
                // 距离底部100px时开始加载
                if (scrollTop + clientHeight >= scrollHeight - 100) {
                    this.loadMore();
                }
            });
        }
    }

    formatDuration(seconds) {
        if (!seconds || isNaN(seconds)) return '';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    async search(keyword, page = 1, append = false) {
        if (!keyword.trim()) {
            this.ui.els.resultsList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-music"></i>
                    <p>输入关键词开始搜索</p>
                </div>
            `;
            this.ui.els.pagination.style.display = 'none';
            return;
        }

        // 新搜索时重置状态
        if (!append) {
            this.currentKeyword = keyword;
            this.currentPage = 1;
            this.hasMore = true;
            this.ui.els.resultsList.innerHTML = '';
            this.ui.els.loadingSpinner.style.display = 'flex';
        } else {
            // 追加加载时，在列表底部显示加载提示
            this.showLoadingMore();
        }

        this.isLoading = true;

        try {
            const results = await searchByType(keyword, this.perPage, page);

            this.hideLoadingMore();
            if (!append) {
                this.ui.els.loadingSpinner.style.display = 'none';
            }
            this.isLoading = false;

            if (!results || results.length === 0) {
                if (!append) {
                    this.ui.els.resultsList.innerHTML = '<div class="empty-state"><p>未找到结果</p></div>';
                }
                this.hasMore = false;
                return;
            }

            // 如果返回数量小于请求数量，说明没有更多了
            if (results.length < this.perPage) {
                this.hasMore = false;
            }

            this.currentPage = page;
            this.renderResults(results, append);
            this.ui.els.pagination.style.display = 'none'; // 隐藏分页，使用无限滚动

        } catch (error) {
            console.error('Search failed:', error);
            this.hideLoadingMore();
            if (!append) {
                this.ui.els.loadingSpinner.style.display = 'none';
            }
            this.isLoading = false;
        }
    }

    showLoadingMore() {
        // 移除已有的加载提示
        this.hideLoadingMore();
        const loader = document.createElement('div');
        loader.className = 'loading-more';
        loader.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>正在加载...</span>';
        this.ui.els.resultsList.appendChild(loader);
    }

    hideLoadingMore() {
        const loader = this.ui.els.resultsList.querySelector('.loading-more');
        if (loader) loader.remove();
    }

    loadMore() {
        if (this.isLoading || !this.hasMore) return;
        this.search(this.currentKeyword, this.currentPage + 1, true);
    }

    renderResults(results, append = false) {
        if (!append) {
            this.ui.els.resultsList.innerHTML = '';
        }

        results.forEach(song => {
            const singers = song.singer?.map(s => s.name).join(', ') || '';
            const coverCandidates = getCoverCandidates({ album_mid: song.album?.mid, vs: song.vs }, 300);
            const albumName = song.album?.name || '';
            const duration = song.interval ? this.formatDuration(song.interval) : '';

            const item = document.createElement('div');
            item.className = 'song-item';
            item.innerHTML = `
                <div class="item-cover">
                    <img src="${coverCandidates[0]}" loading="lazy" data-cover-index="0">
                </div>
                <div class="item-info">
                    <div class="item-title">${song.title || song.name}</div>
                    <div class="item-artist">${singers}</div>
                </div>
                <div class="item-extra">
                    ${albumName ? `<span class="item-album">${albumName}</span>` : ''}
                    ${duration ? `<span class="item-duration">${duration}</span>` : ''}
                </div>
                <div class="item-actions">
                    <button class="action-btn add-action" title="添加到列表">
                        <i class="fas fa-plus"></i>
                    </button>
                </div>
            `;

            // 添加图片加载失败时的回退处理
            const img = item.querySelector('img');
            img._coverCandidates = coverCandidates;
            img.onerror = function () {
                const currentIndex = parseInt(this.dataset.coverIndex) || 0;
                const nextIndex = currentIndex + 1;
                if (nextIndex < this._coverCandidates.length) {
                    this.dataset.coverIndex = nextIndex;
                    this.src = this._coverCandidates[nextIndex];
                }
            };

            const songData = {
                mid: song.mid,
                name: song.title || song.name,
                singers: singers,
                album: song.album?.name || '',
                album_mid: song.album?.mid || '',
                vs: song.vs || [],
                interval: song.interval || 0
            };

            // 点击整行播放（静默添加，不显示提示）
            item.onclick = () => {
                window.player.addToQueue(songData, true);
                window.player.playFromQueue(window.player.queue.length - 1);
            };

            // 点击+改为下一首播放
            item.querySelector('.add-action').onclick = (e) => {
                e.stopPropagation();
                window.player.addNext(songData);
            };

            this.ui.els.resultsList.appendChild(item);
        });
    }

    updatePagination() {
        // 不再使用分页，改用无限滚动
        this.ui.els.pagination.style.display = 'none';
    }

    nextPage() {
        this.loadMore();
    }

    prevPage() {
        // 无限滚动模式下不需要
    }
}

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
    // Check credential
    const credential = getCredential();
    console.log('Credential loaded:', credential.isValid() ? 'Valid' : 'Invalid');

    // Initialize managers
    const ui = new UIManager();
    const historyManager = new HistoryManager(ui);
    const savedPlaylistManager = new SavedPlaylistManager(ui);

    // Attach to window
    window.historyManager = historyManager;
    window.savedPlaylistManager = savedPlaylistManager;

    const player = new PlayerManager(ui);
    const search = new SearchManager(ui);

    // Make player globally accessible
    window.player = player;

    // Event Listeners - Controls
    document.getElementById('play-btn').onclick = () => player.togglePlay();
    document.getElementById('prev-btn').onclick = () => player.prev();
    document.getElementById('next-btn').onclick = () => player.next();
    document.getElementById('mode-btn').onclick = () => player.toggleMode();

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ignore if typing in input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        switch (e.code) {
            case 'Space':
                e.preventDefault();
                player.togglePlay();
                break;
            case 'ArrowLeft':
                if (e.ctrlKey || e.metaKey) {
                    player.prev();
                } else {
                    // Seek backward 5s
                    player.seek(Math.max(0, player.audio.currentTime - 5));
                }
                break;
            case 'ArrowRight':
                if (e.ctrlKey || e.metaKey) {
                    player.next();
                } else {
                    // Seek forward 5s
                    player.seek(Math.min(player.audio.duration || 0, player.audio.currentTime + 5));
                }
                break;
            case 'ArrowUp':
                e.preventDefault();
                player.audio.volume = Math.min(1, player.audio.volume + 0.1);
                break;
            case 'ArrowDown':
                e.preventDefault();
                player.audio.volume = Math.max(0, player.audio.volume - 0.1);
                break;
            case 'KeyM':
                player.audio.muted = !player.audio.muted;
                break;
        }
    });

    // Quality toggle
    document.getElementById('quality-toggle').onclick = () => {
        const qualityValue = document.getElementById('quality-value');
        const qualityLabel = document.getElementById('quality-label');

        if (qualityValue.value === 'flac') {
            qualityValue.value = 'mp3';
            qualityLabel.textContent = 'MP3';
        } else {
            qualityValue.value = 'flac';
            qualityLabel.textContent = 'FLAC';
        }
    };

    // Progress bar seek
    ui.els.progressBar.onclick = (e) => {
        const rect = ui.els.progressBar.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        player.seek(player.audio.duration * percent);
    };

    // Search
    const searchInput = document.getElementById('search-input');

    searchInput.oninput = (e) => {
        const keyword = e.target.value;
        document.getElementById('search-clear').style.display = keyword ? 'block' : 'none';
    };

    searchInput.onkeypress = (e) => {
        if (e.key === 'Enter') {
            search.search(e.target.value);
        }
    };

    document.getElementById('search-clear').onclick = () => {
        searchInput.value = '';
        document.getElementById('search-clear').style.display = 'none';
        ui.els.resultsList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-music"></i>
                <p>输入关键词开始搜索</p>
            </div>
        `;
    };

    document.getElementById('prev-page').onclick = () => search.prevPage();
    document.getElementById('next-page').onclick = () => search.nextPage();

    // Playlist controls
    const modal = document.getElementById('import-modal');
    /*
    document.getElementById('import-playlist-btn').onclick = () => {
        const id = prompt('请输入QQ音乐歌单ID (数字):');
        if (id) {
            savedPlaylistManager.importPlaylist(id);
        }
    };
    */

    // Modal Logic
    document.getElementById('import-playlist-btn').onclick = () => {
        modal.classList.add('active');
    };

    document.getElementById('import-modal-close').onclick = () => {
        modal.classList.remove('active');
    };

    modal.onclick = (e) => {
        if (e.target === modal) modal.classList.remove('active');
    };

    // Detail Page Back
    document.getElementById('detail-back-btn').onclick = () => {
        ui.switchPage('playlist');
    };





    // Bulk Import Logic
    document.getElementById('fetch-user-playlists').onclick = async () => {
        const input = document.getElementById('import-uid-input');
        const uin = input.value.trim();
        if (!uin) return;

        const container = document.getElementById('import-list-container');
        const actionArea = document.getElementById('bulk-import-actions');

        container.innerHTML = '<div class="loading-state"><i class="fas fa-spinner fa-spin"></i><span>获取中...</span></div>';

        try {
            let playlists = await getUserSongLists(uin);

            // Filter out "I Like" playlist (dirId 201)
            playlists = playlists.filter(p => p.dirId !== 201);

            if (playlists.length === 0) {
                container.innerHTML = '<div class="empty-hint">该用户没有公开的歌单</div>';
                actionArea.style.display = 'none';
                return;
            }

            container.innerHTML = '';

            // Store globally for lookup
            window.currentImportList = playlists;

            // Render list
            playlists.forEach((p, index) => {
                const div = document.createElement('div');
                div.className = 'select-item';
                div.dataset.index = index; // Use index to lookup

                // Cover Priority: bigpicUrl > picUrl > dirPic > pic > cover > default
                // Ensure HTTPS
                let coverUrl = p.bigpicUrl || p.picUrl || p.dirPic || p.pic || p.cover || '';
                if (coverUrl) {
                    coverUrl = coverUrl.replace(/^http:\/\//, 'https://');
                } else {
                    coverUrl = 'https://y.gtimg.cn/mediastyle/global/img/playlist_300.png';
                }

                // Update object for later import
                p.cover = coverUrl;

                div.innerHTML = `
                    <div class="selection-check"></div>
                    <img src="${coverUrl}" loading="lazy" onerror="this.src='https://y.gtimg.cn/mediastyle/global/img/playlist_300.png'">
                    <div class="select-info">
                        <div class="select-title" title="${p.dirName}">${p.dirName}</div>
                        <div class="select-count">${p.songNum}首</div>
                    </div>
                `;

                div.onclick = () => {
                    div.classList.toggle('selected');
                    updateSelectedCount();
                };

                container.appendChild(div);
            });

            actionArea.style.display = 'flex';
            updateSelectedCount();

        } catch (e) {
            container.innerHTML = `<div class="empty-hint" style="color:#ff4444">获取失败: ${e.message}</div>`;
        }
    };

    function updateSelectedCount() {
        const count = document.querySelectorAll('.select-item.selected').length;
        document.getElementById('selected-count').textContent = count;
    }

    document.getElementById('import-selected-confirm').onclick = async () => {
        const selected = document.querySelectorAll('.select-item.selected');

        const selectedPlaylists = Array.from(selected).map(el => {
            const index = parseInt(el.dataset.index);
            return window.currentImportList[index];
        });

        if (selectedPlaylists.length > 0) {
            const success = await savedPlaylistManager.importPlaylists(selectedPlaylists);
            if (success) {
                modal.classList.remove('active');
                // Reset Selection
                document.getElementById('import-list-container').innerHTML = '<div class="empty-hint">请输入QQ号并点击获取</div>';
                document.getElementById('bulk-import-actions').style.display = 'none';
            }
        } else {
            ui.notify('请至少选择一个歌单', 'info');
        }
    };

    document.getElementById('clear-queue-btn').onclick = (e) => {
        e.stopPropagation();
        if (confirm('确定要清空播放列表吗？')) {
            player.clearQueue();
        }
    };

    document.getElementById('clear-history').onclick = () => {
        if (confirm('确定要清空历史记录吗？')) {
            historyManager.clear();
        }
    };

    // ========== 沉浸式播放页事件 ==========

    // 点击控制栏封面/标题区域打开沉浸式播放页
    ui.els.nowPlaying.onclick = () => {
        if (player.queue.length > 0 && player.currentIndex >= 0) {
            const currentSong = player.queue[player.currentIndex];
            ui.openImmersivePlayer();

            // 加载歌词
            loadLyricsForSong(currentSong.mid);
        }
    };

    // 关闭按钮
    ui.els.immersiveClose.onclick = () => {
        ui.closeImmersivePlayer();
    };

    ui.els.immersivePrev.onclick = () => {
        player.prev();
    };

    ui.els.immersiveNext.onclick = () => {
        player.next();
    };

    // Lyrics toggle button
    document.getElementById('lyrics-toggle-btn').onclick = () => {
        const toggleBtn = document.getElementById('lyrics-toggle-btn');
        const toggleLabel = document.getElementById('lyrics-toggle-label');
        const subElements = document.querySelectorAll('.lyric-sub');

        ui.showSubText = !ui.showSubText;
        toggleBtn.classList.toggle('active', ui.showSubText);

        // Toggle all lyric lines
        document.querySelectorAll('.lyric-line').forEach(el => {
            el.classList.toggle('show-sub', ui.showSubText);
        });

        // Cycle through modes: off -> trans -> roma -> off (if both available)
        if (ui.showSubText && ui.transMap?.size > 0 && ui.romaMap?.size > 0) {
            // If turning on, check if we should switch type
            if (ui.subTextType === 'trans') {
                toggleLabel.textContent = '译';
            } else {
                toggleLabel.textContent = '音';
            }
        }
    };

    // Double click toggle to switch between trans/roma
    document.getElementById('lyrics-toggle-btn').ondblclick = () => {
        const toggleLabel = document.getElementById('lyrics-toggle-label');
        const hasTrans = ui.transMap?.size > 0;
        const hasRoma = ui.romaMap?.size > 0;

        if (hasTrans && hasRoma) {
            // Switch type
            ui.subTextType = ui.subTextType === 'trans' ? 'roma' : 'trans';
            toggleLabel.textContent = ui.subTextType === 'trans' ? '译' : '音';

            // Update sub-text content
            document.querySelectorAll('.lyric-sub').forEach(el => {
                el.textContent = ui.subTextType === 'trans' ? el.dataset.trans : el.dataset.roma;
            });
        }
    };

    // 歌词点击跳转
    ui.els.lyricsScroll.onclick = (e) => {
        const lyricLine = e.target.closest('.lyric-line');
        if (lyricLine) {
            const time = parseFloat(lyricLine.dataset.time);
            if (!isNaN(time)) {
                player.seek(time);
                ui.userScrolling = false; // 点击歌词后恢复自动滚动
            }
        }
    };

    // 歌词滚动事件 - 用户手动滚动
    ui.els.lyricsScroll.addEventListener('wheel', (e) => {
        e.preventDefault();
        ui.setUserScrolling(true);
        // 调整灵敏度
        const delta = e.deltaY * 0.005;
        if (ui.currentRenderIndex !== undefined) {
            ui.currentRenderIndex = Math.max(0, Math.min(ui.currentLyrics.length - 1, ui.currentRenderIndex + delta));
            // renderLoop will handle the rendering
        }
    });

    let touchStartY = 0;
    ui.els.lyricsScroll.addEventListener('touchstart', (e) => {
        touchStartY = e.touches[0].clientY;
        ui.setUserScrolling(true);
    });

    ui.els.lyricsScroll.addEventListener('touchmove', (e) => {
        e.preventDefault(); // 防止默认滚动
        ui.setUserScrolling(true);
        const touchY = e.touches[0].clientY;
        const deltaY = touchStartY - touchY;
        touchStartY = touchY;

        // 触摸灵敏度
        const delta = deltaY * 0.02;
        if (ui.currentRenderIndex !== undefined) {
            ui.currentRenderIndex = Math.max(0, Math.min(ui.currentLyrics.length - 1, ui.currentRenderIndex + delta));
            // renderLoop will handle the rendering
        }
    });

    // 歌词加载函数
    async function loadLyricsForSong(mid) {
        try {
            const lyrics = await getLyric(mid);
            ui.renderLyrics(lyrics);
        } catch (e) {
            console.error('Failed to load lyrics:', e);
            ui.renderLyrics(null);
        }
    }

    // 歌曲切换时重新加载歌词
    player.audio.addEventListener('loadstart', () => {
        if (ui.els.immersivePlayer.classList.contains('active')) {
            if (player.currentIndex >= 0 && player.queue[player.currentIndex]) {
                const song = player.queue[player.currentIndex];
                loadLyricsForSong(song.mid);
            }
        }
    });

    // 播放进度更新歌词高亮
    player.audio.addEventListener('timeupdate', () => {
        ui.highlightLyric(player.audio.currentTime);
    });

    // Check for expired credential
    try {
        const isExpired = await checkExpired();
        if (isExpired) {
            console.log('Credential expired, attempting refresh...');
            const refreshed = await refreshCredential();
            if (refreshed) {
                ui.notify('凭证已刷新');
            } else {
                ui.notify('凭证已过期', 'error');
            }
        }
    } catch (e) {
        console.warn('Credential check failed:', e);
    }

    console.log('QQ Music Web Player initialized');
});
