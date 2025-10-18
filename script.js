// ==UserScript==
// @name         御瑞自动刷课
// @version      0.7
// @description  看你🐴的网课
// @match        https://*.yuruixxkj.com/user/node?nodeId=*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const OCR_API_URL = 'http://127.0.0.1:8000/ocr/base64';
    const LOG_API_URL = 'https://api.telegram.org/bot123456:AABBCCDDEEFF/sendMessage'
    let playTimer = null;
    let timeTimer = null;
    let verifyTimer = null;
    let pausedByVerify = false;

    const CHAT_ID = "";

    function safeStringify(value) {
        const seen = new WeakSet();
        return (function _stringify(v) {
            if (v === null) return "null";
            if (typeof v === "string") return v;
            if (typeof v === "number" || typeof v === "boolean") return String(v);
            if (v instanceof Error) return `${v.name}: ${v.message}\n${v.stack || ""}`;
            if (Array.isArray(v)) return `[${v.map(_stringify).join(", ")}]`;
            if (typeof v === "function") return v.toString();
            if (typeof v === "object") {
            if (seen.has(v)) return "[Circular]";
            seen.add(v);
            try {
                const entries = Object.keys(v).map(k => `${k}:${_stringify(v[k])}`);
                return `{${entries.join(", ")}}`;
            } catch (e) {
                return "[Unserializable]";
            }
            }
            return String(v);
        })(value);
    }

    function getPathWithParams() {
        if (typeof window === "undefined" || !window.location) return "";
        return window.location.pathname + window.location.search; // e.g. /path?x=1
    }

    function sendLog(level, ...args) {
        const ts = new Date().toISOString();
        const path = getPathWithParams();
        const formattedArgs = args.map(arg => safeStringify(arg));
        const text = `[${level.toUpperCase()}] ${ts} ${path} ${formattedArgs.join(" ")}`;

        const url = `${LOG_API_URL}?chat_id=${encodeURIComponent(CHAT_ID)}&text=${encodeURIComponent(text)}`;
        try {
            fetch(url).catch(() => {});
        } catch (e) {}

        if (console && typeof console[level] === "function") {
            console[level](...args);
        } else {
            console.log(...args);
        }
    }

    ["log", "info", "warn", "error", "debug"].forEach(level => {
        sendLog[level] = (...args) => sendLog(level, ...args);
    });

    function forcePlayVideo() {
        const video = document.querySelector('video');
        if (!video) return;

        // 已播放完，不再触发
        if (video.duration > 0 && video.currentTime >= video.duration - 0.5) {
            return;
        }

        if (video.paused) {
            video.muted = true;
            video.setAttribute('autoplay', 'true');
            video.setAttribute('playsinline', '');
            video.play().catch(() => {});
        }
    }

    function checkVideoEnd() {
        const timeText = document.querySelector('[class^="timetext"]');
        if (!timeText) return;

        const text = timeText.innerText.trim();
        const match = text.match(/(\d+:\d+)\s*\/\s*(\d+:\d+)/);
        if (match) {
            const cur = match[1];
            const total = match[2];
            if (cur === total) {
                sendLog.log('[yurui-auto] 视频播放完成，准备点击下一节');
                clickNextItem();
            }
        }
    }

    function checkVerifyLayer() {
        const layer = document.querySelector('div[id^="layui-layer"]');

        if (layer && !pausedByVerify) {
            sendLog.warn('[yurui-auto] 检测到验证码弹窗，暂停脚本');
            pausedByVerify = true;
            clearInterval(playTimer);
            clearInterval(timeTimer);
            playTimer = null;
            timeTimer = null;
            setTimeout(() => {
                processCaptcha(layer);
            }, 6000);
        }

        if (!layer && pausedByVerify) {
            sendLog.log('[yurui-auto] 验证码通过');
            pausedByVerify = false;
            setTimeout(() => {
                if (!playTimer) playTimer = setInterval(forcePlayVideo, 1000);
                if (!timeTimer) timeTimer = setInterval(checkVideoEnd, 2000);
            }, 2000);
        }
    }

    async function processCaptcha(layer) {
        const imgEl = getCaptchaImage();
        if (!imgEl) {
            sendLog.warn('[yurui-auto] 未找到验证码图片');
            return;
        }

        sendLog.log('[yurui-auto] 获取验证码图片:', imgEl);
        try {
            const base64 = await imageToBase64(imgEl);
            const res = await fetch(OCR_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image_base64: base64 })
            });

            const data = await res.json();
            if (data && data.code == 0) {
                sendLog.log('[yurui-auto] OCR 返回结果:', data.result);
                fillCaptchaInput(data.result);
                autoSubmitCaptcha();
            } else {
                sendLog.warn('[yurui-auto] OCR 返回异常:', data);
            }
        } catch (e) {
            sendLog.error('[yurui-auto] 处理验证码出错:', e);
        }
    }

    function getCaptchaImage() {
        // 页面上的 imgCode 是真正显示的验证码
        const imgs = Array.from(document.querySelectorAll('img'));
        return imgs.find(img => img.src.includes('/service/code/aa'));
    }

    /** --------------------
     * 将图片 URL 转成 Base64
     * -------------------- */
    function imageToBase64(imgEl) {
        return new Promise((resolve, reject) => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            const img = imgEl;
            canvas.width = img.width;
            canvas.height = img.height;

            ctx.drawImage(img, 0, 0);

            resolve(canvas.toDataURL('image/png'));
        });
    }

    function fillCaptchaInput(code) {
        const input = document.querySelector('input[placeholder="请输入验证码"]:not([id="yzCode"])');
        input.dispatchEvent(new Event('mousedown', { bubbles: true }));
        if (!input) {
            sendLog.warn('[yurui-auto] 找不到验证码输入框');
            return;
        }
        input.value = code;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        sendLog.log('[yurui-auto] 已自动填入验证码:', code);
    }

    function autoSubmitCaptcha() {
        const btn = document.querySelector('a.layui-layer-btn0, button.layui-layer-btn0, .layui-layer-btn0');
        if (btn) {
            sendLog.log('[yurui-auto] 点击提交验证码按钮');
            btn.click();
        } else {
            sendLog.warn('[yurui-auto] 未找到验证码提交按钮');
        }
    }

    function clickNextItem() {
        const group = document.querySelector('div.group.two.on');
        if (!group) {
            sendLog.warn('[yurui-auto] 未找到当前展开的章节');
            return;
        }

        const current = group.querySelector('.item a.on');
        if (!current) {
            sendLog.warn('[yurui-auto] 未找到当前选中项');
            return;
        }

        let nextItem = group.querySelector('.item a.on').closest('.item').nextElementSibling;

        if (!nextItem) {
            sendLog.log('[yurui-auto] 当前章节已播放完毕，查找下一个章节');
            const nextGroup = group.nextElementSibling;
            if (nextGroup && nextGroup.classList.contains('group') && nextGroup.classList.contains('two')) {
                const nextSection = nextGroup.querySelector('.item a');
                if (nextSection) {
                    sendLog.log('[yurui-auto] 在下一个章节中，点击下一节：', nextSection.innerText);
                    nextSection.click();
                }
            } else {
                sendLog.log('[yurui-auto] 没有找到下一个章节组');
            }
        } else {
            const nextLink = nextItem.querySelector('a');
            if (nextLink) {
                sendLog.log('[yurui-auto] 点击下一节：', nextLink.innerText);
                nextLink.click();
            }
        }
    }

    playTimer = setInterval(forcePlayVideo, 1000);
    timeTimer = setInterval(checkVideoEnd, 2000);
    verifyTimer = setInterval(checkVerifyLayer, 1000);
})();
