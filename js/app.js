/**
 * QQ Music Web Player - Main Application
 * Sidebar Layout Version
 */

import { searchByType } from './api/search.js';
import { getSongUrlWithFallback } from './api/song.js';
import { getCredential } from './api/credential.js';
import { checkExpired, refreshCredential } from './api/login.js';
import { getValidCoverUrl, getCoverUrlSync, DEFAULT_COVER } from './utils/cover.js';

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

            // Bottom bar info
            thumbImg: document.getElementById('thumb-img'),
            barTitle: document.getElementById('bar-title'),
            barArtist: document.getElementById('bar-artist'),

            // Controls
            playBtn: document.getElementById('play-btn'),
            currentTime: document.getElementById('current-time'),
            totalTime: document.getElementById('total-time'),
            progressFill: document.getElementById('progress-fill'),
            progressBar: document.getElementById('progress-bar'),

            // Pages
            searchPage: document.getElementById('search-page'),
            playlistPage: document.getElementById('playlist-page'),

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
        this.currentPage = 'search';

        this.initNavigation();
    }

    initNavigation() {
        // 侧边栏导航点击事件
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const page = btn.dataset.page;
                this.switchPage(page);
            });
        });
    }

    switchPage(pageName) {
        this.currentPage = pageName;

        // 更新导航按钮状态
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.page === pageName);
        });

        // 切换页面显示
        document.querySelectorAll('.page').forEach(page => {
            page.classList.remove('active');
        });

        const targetPage = document.getElementById(`${pageName}-page`);
        if (targetPage) {
            targetPage.classList.add('active');
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

        // 更新封面
        const coverUrl = getCoverUrlSync(song, 300);
        this.els.thumbImg.src = coverUrl;

        // 异步验证并更新封面
        getValidCoverUrl(song, 300).then(validUrl => {
            if (validUrl !== coverUrl) {
                this.els.thumbImg.src = validUrl;
            }
        });

        // 更新背景
        this.setBackground(coverUrl);

        // Update Media Session
        if ('mediaSession' in navigator) {
            const coverUrl800 = getCoverUrlSync(song, 800);
            navigator.mediaSession.metadata = new MediaMetadata({
                title: song.name,
                artist: song.singers,
                album: song.album || '',
                artwork: [
                    { src: coverUrl, sizes: '300x300', type: 'image/jpeg' },
                    { src: coverUrl800, sizes: '800x800', type: 'image/jpeg' }
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

    renderPlaylist(queue, currentIndex) {
        if (!this.els.playlistList) return;

        if (queue.length === 0) {
            this.els.playlistList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-music"></i>
                    <p>播放列表为空</p>
                    <p class="hint">搜索歌曲并点击"+"添加</p>
                </div>
            `;
            return;
        }

        this.els.playlistList.innerHTML = '';

        queue.forEach((song, i) => {
            const cover = getCoverUrlSync(song, 300);
            const isActive = i === currentIndex;

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
                <div class="item-actions">
                    <button class="action-btn remove-btn" data-idx="${i}" title="移除">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
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
            const cover = getCoverUrlSync({ album_mid: song.album?.mid, vs: song.vs }, 300);
            const albumName = song.album?.name || '';
            const duration = song.interval ? this.formatDuration(song.interval) : '';

            const item = document.createElement('div');
            item.className = 'song-item';
            item.innerHTML = `
                <div class="item-cover">
                    <img src="${cover}" loading="lazy">
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

            // 点击+添加到列表
            item.querySelector('.add-action').onclick = (e) => {
                e.stopPropagation();
                window.player.addToQueue(songData);
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
    const player = new PlayerManager(ui);
    const search = new SearchManager(ui);

    // Make player globally accessible
    window.player = player;

    // Event Listeners - Controls
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
