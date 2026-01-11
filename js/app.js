/**
 * QQ Music Web Player - Main Application
 * Pure Frontend Implementation
 */

import { searchByType } from './api/search.js';
import { getSongUrlWithFallback } from './api/song.js';
import { getLyric } from './api/lyric.js';
import { getCredential, updateCredential } from './api/credential.js';
import { checkExpired, refreshCredential } from './api/login.js';

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

// UI Manager Class
class UIManager {
    constructor() {
        this.els = {
            // Background
            bgLayer1: document.getElementById('bg-layer-1'),
            bgLayer2: document.getElementById('bg-layer-2'),

            // Song info
            albumCover: document.getElementById('current-cover'),
            title: document.getElementById('current-title'),
            artist: document.getElementById('current-artist'),
            titleMini: document.getElementById('title-mini'),
            artistMini: document.getElementById('artist-mini'),

            // Controls
            playBtn: document.getElementById('play-btn'),
            currentTime: document.getElementById('current-time'),
            totalTime: document.getElementById('total-time'),
            progressFill: document.getElementById('progress-fill'),
            progressBar: document.getElementById('progress-bar'),

            // Views
            coverView: document.getElementById('cover-view'),
            lyricsView: document.getElementById('lyrics-view'),
            lyricsScroll: document.getElementById('lyrics-scroll'),

            // Drawers
            searchDrawer: document.getElementById('search-drawer'),
            playlistDrawer: document.getElementById('playlist-drawer'),
            drawerOverlay: document.getElementById('drawer-overlay'),

            // Search
            searchInput: document.getElementById('search-input'),
            resultsList: document.getElementById('results-list'),
            loadingSpinner: document.getElementById('loading-spinner'),
            pagination: document.getElementById('pagination'),
            pageInfo: document.getElementById('page-info'),

            // Playlist
            playlistList: document.getElementById('playlist-list'),

            // Notifications
            notificationContainer: document.getElementById('notification-container')
        };

        this.activeBgLayer = 1;
        this.currentLyrics = [];
        this.lastHighlightIdx = -1;
        this.userScrolling = false;

        this.setupLyricsScrollListener();
    }

    setupLyricsScrollListener() {
        const resetScrolling = debounce(() => {
            this.userScrolling = false;
        }, 3000);

        const onUserInteract = () => {
            this.userScrolling = true;
            resetScrolling();
        };

        this.els.lyricsScroll.addEventListener('touchstart', onUserInteract, { passive: true });
        this.els.lyricsScroll.addEventListener('touchmove', onUserInteract, { passive: true });
        this.els.lyricsScroll.addEventListener('wheel', onUserInteract, { passive: true });
    }

