// ==UserScript==
// @name         CCGFW 自动购买脚本
// @namespace    http://tampermonkey.net/
// @version      4.1.0
// @description  自动购买 CCGFW 的公益套餐，支持定时运行、手动触发和多标签页防重复
// @author       Ray
// @match        https://ccgfw.top/user/shop
// @match        https://ccgfw.top/*
// @icon         https://ccgfw.top/favicon.ico
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_notification
// @grant        GM_openInTab
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ==================== 配置与常量 ====================
    const STORAGE_KEYS = {
        ENABLED: 'autoBuyEnabled',
        TARGET_PACKAGE: 'targetPackage',
        INTERVAL_MINUTES: 'intervalMinutes',
        INTERVAL_UNIT: 'intervalUnit',
        LAST_RUN_TIME: 'lastRunTime',
        AUTO_OPEN: 'autoOpenEnabled',
        PENDING_AUTO_BUY: 'pendingAutoBuy',
        // 分布式锁相关
        LOCK_OWNER: 'lockOwner',
        LOCK_EXPIRE_AT: 'lockExpireAt',
        IS_EXECUTING: 'isExecuting',
        LAST_SUCCESS_TIME: 'lastSuccessTime'
    };

    const DEFAULT_CONFIG = {
        enabled: false,
        targetPackage: '公益 3',
        intervalMinutes: 60,
        intervalUnit: 'minutes',
        autoOpen: true
    };

    function getIntervalMs() {
        const interval = getConfig(STORAGE_KEYS.INTERVAL_MINUTES, DEFAULT_CONFIG.intervalMinutes);
        const unit = getConfig(STORAGE_KEYS.INTERVAL_UNIT, DEFAULT_CONFIG.intervalUnit);
        return unit === 'hours' ? interval * 60 * 60 * 1000 : interval * 60 * 1000;
    }

    const HEARTBEAT_INTERVAL_MS = 10 * 1000; // 心跳间隔：10秒
    const LOCK_TIMEOUT_MS = 30 * 1000; // 锁超时时间：30秒（3个心跳周期）
    const tabId = Math.random().toString(36).slice(2, 15); // 当前标签页唯一ID

    // ==================== 全局变量 ====================
    let scriptRunning = false;
    let menuCommands = [];
    let heartbeatTimer = null;

    // ==================== 工具函数 ====================
    function getConfig(key, defaultVal) {
        return GM_getValue(key, defaultVal);
    }

    function setConfig(key, val) {
        GM_setValue(key, val);
    }

    function initConfig() {
        if (GM_getValue(STORAGE_KEYS.ENABLED, undefined) === undefined) {
            GM_setValue(STORAGE_KEYS.ENABLED, DEFAULT_CONFIG.enabled);
            GM_setValue(STORAGE_KEYS.TARGET_PACKAGE, DEFAULT_CONFIG.targetPackage);
            GM_setValue(STORAGE_KEYS.INTERVAL_MINUTES, DEFAULT_CONFIG.intervalMinutes);
            GM_setValue(STORAGE_KEYS.INTERVAL_UNIT, DEFAULT_CONFIG.intervalUnit);
            GM_setValue(STORAGE_KEYS.AUTO_OPEN, DEFAULT_CONFIG.autoOpen);
            GM_setValue(STORAGE_KEYS.PENDING_AUTO_BUY, false);
            GM_setValue(STORAGE_KEYS.IS_EXECUTING, false);
        }
    }

    function isOnPurchasePage() {
        if (!window.location.href.includes('ccgfw.top/user/shop')) return false;
        return document.querySelectorAll('.shop-flex .card').length > 0;
    }

    function waitForPurchasePage(timeout = 10000) {
        return new Promise((resolve) => {
            if (isOnPurchasePage()) { resolve(true); return; }
            const start = Date.now();
            const check = setInterval(() => {
                if (isOnPurchasePage()) { clearInterval(check); resolve(true); }
                else if (Date.now() - start > timeout) { clearInterval(check); resolve(false); }
            }, 500);
        });
    }

    function formatTimestamp(ts) {
        if (!ts) return '从未执行';
        const d = new Date(ts);
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    // ==================== 分布式锁核心逻辑 ====================
    function tryGetLock() {
        const now = Date.now();
        const currentOwner = GM_getValue(STORAGE_KEYS.LOCK_OWNER, '');
        const currentExpire = GM_getValue(STORAGE_KEYS.LOCK_EXPIRE_AT, 0);

        if (now > currentExpire || currentOwner === '') {
            GM_setValue(STORAGE_KEYS.LOCK_OWNER, tabId);
            GM_setValue(STORAGE_KEYS.LOCK_EXPIRE_AT, now + LOCK_TIMEOUT_MS);
            const finalOwner = GM_getValue(STORAGE_KEYS.LOCK_OWNER, '');
            return finalOwner === tabId;
        }
        return false;
    }

    function releaseLock() {
        const currentOwner = GM_getValue(STORAGE_KEYS.LOCK_OWNER, '');
        if (currentOwner === tabId) {
            GM_setValue(STORAGE_KEYS.LOCK_OWNER, '');
            GM_setValue(STORAGE_KEYS.LOCK_EXPIRE_AT, 0);
        }
    }

    function isLockOwner() {
        return GM_getValue(STORAGE_KEYS.LOCK_OWNER, '') === tabId;
    }

    // ==================== 心跳与主备调度 ====================
    function heartbeat() {
        const now = Date.now();
        const owner = GM_getValue(STORAGE_KEYS.LOCK_OWNER, '');
        const expireAt = GM_getValue(STORAGE_KEYS.LOCK_EXPIRE_AT, 0);
        const isExecuting = GM_getValue(STORAGE_KEYS.IS_EXECUTING, false);
        const lastSuccess = GM_getValue(STORAGE_KEYS.LAST_SUCCESS_TIME, 0);
        const intervalMs = getIntervalMs();

        if (isLockOwner()) {
            GM_setValue(STORAGE_KEYS.LOCK_EXPIRE_AT, now + LOCK_TIMEOUT_MS);
            if (shouldRunNow() && isOnPurchasePage() && !scriptRunning && !isExecuting) {
                if (lastSuccess === 0 || now - lastSuccess >= intervalMs / 2) {
                    runAutoBuy();
                }
            }
        } else {
            if (now > expireAt) {
                if (tryGetLock()) {
                    updateStatus('锁过期，已成为主实例');
                }
            } else if (lastSuccess !== 0 && now - lastSuccess > intervalMs + 60 * 1000) {
                if (tryGetLock()) {
                    updateStatus('主实例超时，已接管');
                    if (shouldRunNow() && isOnPurchasePage() && !scriptRunning) {
                        runAutoBuy();
                    }
                }
            }
        }
        refreshConfigDisplay();
    }

    function startHeartbeat() {
        stopHeartbeat();
        tryGetLock();
        heartbeatTimer = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
        heartbeat();
    }

    function stopHeartbeat() {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
    }

    // ==================== UI 相关 ====================
    function refreshConfigDisplay() {
        const configDiv = document.getElementById('ccgfw-config-display');
        if (!configDiv) return;

        const enabled = getConfig(STORAGE_KEYS.ENABLED, DEFAULT_CONFIG.enabled);
        const targetPackage = getConfig(STORAGE_KEYS.TARGET_PACKAGE, DEFAULT_CONFIG.targetPackage);
        const intervalMinutes = getConfig(STORAGE_KEYS.INTERVAL_MINUTES, DEFAULT_CONFIG.intervalMinutes);
        const intervalUnit = getConfig(STORAGE_KEYS.INTERVAL_UNIT, DEFAULT_CONFIG.intervalUnit);
        const autoOpen = getConfig(STORAGE_KEYS.AUTO_OPEN, DEFAULT_CONFIG.autoOpen);
        const lastRunTime = getConfig(STORAGE_KEYS.LAST_RUN_TIME, null);
        const pendingAutoBuy = getConfig(STORAGE_KEYS.PENDING_AUTO_BUY, false);
        const onPurchasePage = isOnPurchasePage();

        const owner = GM_getValue(STORAGE_KEYS.LOCK_OWNER, '');
        const expireAt = GM_getValue(STORAGE_KEYS.LOCK_EXPIRE_AT, 0);
        const isExecuting = GM_getValue(STORAGE_KEYS.IS_EXECUTING, false);
        const lastSuccess = GM_getValue(STORAGE_KEYS.LAST_SUCCESS_TIME, 0);

        const unitText = intervalUnit === 'hours' ? '小时' : '分钟';

        let nextRunInfo = '未启用';
        if (enabled) {
            const intervalMs = getIntervalMs();
            const elapsed = lastSuccess ? Date.now() - lastSuccess : intervalMs;
            const remaining = intervalMs - elapsed;
            if (remaining <= 0) {
                nextRunInfo = '即将执行';
            } else {
                const remHour = Math.floor(remaining / 3600000);
                const remMin = Math.floor((remaining % 3600000) / 60000);
                const remSec = Math.floor((remaining % 60000) / 1000);
                if (remHour > 0) {
                    nextRunInfo = `${remHour}小时${remMin}分${remSec}秒后`;
                } else {
                    nextRunInfo = `${remMin}分${remSec}秒后`;
                }
            }
        }

        configDiv.innerHTML = `
            <div style="margin-bottom:6px;color:#333;font-weight:bold;">📋 已保存配置状态</div>
            <div style="margin-bottom:3px;">当前角色: <span style="color:${isLockOwner() ? '#4CAF50' : '#FF9800'};font-weight:bold;">${isLockOwner() ? '🏆 主实例' : '🥈 备用实例'}</span></div>
            <div style="margin-bottom:3px;">锁持有者: <span style="color:#1976D2;font-weight:bold;">${owner ? owner.slice(0, 8) + '...' : '无'}</span></div>
            <div style="margin-bottom:3px;">锁过期时间: <span style="color:#9C27B0;font-weight:bold;">${expireAt ? formatTimestamp(expireAt) : '无'}</span></div>
            <div style="margin-bottom:3px;">执行中状态: <span style="color:${isExecuting ? '#f44336' : '#4CAF50'};font-weight:bold;">${isExecuting ? '✅ 是' : '❌ 否'}</span></div>
            <div style="margin-bottom:3px;">上次成功执行: <span style="color:#FF9800;font-weight:bold;">${lastSuccess ? formatTimestamp(lastSuccess) : '从未'}</span></div>
            <div style="margin-bottom:3px;">自动购买: <span style="color:${enabled ? '#4CAF50' : '#f44336'};font-weight:bold;">${enabled ? '✅ 已启用' : '❌ 已禁用'}</span></div>
            <div style="margin-bottom:3px;">目标套餐: <span style="color:#1976D2;font-weight:bold;">${targetPackage}</span></div>
            <div style="margin-bottom:3px;">定时间隔: <span style="color:#1976D2;font-weight:bold;">${intervalMinutes} ${unitText}</span></div>
            <div style="margin-bottom:3px;">自动打开网站: <span style="color:${autoOpen ? '#4CAF50' : '#f44336'};font-weight:bold;">${autoOpen ? '✅ 已启用' : '❌ 已禁用'}</span></div>
            <div style="margin-bottom:3px;">上次执行时间: <span style="color:#FF9800;font-weight:bold;">${formatTimestamp(lastRunTime)}</span></div>
            <div style="margin-bottom:3px;">下次执行: <span style="color:#9C27B0;font-weight:bold;">${nextRunInfo}</span></div>
            <div style="margin-bottom:3px;">待执行标记: <span style="color:${pendingAutoBuy ? '#FF9800' : '#666'};font-weight:bold;">${pendingAutoBuy ? '⏳ 跳转中-待执行' : '无'}</span></div>
            <div>当前页面状态: <span style="color:${onPurchasePage ? '#4CAF50' : '#f44336'};font-weight:bold;">${onPurchasePage ? '✅ 购买页面' : '❌ 非购买页面'}</span></div>
        `;
    }

    function createSettingsUI() {
        if (document.getElementById('ccgfw-settings')) {
            document.getElementById('ccgfw-settings').remove();
        }

        const container = document.createElement('div');
        container.id = 'ccgfw-settings';
        container.style.cssText = `
            position: fixed; top: 20px; right: 20px; background: white;
            border: 2px solid #4CAF50; border-radius: 8px; padding: 20px;
            z-index: 10000; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            min-width: 360px; max-height: 90vh; overflow-y: auto;
            font-family: Arial, sans-serif;
        `;

        const title = document.createElement('h3');
        title.textContent = 'CCGFW 自动购买设置 v4.1';
        title.style.cssText = 'margin-top: 0; color: #4CAF50;';
        container.appendChild(title);

        const configDiv = document.createElement('div');
        configDiv.id = 'ccgfw-config-display';
        configDiv.style.cssText = `
            margin-bottom: 15px; padding: 12px; background: #f0f7f0;
            border: 1px solid #c8e6c9; border-radius: 4px;
            font-size: 13px; line-height: 1.6;
        `;
        container.appendChild(configDiv);

        const enabledDiv = document.createElement('div');
        enabledDiv.style.marginBottom = '15px';
        const enabledLabel = document.createElement('label');
        enabledLabel.style.display = 'flex';
        enabledLabel.style.alignItems = 'center';
        enabledLabel.style.gap = '10px';
        const enabledCheckbox = document.createElement('input');
        enabledCheckbox.type = 'checkbox';
        enabledCheckbox.checked = getConfig(STORAGE_KEYS.ENABLED, DEFAULT_CONFIG.enabled);
        enabledCheckbox.onchange = () => {
            setConfig(STORAGE_KEYS.ENABLED, enabledCheckbox.checked);
            if (enabledCheckbox.checked) { startAutoRun(); }
            else { stopAutoRun(); }
            refreshConfigDisplay();
        };
        enabledLabel.appendChild(enabledCheckbox);
        enabledLabel.appendChild(document.createTextNode('启用自动购买'));
        enabledDiv.appendChild(enabledLabel);
        container.appendChild(enabledDiv);

        const packageDiv = document.createElement('div');
        packageDiv.style.marginBottom = '15px';
        const packageLabel = document.createElement('label');
        packageLabel.textContent = '目标套餐: ';
        packageLabel.style.marginRight = '10px';
        packageDiv.appendChild(packageLabel);
        const packageSelect = document.createElement('select');
        packageSelect.style.cssText = 'padding:5px;border-radius:4px;border:1px solid #ccc;';
        const packages = [
            '公益 1', '公益 3',
            '1个月套餐 Lv.2', '3个月套餐 Lv.3', '半年套餐 Lv.4',
            '1年套餐 Lv.5', '2年套餐 Lv.6', '4年套餐 Lv.7',
            '8年套餐 Lv.8', '16年套餐 Lv.9'
        ];
        packages.forEach(pkg => {
            const option = document.createElement('option');
            option.value = pkg; option.textContent = pkg;
            packageSelect.appendChild(option);
        });
        packageSelect.value = getConfig(STORAGE_KEYS.TARGET_PACKAGE, DEFAULT_CONFIG.targetPackage);
        packageSelect.onchange = () => {
            setConfig(STORAGE_KEYS.TARGET_PACKAGE, packageSelect.value);
            refreshConfigDisplay();
        };
        packageDiv.appendChild(packageSelect);
        container.appendChild(packageDiv);

        const intervalDiv = document.createElement('div');
        intervalDiv.style.marginBottom = '15px';
        const intervalLabel = document.createElement('label');
        intervalLabel.textContent = '定时运行间隔: ';
        intervalLabel.style.marginRight = '10px';
        intervalDiv.appendChild(intervalLabel);

        const unitSelect = document.createElement('select');
        unitSelect.style.cssText = 'padding:5px;border-radius:4px;border:1px solid #ccc;';
        const unitOptions = [
            { value: 'minutes', text: '分钟' },
            { value: 'hours', text: '小时' }
        ];
        unitOptions.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value; option.textContent = opt.text;
            unitSelect.appendChild(option);
        });
        unitSelect.value = getConfig(STORAGE_KEYS.INTERVAL_UNIT, DEFAULT_CONFIG.intervalUnit);

        const intervalInput = document.createElement('input');
        intervalInput.type = 'number'; intervalInput.min = '1'; intervalInput.max = '1440';
        intervalInput.value = getConfig(STORAGE_KEYS.INTERVAL_MINUTES, DEFAULT_CONFIG.intervalMinutes);
        intervalInput.style.cssText = 'width:80px;padding:5px;border-radius:4px;border:1px solid #ccc;margin-left:5px;';
        intervalInput.onchange = () => {
            const value = parseInt(intervalInput.value);
            const maxValue = unitSelect.value === 'hours' ? 168 : 1440;
            if (value >= 1 && value <= maxValue) {
                setConfig(STORAGE_KEYS.INTERVAL_MINUTES, value);
                refreshConfigDisplay();
            }
        };
        intervalDiv.appendChild(intervalInput);

        unitSelect.onchange = () => {
            setConfig(STORAGE_KEYS.INTERVAL_UNIT, unitSelect.value);
            const currentValue = parseInt(intervalInput.value);
            const maxValue = unitSelect.value === 'hours' ? 168 : 1440;
            if (currentValue > maxValue) {
                intervalInput.value = maxValue;
                setConfig(STORAGE_KEYS.INTERVAL_MINUTES, maxValue);
            }
            refreshConfigDisplay();
        };
        intervalDiv.appendChild(unitSelect);
        container.appendChild(intervalDiv);

        const autoOpenDiv = document.createElement('div');
        autoOpenDiv.style.marginBottom = '20px';
        const autoOpenLabel = document.createElement('label');
        autoOpenLabel.style.display = 'flex';
        autoOpenLabel.style.alignItems = 'center';
        autoOpenLabel.style.gap = '10px';
        const autoOpenCheckbox = document.createElement('input');
        autoOpenCheckbox.type = 'checkbox';
        autoOpenCheckbox.checked = getConfig(STORAGE_KEYS.AUTO_OPEN, DEFAULT_CONFIG.autoOpen);
        autoOpenCheckbox.onchange = () => {
            setConfig(STORAGE_KEYS.AUTO_OPEN, autoOpenCheckbox.checked);
            refreshConfigDisplay();
        };
        autoOpenLabel.appendChild(autoOpenCheckbox);
        autoOpenLabel.appendChild(document.createTextNode('自动打开网站'));
        autoOpenDiv.appendChild(autoOpenLabel);
        container.appendChild(autoOpenDiv);

        const buttonDiv = document.createElement('div');
        buttonDiv.style.cssText = 'display:flex;gap:10px;margin-top:10px;';

        const refreshBtn = document.createElement('button');
        refreshBtn.textContent = '🔄 刷新状态';
        refreshBtn.style.cssText = 'padding:8px 16px;background:#2196F3;color:white;border:none;border-radius:4px;cursor:pointer;flex:1;';
        refreshBtn.onclick = () => { refreshConfigDisplay(); updateStatus('状态已刷新'); };
        buttonDiv.appendChild(refreshBtn);

        const runNowBtn = document.createElement('button');
        runNowBtn.textContent = '▶️ 立即运行';
        runNowBtn.style.cssText = 'padding:8px 16px;background:#4CAF50;color:white;border:none;border-radius:4px;cursor:pointer;flex:1;';
        runNowBtn.onclick = () => {
            if (!isOnPurchasePage()) {
                setConfig(STORAGE_KEYS.PENDING_AUTO_BUY, true);
                updateStatus('⏳ 已设置待执行标记，正在跳转购买页面...');
                refreshConfigDisplay();
                if (getConfig(STORAGE_KEYS.AUTO_OPEN, DEFAULT_CONFIG.autoOpen)) {
                    GM_openInTab('https://ccgfw.top/user/shop', { active: true });
                } else {
                    window.location.href = 'https://ccgfw.top/user/shop';
                }
                return;
            }
            if (tryGetLock() && !scriptRunning) {
                runAutoBuy();
            } else {
                updateStatus('❌ 已有主实例运行或脚本正在执行');
            }
        };
        buttonDiv.appendChild(runNowBtn);

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '关闭';
        closeBtn.style.cssText = 'padding:8px 16px;background:#f44336;color:white;border:none;border-radius:4px;cursor:pointer;flex:1;';
        closeBtn.onclick = () => {
            if (container._refreshTimer) clearInterval(container._refreshTimer);
            container.remove();
        };
        buttonDiv.appendChild(closeBtn);
        container.appendChild(buttonDiv);

        const statusDiv = document.createElement('div');
        statusDiv.id = 'ccgfw-status';
        statusDiv.style.cssText = 'margin-top:15px;padding:10px;background:#f5f5f5;border-radius:4px;font-size:12px;color:#666;';
        statusDiv.textContent = '状态: 等待中';
        container.appendChild(statusDiv);

        document.body.appendChild(container);
        refreshConfigDisplay();

        container._refreshTimer = setInterval(() => {
            if (document.getElementById('ccgfw-settings')) { refreshConfigDisplay(); }
            else { clearInterval(container._refreshTimer); }
        }, 3000);
    }

    function updateStatus(message) {
        const statusDiv = document.getElementById('ccgfw-status');
        if (statusDiv) {
            statusDiv.textContent = `状态: ${message}`;
            statusDiv.style.color = message.includes('成功') || message.includes('完成') || message.includes('✅') ? '#4CAF50' :
                                    message.includes('失败') || message.includes('❌') ? '#f44336' : '#666';
        }
    }

    function shouldRunNow() {
        if (!getConfig(STORAGE_KEYS.ENABLED, DEFAULT_CONFIG.enabled)) return false;
        const lastSuccess = GM_getValue(STORAGE_KEYS.LAST_SUCCESS_TIME, 0);
        if (lastSuccess === 0) return true;
        const intervalMs = getIntervalMs();
        return (Date.now() - lastSuccess) >= intervalMs;
    }

    // ==================== 购买逻辑 ====================
    function runAutoBuy() {
        if (!isOnPurchasePage()) {
            updateStatus('❌ 当前不在购买页面，无法执行');
            setConfig(STORAGE_KEYS.PENDING_AUTO_BUY, true);
            refreshConfigDisplay();
            if (getConfig(STORAGE_KEYS.AUTO_OPEN, DEFAULT_CONFIG.autoOpen)) {
                GM_openInTab('https://ccgfw.top/user/shop', { active: true });
            }
            return;
        }

        if (!isLockOwner()) {
            updateStatus('❌ 当前不是主实例，无法执行');
            return;
        }

        if (scriptRunning) {
            updateStatus('脚本正在运行中，请稍候');
            return;
        }

        const isExecuting = GM_getValue(STORAGE_KEYS.IS_EXECUTING, false);
        if (isExecuting) {
            updateStatus('❌ 其他实例正在执行，无法重复执行');
            return;
        }

        const now = Date.now();
        const lastSuccess = GM_getValue(STORAGE_KEYS.LAST_SUCCESS_TIME, 0);
        const intervalMs = getIntervalMs();
        if (lastSuccess !== 0 && now - lastSuccess < intervalMs / 2) {
            updateStatus('❌ 距离上次成功执行时间过短，跳过');
            return;
        }

        scriptRunning = true;
        GM_setValue(STORAGE_KEYS.IS_EXECUTING, true);
        updateStatus('开始执行购买流程...');
        refreshConfigDisplay();

        const TARGET_PACKAGE = getConfig(STORAGE_KEYS.TARGET_PACKAGE, DEFAULT_CONFIG.targetPackage);
        const MAX_RETRIES = 10;
        const RETRY_INTERVAL = 1000;

        function findAndClickBuy() {
            updateStatus(`正在查找套餐: ${TARGET_PACKAGE}`);
            const cards = document.querySelectorAll('.shop-flex .card');
            for (const card of cards) {
                const nameEl = card.querySelector('.shop-name');
                if (nameEl && nameEl.textContent.trim() === TARGET_PACKAGE) {
                    const buyBtn = card.querySelector('.shop-btn');
                    if (buyBtn) {
                        buyBtn.click();
                        updateStatus(`已点击购买按钮: ${TARGET_PACKAGE}`);
                        return true;
                    }
                }
            }
            updateStatus(`未找到套餐: ${TARGET_PACKAGE}`);
            return false;
        }

        function clickCouponConfirm() {
            updateStatus('处理优惠码确认...');
            const modals = document.querySelectorAll('div[role="dialog"], .modal, .modal-dialog');
            for (const modal of modals) {
                if (modal.textContent.includes('您有优惠码吗？')) {
                    const buttons = modal.querySelectorAll('button');
                    for (const btn of buttons) {
                        if (btn.textContent.includes('确定') || btn.textContent.includes('OK')) {
                            btn.click();
                            updateStatus('已点击优惠码确认');
                            return true;
                        }
                    }
                }
            }
            return false;
        }

        function clickOrderConfirm() {
            updateStatus('处理订单确认...');
            const modals = document.querySelectorAll('div[role="dialog"], .modal, .modal-dialog');
            for (const modal of modals) {
                if (modal.textContent.includes('订单确认') || modal.textContent.includes('商品名称')) {
                    const buttons = modal.querySelectorAll('button');
                    for (const btn of buttons) {
                        if (btn.textContent.includes('确定') || btn.textContent.includes('确认')) {
                            btn.click();
                            updateStatus('已点击订单确认');
                            return true;
                        }
                    }
                }
            }
            return false;
        }

        let step = 'buy';
        let retryCount = 0;

        function execute() {
            if (retryCount >= MAX_RETRIES) {
                updateStatus('超过最大重试次数，终止执行');
                scriptRunning = false;
                GM_setValue(STORAGE_KEYS.IS_EXECUTING, false);
                refreshConfigDisplay();
                return;
            }
            retryCount++;

            switch (step) {
                case 'buy':
                    if (findAndClickBuy()) {
                        step = 'coupon'; retryCount = 0;
                        setTimeout(execute, 1500);
                    } else { setTimeout(execute, RETRY_INTERVAL); }
                    break;
                case 'coupon':
                    if (clickCouponConfirm()) {
                        step = 'order'; retryCount = 0;
                        setTimeout(execute, 1500);
                    } else { setTimeout(execute, RETRY_INTERVAL); }
                    break;
                case 'order':
                    if (clickOrderConfirm()) {
                        updateStatus('✅ 购买流程完成!');
                        setConfig(STORAGE_KEYS.LAST_RUN_TIME, Date.now());
                        GM_setValue(STORAGE_KEYS.LAST_SUCCESS_TIME, Date.now());
                        setConfig(STORAGE_KEYS.PENDING_AUTO_BUY, false);
                        scriptRunning = false;
                        GM_setValue(STORAGE_KEYS.IS_EXECUTING, false);
                        refreshConfigDisplay();
                        GM_notification({ text: 'CCGFW 自动购买完成', title: '脚本通知', timeout: 3000 });

                        setTimeout(() => {
                            GM_openInTab('https://ccgfw.top/user', { active: true });
                            setTimeout(() => { location.reload(); }, 1000);
                        }, 2000);
                    } else { setTimeout(execute, RETRY_INTERVAL); }
                    break;
            }
        }
        execute();
    }

    // ==================== 启停与菜单 ====================
    function startAutoRun() {
        stopAutoRun();
        if (!getConfig(STORAGE_KEYS.ENABLED, DEFAULT_CONFIG.enabled)) return;
        startHeartbeat();
        const intervalMinutes = getConfig(STORAGE_KEYS.INTERVAL_MINUTES, DEFAULT_CONFIG.intervalMinutes);
        const intervalUnit = getConfig(STORAGE_KEYS.INTERVAL_UNIT, DEFAULT_CONFIG.intervalUnit);
        const unitText = intervalUnit === 'hours' ? '小时' : '分钟';
        updateStatus(`定时运行已启动，间隔: ${intervalMinutes} ${unitText}`);
    }

    function stopAutoRun() {
        stopHeartbeat();
        updateStatus('定时运行已停止');
        refreshConfigDisplay();
    }

    function createMenuCommands() {
        const settingsCmd = GM_registerMenuCommand('⚙️ CCGFW 设置', () => {
            if (!document.getElementById('ccgfw-settings')) { createSettingsUI(); }
        });
        menuCommands.push(settingsCmd);

        const runNowCmd = GM_registerMenuCommand('▶️ 立即运行脚本', () => {
            if (!isOnPurchasePage()) {
                setConfig(STORAGE_KEYS.PENDING_AUTO_BUY, true);
                if (getConfig(STORAGE_KEYS.AUTO_OPEN, DEFAULT_CONFIG.autoOpen)) {
                    GM_openInTab('https://ccgfw.top/user/shop', { active: true });
                } else {
                    window.location.href = 'https://ccgfw.top/user/shop';
                }
                return;
            }
            if (tryGetLock() && !scriptRunning) {
                runAutoBuy();
            }
        });
        menuCommands.push(runNowCmd);

        const toggleCmd = GM_registerMenuCommand(
            getConfig(STORAGE_KEYS.ENABLED) ? '⏸️ 禁用脚本' : '▶️ 启用脚本',
            () => {
                const current = getConfig(STORAGE_KEYS.ENABLED);
                setConfig(STORAGE_KEYS.ENABLED, !current);
                if (!current) { startAutoRun(); } else { stopAutoRun(); }
                removeMenuCommands(); createMenuCommands();
            }
        );
        menuCommands.push(toggleCmd);
    }

    function removeMenuCommands() {
        menuCommands.forEach(cmdId => { try { GM_unregisterMenuCommand(cmdId); } catch(e){} });
        menuCommands = [];
    }

    // ==================== 主入口 ====================
    async function main() {
        initConfig();
        createMenuCommands();

        window.addEventListener('beforeunload', releaseLock);

        const pendingAutoBuy = getConfig(STORAGE_KEYS.PENDING_AUTO_BUY, false);
        const isShopUrl = window.location.href.includes('ccgfw.top/user/shop');

        if (isShopUrl) {
            await waitForPurchasePage(15000);
        }

        if (isOnPurchasePage()) {
            createSettingsUI();

            if (pendingAutoBuy) {
                setConfig(STORAGE_KEYS.PENDING_AUTO_BUY, false);
                if (tryGetLock()) {
                    updateStatus('⏳ 检测到待执行标记，已成为主实例，立即开始购买...');
                    refreshConfigDisplay();
                    setTimeout(() => {
                        if (!scriptRunning) { runAutoBuy(); }
                    }, 1500);
                } else {
                    updateStatus('⏳ 检测到待执行标记，但已有主实例，等待执行');
                }
            }

            if (getConfig(STORAGE_KEYS.ENABLED, DEFAULT_CONFIG.enabled)) {
                startAutoRun();
            }
        } else if (window.location.href.includes('ccgfw.top')) {
            if (getConfig(STORAGE_KEYS.ENABLED, DEFAULT_CONFIG.enabled)) {
                startHeartbeat();
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main);
    } else {
        main();
    }
})();