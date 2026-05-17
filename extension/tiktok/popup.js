const DEFAULT_CONFIG = {
	delays: {
		shortMs: 500,
		actionMs: 500,
		nextLoadMs: 1500
	},
	maxFailures: 10,
	stopOnNoVideo: false,
	video: {
		containerSelector: 'div[data-e2e="feed-video"], div[data-e2e="browse-video"], article',
		videoSelector: 'div[data-e2e="feed-video"] video, div[data-e2e="browse-video"] video, video'
	},
	follow: {
		buttonSelector: 'button[data-e2e="follow-button"], button[data-e2e="browse-follow-button"]',
		followTexts: ["Follow"],
		followingTexts: ["Following"]
	},
	like: {
		buttonSelector: 'button[data-e2e="like-button"], button[aria-label*="Like"]',
		likedAriaLabels: ["Liked"],
		likeAriaLabels: ["Like"],
		likedAriaPressed: "true"
	}
};

const statusEl = document.getElementById("status");
const configEl = document.getElementById("config");
const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const saveBtn = document.getElementById("save");
const resetBtn = document.getElementById("reset");

const setStatus = (text) => {
	statusEl.textContent = text;
};

const formatStatus = (status, extra) => {
	if (!extra || typeof extra !== "object") return status;
	try {
		return `${status} ${JSON.stringify(extra)}`;
	} catch (error) {
		return status;
	}
};

const loadConfig = async () => {
	const stored = await chrome.storage.sync.get("config");
	const config = stored.config || DEFAULT_CONFIG;
	configEl.value = JSON.stringify(config, null, 2);
	return config;
};

const saveConfig = async () => {
	try {
		const parsed = JSON.parse(configEl.value);
		await chrome.storage.sync.set({ config: parsed });
		setStatus("config_saved");
		return parsed;
	} catch (error) {
		setStatus("config_invalid_json");
		return null;
	}
};

const getActiveTab = async () => {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	return tab || null;
};

const isTikTokUrl = (url) => typeof url === "string" && url.includes("tiktok.com/");

const ensureContentScript = async (tabId) => {
	try {
		const ping = await chrome.tabs.sendMessage(tabId, { type: "PING" });
		if (ping && ping.ok) return true;
	} catch {
		// Ignore and attempt injection below.
	}

	try {
		await chrome.scripting.executeScript({
			target: { tabId },
			files: ["pip-script.js"]
		});
		const ping = await chrome.tabs.sendMessage(tabId, { type: "PING" });
		return Boolean(ping && ping.ok);
	} catch (error) {
		return false;
	}
};

const sendToTab = async (message) => {
	const tab = await getActiveTab();
	if (!tab || !tab.id) {
		setStatus("no_active_tab");
		return null;
	}
	if (!isTikTokUrl(tab.url)) {
		setStatus("not_tiktok_tab");
		return null;
	}

	const ready = await ensureContentScript(tab.id);
	if (!ready) {
		setStatus("content_script_missing");
		return null;
	}

	try {
		return await chrome.tabs.sendMessage(tab.id, message);
	} catch (error) {
		setStatus("content_script_missing");
		return null;
	}
};

startBtn.addEventListener("click", async () => {
	const stored = await chrome.storage.sync.get("config");
	const config = stored.config || DEFAULT_CONFIG;
	await sendToTab({ type: "START", config });
	setStatus("started");
});

stopBtn.addEventListener("click", async () => {
	await sendToTab({ type: "STOP" });
	setStatus("stopping");
});

saveBtn.addEventListener("click", saveConfig);

resetBtn.addEventListener("click", async () => {
	configEl.value = JSON.stringify(DEFAULT_CONFIG, null, 2);
	await chrome.storage.sync.set({ config: DEFAULT_CONFIG });
	setStatus("config_reset");
});

chrome.runtime.onMessage.addListener((message) => {
	if (message && message.type === "STATUS") {
		setStatus(formatStatus(message.status || "status_update", message.extra));
	}
});

window.addEventListener("DOMContentLoaded", async () => {
	await loadConfig();
	const response = await sendToTab({ type: "STATUS_REQUEST" });
	if (response && response.status) {
		setStatus(response.status);
	}
});
