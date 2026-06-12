chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message && message.type === "PING") {
		sendResponse({ ok: true, from: "background" });
		return true;
	}

	return false;
});
