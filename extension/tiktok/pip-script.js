(() => {
	const DEFAULT_CONFIG = {
		delays: {
			shortMs: 500,
			actionMs: 500,
			nextLoadMs: 1500
		},
		maxFailures: 0,
		stopOnNoVideo: false,
		page: {
			privateTitles: [
				"Đây là tài khoản riêng tư",
				"This account is private"
			],
			loginTitles: ["Log in to TikTok", "Login", "Sign up"]
		},
		video: {
			containerSelector: 'div[data-e2e="feed-video"], div[data-e2e="browse-video"], article',
			videoSelector: 'div[data-e2e="feed-video"] video, div[data-e2e="browse-video"] video, video'
		},
		follow: {
			buttonSelector:
				'button[data-e2e="follow-button"], button[data-e2e="browse-follow-button"], div[data-e2e="browse-follow"] button',
			followTexts: ["Follow", "Theo doi", "Theo dõi"],
			followingTexts: [
				"Following",
				"Da follow",
				"Da theo doi",
				"Đã follow",
				"Đã theo dõi",
				"Friends",
				"Ban be",
				"Bạn bè",
				"Message",
				"Nhan tin",
				"Nhắn tin"
			]
		},
		like: {
			buttonSelector: 'button[data-e2e="like-button"], button[aria-label*="Like"]',
			likedAriaLabels: ["Liked"],
			likeAriaLabels: ["Like"],
			likedAriaPressed: "true"
		}
	};

	let running = false;
	let stopRequested = false;
	let lastStatus = "idle";
	let failureCount = 0;

	const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

	const mergeConfig = (base, override) => {
		if (!override) return { ...base };
		const output = Array.isArray(base) ? [...base] : { ...base };
		Object.keys(override).forEach((key) => {
			const baseValue = base ? base[key] : undefined;
			const overrideValue = override[key];

			if (
				baseValue &&
				typeof baseValue === "object" &&
				!Array.isArray(baseValue) &&
				typeof overrideValue === "object" &&
				!Array.isArray(overrideValue)
			) {
				output[key] = mergeConfig(baseValue, overrideValue);
			} else {
				output[key] = overrideValue;
			}
		});
		return output;
	};

	const sendStatus = (status, extra) => {
		lastStatus = status;
		console.log("[TikTok Auto] status:", status, extra || "");
		chrome.runtime.sendMessage({ type: "STATUS", status, extra });
	};

	const normalizeText = (value) =>
		(value || "")
			.trim()
			.toLowerCase()
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "");

	const pageTitleIncludes = (tokens) => {
		if (!tokens || !tokens.length) return false;
		const title = normalizeText(document.title);
		return tokens.map(normalizeText).some((token) => token && title.includes(token));
	};

	const getPageBlockReason = (config) => {
		if (pageTitleIncludes(config.page.loginTitles)) return "login_required";
		return null;
	};

	const queryFirst = (selector) => {
		if (!selector) return null;
		try {
			return document.querySelector(selector);
		} catch {
			return null;
		}
	};

	const isScrollable = (element) => {
		if (!element || !element.getBoundingClientRect) return false;
		const style = window.getComputedStyle(element);
		const overflowY = style.overflowY;
		return (
			(overflowY === "auto" || overflowY === "scroll") &&
			element.scrollHeight > element.clientHeight
		);
	};

	const findScrollableParent = (element) => {
		let current = element;
		while (current && current !== document.body) {
			if (isScrollable(current)) return current;
			current = current.parentElement;
		}
		return document.scrollingElement || document.documentElement;
	};

	const findButtonByText = (texts) => {
		if (!texts || !texts.length) return null;
		const candidates = Array.from(document.querySelectorAll("button"));
		const normalized = texts.map(normalizeText);

		return (
			candidates.find((button) => {
				const text = normalizeText(button.textContent);
				return normalized.some((token) => token && text.includes(token));
			}) || null
		);
	};

	const getVideoIdentity = (config) => {
		const video = queryFirst(config.video.videoSelector);
		if (video) {
			return (
				video.getAttribute("data-video-id") ||
				video.getAttribute("src") ||
				video.getAttribute("poster") ||
				video.currentSrc ||
				null
			);
		}

		const container = queryFirst(config.video.containerSelector);
		if (container) {
			const link = container.querySelector('a[href*="/video/"], a[href*="/photo/"]');
			return (
				container.getAttribute("data-video-id") ||
				container.getAttribute("data-item-id") ||
				(link ? link.getAttribute("href") : null) ||
				null
			);
		}

		return window.location ? window.location.href : null;
	};

	const focusVideo = (config) => {
		const container = queryFirst(config.video.containerSelector);
		if (container) {
			container.click();
			return;
		}

		const video = queryFirst(config.video.videoSelector);
		if (video) {
			video.click();
		}
	};

	const getFollowButtonInfo = (config) => {
		const fallbackFollowingTexts = [
			"following",
			"da follow",
			"đã follow",
			"da theo doi",
			"đã theo dõi",
			"friends",
			"message",
			"ban be",
			"bạn bè",
			"nhan tin",
			"nhắn tin"
		];
		const button = queryFirst(config.follow.buttonSelector) || findButtonByText([
			...config.follow.followTexts,
			...config.follow.followingTexts
		]);
		const wrapper = queryFirst('div[data-e2e="browse-follow"]');
		const wrapperButton = wrapper ? wrapper.querySelector("button") : null;
		const wrapperText = normalizeText(wrapper ? wrapper.textContent : "");
		const wrapperLabel = normalizeText(
			wrapperButton ? wrapperButton.textContent || wrapperButton.getAttribute("aria-label") : ""
		);

		const followTokens = config.follow.followTexts.map(normalizeText);
		const followingTokens = [
			...config.follow.followingTexts.map(normalizeText),
			...fallbackFollowingTexts.map(normalizeText)
		];
		const matchesTokens = (text, tokens) =>
			tokens.some((token) => token && text.includes(token));

		if (wrapperLabel && matchesTokens(wrapperLabel, followingTokens)) {
			return { state: "following", button: wrapperButton || button };
		}
		if (wrapperLabel && matchesTokens(wrapperLabel, followTokens)) {
			return { state: "not_following", button: wrapperButton || button };
		}
		// Some TikTok layouts only expose state text inside data-e2e="browse-follow".
		if (wrapperText.includes("da follow") || wrapperText.includes("da theo doi")) {
			return { state: "following", button: wrapperButton || button };
		}
		if (wrapperText && matchesTokens(wrapperText, followingTokens)) {
			return { state: "following", button };
		}
		if (wrapperText && matchesTokens(wrapperText, followTokens)) {
			return { state: "not_following", button };
		}

		if (!button) {
			const actionButtons = Array.from(document.querySelectorAll("button"));
			const hasFollowingAction = actionButtons.some((candidate) => {
				const text = normalizeText(candidate.textContent);
				const ariaLabel = normalizeText(candidate.getAttribute("aria-label"));
				const merged = `${text} ${ariaLabel}`.trim();
				return matchesTokens(merged, followingTokens);
			});
			if (hasFollowingAction) {
				return { state: "following", button: null };
			}
			return { state: "unknown", button: null };
		}

		const text = normalizeText(button.textContent);
		const ariaLabel = normalizeText(button.getAttribute("aria-label"));
		const combinedText = `${text} ${ariaLabel}`.trim();
		const isFollowingText = matchesTokens(combinedText, followingTokens);
		const isFollowText = matchesTokens(combinedText, followTokens);

		if (isFollowingText) return { state: "following", button };
		if (isFollowText) return { state: "not_following", button };

		const ariaPressed = button.getAttribute("aria-pressed");
		if (ariaPressed === "true") {
			return { state: "following", button };
		}

		return { state: "unknown", button };
	};

	const getLikeButton = (config) => {
		const selected = queryFirst(config.like.buttonSelector);
		if (selected) return selected;

		const icon = queryFirst('[data-e2e="browse-like-icon"]');
		if (icon) {
			const button = icon.closest("button");
			if (button) return button;
		}

		const candidates = Array.from(document.querySelectorAll("button"));
		const tokens = [
			...config.like.likeAriaLabels,
			...config.like.likedAriaLabels
		].map(normalizeText);

		return (
			candidates.find((button) => {
				const label = normalizeText(button.getAttribute("aria-label"));
				return tokens.some((token) => token && label.includes(token));
			}) || null
		);
	};

	const isLiked = (button, config) => {
		if (!button) return false;
		const ariaPressed = button.getAttribute("aria-pressed");
		if (ariaPressed === config.like.likedAriaPressed) return true;

		const ariaLabel = normalizeText(button.getAttribute("aria-label"));
		const likedLabels = config.like.likedAriaLabels.map(normalizeText);
		return likedLabels.some((label) => label && ariaLabel.includes(label));
	};

	const clickLike = async (button, alreadyLiked, config) => {
		if (!button) return;

		if (alreadyLiked) {
			button.click();
			await sleep(config.delays.shortMs);
			button.click();
			return;
		}

		button.click();
	};

	const processCurrentVideo = async (config) => {
		focusVideo(config);
		await sleep(config.delays.shortMs);

		const followInfo = getFollowButtonInfo(config);
		if (followInfo.state === "following") {
			sendStatus("already_following");
			return { ok: true, skipped: true, reason: "already_following" };
		}
		if (followInfo.state === "unknown") {
			return { ok: false, reason: "follow_unknown" };
		}

		const likeButton = getLikeButton(config);
		if (!likeButton) {
			return { ok: false, reason: "no_like_button" };
		}

		const likedAlready = isLiked(likeButton, config);
		await clickLike(likeButton, likedAlready, config);
		sendStatus(likedAlready ? "liked_double" : "liked_single");
		await sleep(config.delays.actionMs);

		return { ok: true };
	};

	const goNextVideo = async (config) => {
		focusVideo(config);

		const nextButtonSelectors = [
			'button[data-e2e*="next"]',
			'button[data-e2e*="arrow-right"]',
			'button[aria-label*="Next"]',
			'button[aria-label*="next"]'
		];
		for (const selector of nextButtonSelectors) {
			const nextButton = queryFirst(selector);
			if (nextButton && !nextButton.disabled) {
				nextButton.click();
				return;
			}
		}

		const eventInit = {
			key: "ArrowDown",
			code: "ArrowDown",
			keyCode: 40,
			which: 40,
			bubbles: true,
			cancelable: true
		};
		document.dispatchEvent(new KeyboardEvent("keydown", eventInit));
		document.dispatchEvent(new KeyboardEvent("keyup", eventInit));

		const video = queryFirst(config.video.videoSelector);
		const scrollParent = findScrollableParent(video || document.body);
		if (scrollParent && scrollParent !== document.body && scrollParent !== document.documentElement) {
			scrollParent.scrollTop += scrollParent.clientHeight * 0.9;
			return;
		}
		window.scrollBy(0, window.innerHeight * 0.9);
	};

	const waitForNextVideo = async (config, previousIdentity) => {
		if (!previousIdentity) {
			await sleep(config.delays.nextLoadMs);
			return true;
		}

		const maxTries = 10;
		for (let attempt = 0; attempt < maxTries; attempt += 1) {
			if (stopRequested) return false;
			await sleep(config.delays.nextLoadMs);
			const currentIdentity = getVideoIdentity(config);
			if (currentIdentity && currentIdentity !== previousIdentity) {
				return true;
			}
		}
		return false;
	};

	const runLoop = async (config) => {
		if (running) return;
		running = true;
		stopRequested = false;
		failureCount = 0;
		console.log("[TikTok Auto] start", config);
		sendStatus("running");

		while (running && !stopRequested) {
			const blockReason = getPageBlockReason(config);
			if (blockReason) {
				sendStatus("blocked", { reason: blockReason });
				break;
			}

			const identityBefore = getVideoIdentity(config);
			const result = await processCurrentVideo(config);
			console.log("[TikTok Auto] process result", result);
			if (!result.ok) {
				failureCount += 1;
				sendStatus("skip", result);
				if (result.reason === "no_video" && config.stopOnNoVideo !== false) {
					sendStatus("no_video_stop", result);
					break;
				}
				if (config.maxFailures > 0 && failureCount >= config.maxFailures) {
					sendStatus("stopped_failures", { failureCount });
					break;
				}
			} else {
				failureCount = 0;
			}

			await sleep(config.delays.shortMs);
			if (stopRequested) break;

			await goNextVideo(config);
			await waitForNextVideo(config, identityBefore);
		}

		running = false;
		stopRequested = false;
		console.log("[TikTok Auto] stopped");
		sendStatus("stopped");
	};

	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		if (!message || !message.type) return false;

		if (message.type === "PING") {
			sendResponse({ ok: true, from: "content" });
			return true;
		}

		if (message.type === "START") {
			console.log("[TikTok Auto] START received");
			const config = mergeConfig(DEFAULT_CONFIG, message.config || {});
			runLoop(config);
			sendResponse({ ok: true });
			return true;
		}

		if (message.type === "STOP") {
			console.log("[TikTok Auto] STOP received");
			stopRequested = true;
			sendResponse({ ok: true });
			return true;
		}

		if (message.type === "STATUS_REQUEST") {
			sendResponse({ ok: true, status: lastStatus, running });
			return true;
		}

		return false;
	});
})();