    notify(msg, type = 'success') {
        this.els.notificationContainer.innerHTML = '';

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
            <span>${msg}</span>
        `;
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
    }

    updateProgress(curr, total) {
        if (!total) return;
        this.els.currentTime.textContent = formatTime(curr);
        this.els.totalTime.textContent = formatTime(total);
        this.els.progressFill.style.width = `${(curr / total) * 100}%`;
    }

    updateSongInfo(song) {
        const textEls = [this.els.title, this.els.artist, this.els.titleMini, this.els.artistMini, this.els.albumCover];
        textEls.forEach(el => el?.classList.add('fade-out'));

        setTimeout(() => {
            this.els.title.textContent = song.name;
            this.els.artist.textContent = song.singers;
            if (this.els.titleMini) this.els.titleMini.textContent = song.name;
            if (this.els.artistMini) this.els.artistMini.textContent = song.singers;

            [this.els.title, this.els.artist, this.els.titleMini, this.els.artistMini].forEach(el => el?.classList.remove('fade-out'));

            // Update cover
            const coverUrl = song.album_mid
                ? `https://y.gtimg.cn/music/photo_new/T002R800x800M000${song.album_mid}.jpg`
                : 'https://y.gtimg.cn/music/photo_new/T002R800x800M000003y8dsH2wBHlo_1.jpg';

            this.els.albumCover.src = coverUrl;
            this.els.albumCover.onload = () => this.els.albumCover.classList.remove('fade-out');
            setTimeout(() => this.els.albumCover.classList.remove('fade-out'), 100);

            // Update Media Session
            if ('mediaSession' in navigator) {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: song.name,
                    artist: song.singers,
                    album: song.album || '',
                    artwork: [
                        { src: coverUrl.replace('R800x800', 'R300x300'), sizes: '300x300', type: 'image/jpeg' },
                        { src: coverUrl, sizes: '800x800', type: 'image/jpeg' }
                    ]
                });
            }
        }, 300);
    }

    // 背景已隐藏，不再需要 setBackground 方法

    renderLyrics(lyricsData) {
        this.els.lyricsScroll.classList.add('fade-out');
        setTimeout(() => {
            this._doRenderLyrics(lyricsData);
            this.els.lyricsScroll.classList.remove('fade-out');
        }, 300);
    }

    _doRenderLyrics(lyricsData) {
        this.currentLyrics = [];
        this.els.lyricsScroll.innerHTML = '';

        const parse = (text) => {
            if (!text) return [];
            const lines = text.split('\n');
            const res = [];
            const re = /\[(\d+):(\d+)\.(\d+)\]/;

            lines.forEach(l => {
                const m = l.match(re);
                if (m) {
                    const min = parseInt(m[1]);
                    const sec = parseInt(m[2]);
                    const msStr = m[3];
                    const ms = parseInt(msStr) / Math.pow(10, msStr.length);
                    const t = min * 60 + sec + ms;
                    const txt = l.replace(re, '').trim();
                    if (txt) res.push({ t, txt });
                }
            });
            return res;
        };

        if (lyricsData?.lyric) {
            this.currentLyrics = parse(lyricsData.lyric);
        }

        if (this.currentLyrics.length === 0) {
            this.els.lyricsScroll.innerHTML = '<div class="empty-state"><i class="fas fa-music"></i><p>暂无歌词</p></div>';
            return;
        }

        this.currentLyrics.forEach((l, i) => {
            const row = document.createElement('div');
            row.className = 'lrc-line';
            row.textContent = l.txt;
            row.onclick = (e) => {
                e.stopPropagation();
                if (window.player) window.player.seek(l.t);
            };
            this.els.lyricsScroll.appendChild(row);
        });
    }

    highlightLyric(time) {
        if (!this.currentLyrics.length) return;

        let idx = -1;
        for (let i = 0; i < this.currentLyrics.length; i++) {
            if (time >= this.currentLyrics[i].t) idx = i;
            else break;
        }

        if (idx !== -1 && idx !== this.lastHighlightIdx) {
            this.lastHighlightIdx = idx;

            const rows = this.els.lyricsScroll.children;
            const active = this.els.lyricsScroll.querySelector('.active');
            if (active) active.classList.remove('active');

            const curr = rows[idx];
            if (curr && !curr.classList.contains('empty-state')) {
                curr.classList.add('active');

                if (this.els.lyricsScroll && !this.userScrolling) {
                    const containerHeight = this.els.lyricsScroll.clientHeight;
                    const lineHeight = curr.offsetHeight;
                    const targetScroll = curr.offsetTop - containerHeight / 2 + lineHeight / 2;

                    this.els.lyricsScroll.scrollTo({
                        top: targetScroll,
                        behavior: 'smooth'
                    });
                }
            }
        }
    }

    renderPlaylist(queue, currentIndex) {
        if (!this.els.playlistList) return;

        if (queue.length === 0) {
            this.els.playlistList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-music"></i>
                    <p>播放列表为空</p>
                    <p style="font-size: 12px; opacity: 0.6;">搜索歌曲并点击"+"添加</p>
                </div>
            `;
            return;
        }

        this.els.playlistList.innerHTML = '';

        queue.forEach((song, i) => {
            const cover = song.album_mid
                ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${song.album_mid}.jpg`
                : 'https://y.gtimg.cn/music/photo_new/T002R300x300M000003y8dsH2wBHlo_1.jpg';

            const div = document.createElement('div');
            div.className = `playlist-item ${i === currentIndex ? 'playing' : ''}`;
            div.innerHTML = `
                <img src="${cover}" class="item-cover" loading="lazy">
                <div class="item-info">
                    <div class="item-title">${song.name}</div>
                    <div class="item-artist">${song.singers}</div>
                </div>
                <button class="remove-btn" data-idx="${i}"><i class="fas fa-times"></i></button>
            `;

            div.addEventListener('click', (e) => {
                if (!e.target.closest('.remove-btn')) {
                    window.player.playFromQueue(i);
                }
            });

            this.els.playlistList.appendChild(div);
        });

        this.els.playlistList.querySelectorAll('.remove-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.idx);
                window.player.removeFromQueue(idx);
            };
        });
    }

    openDrawer(type) {
        if (type === 'search') {
            this.els.searchDrawer.classList.add('open');
        } else if (type === 'playlist') {
            this.els.playlistDrawer.classList.add('open');
        }
        this.els.drawerOverlay.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    closeDrawer() {
        this.els.searchDrawer.classList.remove('open');
        this.els.playlistDrawer.classList.remove('open');
        this.els.drawerOverlay.classList.remove('show');
        document.body.style.overflow = '';
    }

    toggleView() {
        this.els.coverView.classList.toggle('active');
        this.els.lyricsView.classList.toggle('active');
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
        this.lyricsCache = new Map();

        this.loadFromStorage();
        this.initAudio();
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

            // 不再自动恢复歌曲显示，等用户手动播放
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
            this.ui.highlightLyric(this.audio.currentTime);
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

            // Get playURL
            const preferFlac = document.getElementById('quality-value')?.value === 'flac';
            const result = await getSongUrlWithFallback(song.mid, preferFlac);

            // Race condition check: If loadingMid changed while we were waiting, abort
            if (this.loadingMid !== song.mid) {
                console.log(`Playback cancelled for ${song.name} (race condition)`);
                return;
            }

            if (!result.url) {
                this.ui.notify('无法获取播放链接', 'error');
                return;
            }

            // Set src and play
            this.audio.src = result.url;

            try {
                await this.audio.play();
            } catch (playError) {
                // Ignore AbortError which happens when switching songs properly
                if (playError.name === 'AbortError') {
                    console.log('Playback interrupted by new request (normal behavior)');
                    return;
                }
                throw playError;
            }

            // Load lyrics (only if we are still playing this song)
            if (this.loadingMid === song.mid) {
                this.loadLyrics(song.mid);
            }

        } catch (error) {
            console.error('Play song failed:', error);
            // Don't notify for AbortError at top level just in case
            if (error.name !== 'AbortError') {
                this.ui.notify('播放失败: ' + error.message, 'error');
            }
        } finally {
            // Clear loading state if this was the active load
            if (this.loadingMid === song.mid) {
                this.loadingMid = null;
            }
        }

        // Prefetch next song lyrics (fire and forget)
        this.prefetchNextSong();
    }

    async prefetchNextSong() {
        if (this.queue.length <= 1) return;

        let nextIndex;
        if (this.playMode === 'shuffle') {
            nextIndex = (this.currentIndex + 1) % this.queue.length;
        } else {
            nextIndex = (this.currentIndex + 1) % this.queue.length;
        }

        const nextSong = this.queue[nextIndex];
        if (nextSong && nextSong.mid && !this.lyricsCache.has(nextSong.mid)) {
            try {
                // Background fetch
                getLyric(nextSong.mid).then(lyrics => {
                    if (lyrics && (lyrics.lyric || lyrics.trans || lyrics.roma)) {
                        this.lyricsCache.set(nextSong.mid, lyrics);
                    }
                });
            } catch (e) {
                // Ignore prefetch errors
            }
        }
    }

    async loadLyrics(mid) {
        try {
            if (this.lyricsCache.has(mid)) {
                this.ui.renderLyrics(this.lyricsCache.get(mid));
                return;
            }

            const lyrics = await getLyric(mid);
            // Check if we are still playing the song we requested lyrics for
            // We use currentIndex to check strictly, or just check recent request
            this.lyricsCache.set(mid, lyrics);

            // Only render if currently playing/loading this URL
            // (Simpler check: just render, user might have switched but seeing lyrics is ok-ish,
            // but better to check)
            if (this.ui.els.titleMini && this.ui.els.titleMini.textContent) {
                // Optimization: Could check if current song matches mid
                this.ui.renderLyrics(lyrics);
            }
        } catch (error) {
            console.error('Load lyrics failed:', error);
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

    addToQueue(song) {
        // 检查是否已存在相同歌曲，如果存在则删除旧的
        const existingIndex = this.queue.findIndex(s => s.mid === song.mid);
        if (existingIndex !== -1) {
            this.queue.splice(existingIndex, 1);
            // 调整当前播放索引
            if (existingIndex < this.currentIndex) {
                this.currentIndex--;
            } else if (existingIndex === this.currentIndex) {
                this.currentIndex = -1;
            }
        }

        this.queue.push(song);
        this.saveQueue();
        this.ui.renderPlaylist(this.queue, this.currentIndex);
        this.ui.notify(`已添加到播放列表: ${song.name}`);
    }

    playFromQueue(index) {
        if (index < 0 || index >= this.queue.length) return;
        this.currentIndex = index;
        // 保存当前索引
        localStorage.setItem('qqmusic_currentIndex', index.toString());
        this.playSong(this.queue[index]);
        this.ui.renderPlaylist(this.queue, this.currentIndex);
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
        this.ui.notify(`切换到: ${modeNames[this.playMode]}`);
    }

    updateModeUI() {
        const modeBtn = document.getElementById('mode-btn');
        if (!modeBtn) return;

        switch (this.playMode) {
            case 'sequence':
                modeBtn.innerHTML = '<i class="fas fa-repeat"></i>';
                modeBtn.title = '顺序播放';
                modeBtn.classList.remove('active');
                break;
            case 'repeat_one':
                modeBtn.innerHTML = '<i class="fas fa-repeat"></i><span class="mode-badge">1</span>';
                modeBtn.title = '单曲循环';
                modeBtn.classList.add('active');
                break;
            case 'shuffle':
                modeBtn.innerHTML = '<i class="fas fa-shuffle"></i>';
                modeBtn.title = '随机播放';
                modeBtn.classList.add('active');
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
        this.totalPages = 1;
        this.perPage = 60;
    }

    async search(keyword, page = 1) {
        this.currentKeyword = keyword;
        this.currentPage = page;

        if (!keyword.trim()) {
            this.ui.els.resultsList.innerHTML = '';
            return;
        }

        this.ui.els.loadingSpinner.style.display = 'flex';
        this.ui.els.resultsList.innerHTML = '';

        try {
            const results = await searchByType(keyword, 60, page);

            this.ui.els.loadingSpinner.style.display = 'none';

            if (!results || results.length === 0) {
                this.ui.els.resultsList.innerHTML = '<div class="empty-state"><p>未找到结果</p></div>';
                return;
            }

            // Render results
            this.renderResults(results);

            // Update pagination
            this.totalPages = Math.ceil(results.length / this.perPage);
            this.updatePagination();

        } catch (error) {
            console.error('Search failed:', error);
            this.ui.els.loadingSpinner.style.display = 'none';
            this.ui.notify('搜索失败: ' + error.message, 'error');
        }
    }

    renderResults(results) {
        this.ui.els.resultsList.innerHTML = '';

        // Paginate results
        const start = (this.currentPage - 1) * this.perPage;
        const end = start + this.perPage;
        const pageResults = results.slice(start, end);

        pageResults.forEach(song => {
            const singers = song.singer?.map(s => s.name).join(', ') || '';
            const isVip = song.pay?.pay_play !== 0;

            const cover = song.album?.mid
                ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${song.album.mid}.jpg`
                : 'https://y.gtimg.cn/music/photo_new/T002R300x300M000003y8dsH2wBHlo_1.jpg';

            const item = document.createElement('div');
            item.className = 'result-item';
            item.innerHTML = `
                <img src="${cover}" class="item-cover" loading="lazy">
                <div class="item-info">
                    <div class="item-title">${song.title}</div>
                    <div class="item-artist">${singers}</div>
                </div>
                <div class="item-actions">
                    <button class="action-btn play-action" title="立即播放">
                        <i class="fas fa-play"></i>
                    </button>
                    <button class="action-btn add-action add-next" title="添加到播放列表">
                        <i class="fas fa-plus"></i>
                    </button>
                </div>
            `;

            const songData = {
                mid: song.mid,
                name: song.title,
                singers: singers,
                album: song.album?.name || '',
                album_mid: song.album?.mid || '',
                vip: isVip,
                interval: song.interval || 0
            };

            // Play button click
            item.querySelector('.play-action').onclick = (e) => {
                e.stopPropagation();
                window.player.addToQueue(songData);
                window.player.playFromQueue(window.player.queue.length - 1);
            };

            // Add button click
            item.querySelector('.add-action').onclick = (e) => {
                e.stopPropagation();
                window.player.addToQueue(songData);
            };

            // 整行点击播放
            item.onclick = () => {
                window.player.addToQueue(songData);
                window.player.playFromQueue(window.player.queue.length - 1);
            };

            this.ui.els.resultsList.appendChild(item);
        });
    }

    updatePagination() {
        if (this.totalPages <= 1) {
            this.ui.els.pagination.style.display = 'none';
            return;
        }

        this.ui.els.pagination.style.display = 'flex';
        this.ui.els.pageInfo.textContent = `${this.currentPage} / ${this.totalPages}`;

        document.getElementById('prev-page').disabled = this.currentPage === 1;
        document.getElementById('next-page').disabled = this.currentPage === this.totalPages;
    }

    nextPage() {
        if (this.currentPage < this.totalPages) {
            this.search(this.currentKeyword, this.currentPage + 1);
        }
    }

    prevPage() {
        if (this.currentPage > 1) {
            this.search(this.currentKeyword, this.currentPage - 1);
        }
    }
}

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
    // Check credential
    const credential = getCredential();
    console.log('Credential loaded:', credential.isValid() ? 'Valid' : 'Invalid');

    // Initialize managers
    const ui = new UIManager();
    const player = new PlayerManager(ui);
    const search = new SearchManager(ui);

    // Make player globally accessible
    window.player = player;

    // Event Listeners
    document.getElementById('play-btn').onclick = () => player.togglePlay();
    document.getElementById('prev-btn').onclick = () => player.prev();
    document.getElementById('next-btn').onclick = () => player.next();
    document.getElementById('mode-btn').onclick = () => player.toggleMode();

    // Quality toggle
    document.getElementById('quality-toggle').onclick = () => {
        const qualityValue = document.getElementById('quality-value');
        const qualityLabel = document.getElementById('quality-label');

        if (qualityValue.value === 'flac') {
            qualityValue.value = 'mp3';
            qualityLabel.textContent = '320K';
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

    // Cover/Lyrics toggle
    // 点击封面切换到歌词
    ui.els.albumCover.onclick = () => ui.toggleView();
    // 点击封面视图区域（非封面图片）也切换
    ui.els.coverView.onclick = (e) => {
        // 如果点击的不是封面图片本身，也切换到歌词
        if (e.target !== ui.els.albumCover) {
            ui.toggleView();
        }
    };
    // 点击歌词视图背景切换回封面（歌词行点击已单独处理并阻止冒泡）
    ui.els.lyricsView.onclick = () => ui.toggleView();

    // Drawer controls
    document.getElementById('search-btn').onclick = () => ui.openDrawer('search');
    document.getElementById('playlist-btn').onclick = () => ui.openDrawer('playlist');
    document.getElementById('close-drawer').onclick = () => ui.closeDrawer();
    document.getElementById('close-playlist').onclick = () => ui.closeDrawer();
    ui.els.drawerOverlay.onclick = () => ui.closeDrawer();

    // Search
    const searchInput = document.getElementById('search-input');
    const debouncedSearch = debounce((keyword) => {
        search.search(keyword);
    }, 500);

    searchInput.oninput = (e) => {
        const keyword = e.target.value;
        document.getElementById('search-clear').style.display = keyword ? 'block' : 'none';
        debouncedSearch(keyword);
    };

    searchInput.onkeypress = (e) => {
        if (e.key === 'Enter') {
            search.search(e.target.value);
        }
    };

    document.getElementById('search-clear').onclick = () => {
        searchInput.value = '';
        document.getElementById('search-clear').style.display = 'none';
        ui.els.resultsList.innerHTML = '';
    };

    document.getElementById('prev-page').onclick = () => search.prevPage();
    document.getElementById('next-page').onclick = () => search.nextPage();

    // Playlist controls
    document.getElementById('clear-playlist').onclick = () => {
        if (confirm('确定要清空播放列表吗？')) {
            player.clearQueue();
        }
    };

    // Check for expired credential
    try {
        const isExpired = await checkExpired();
        if (isExpired) {
            console.log('Credential expired, attempting refresh...');
            const refreshed = await refreshCredential();
            if (refreshed) {
                ui.notify('凭证已自动刷新');
            } else {
                ui.notify('凭证已过期，部分功能可能受限', 'error');
            }
        }
    } catch (e) {
        console.warn('Credential check failed:', e);
    }

    console.log('QQ Music Web Player initialized');
});
