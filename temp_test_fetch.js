// Temporary script to test Gemini StreamGenerate request
(async () => {
  const fetch = global.fetch || (await import('node-fetch')).default;
  const baseUrl = "https://gemini.google.com/u/6/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";
  const blLabel = "boq_assistant-bard-web-server_20260121.00_p1";
  const fSid = "-5455224565474320918";
  const hl = "vi";
  const reqId = "5682331"; // example
  const atToken = "AEHmXlGD4sLtRO3EqVUGGKWZMlOR:1769269909397";
  const cookie = "__Secure-BUCKET=CJMB; ..."; // truncated for brevity, use placeholder
  const params = new URLSearchParams({
    "bl": blLabel,
    "_reqid": reqId,
    "rt": "c",
    "f.sid": fSid,
    "hl": hl
  });
  const url = `${baseUrl}?${params.toString()}`;
  const fReq = JSON.stringify([null, JSON.stringify([["Hello world"], null, ["", "", ""]])]);
  const body = new URLSearchParams({
    "f.req": fReq,
    "at": atToken
  });
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Host": "gemini.google.com",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "User-Agent": "Mozilla/5.0",
        "Origin": "https://gemini.google.com",
        "Referer": "https://gemini.google.com/",
        "Cookie": cookie
      },
      body: body.toString()
    });
    console.log("Status", response.status);
    const text = await response.text();
    console.log("Response length", text.length);
    console.log(text.slice(0, 200));
  } catch (e) {
    console.error("Error", e);
  }
})();
